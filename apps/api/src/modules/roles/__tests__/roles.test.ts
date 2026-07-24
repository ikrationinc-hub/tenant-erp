import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../../../app.js";
import { closeDbPool } from "../../../config/db.js";
import { closeRedis } from "../../../config/redis.js";
import { signAccessToken } from "../../../core/auth/jwt.js";
import { assignRoleToUser, createRole, grantPermissionToRole } from "../../../core/rbac/mutations.js";
import { createTenantSchema } from "../../../core/tenant/provisioner.js";
import { closeTenantDbPool, withTenantSchema } from "../../../database/get-db.js";
import { companies, permissions, users } from "../../../database/tenant/schema.js";

const TEST_TIMEOUT_MS = 120_000;

const roleRowSchema = z.object({ id: z.string(), name: z.string(), companyId: z.string() });
const paginatedRolesSchema = z.object({ items: z.array(roleRowSchema), total: z.number(), page: z.number(), pageSize: z.number() });
const optionsResponseSchema = z.object({ options: z.array(z.object({ value: z.string(), label: z.string() })) });
const catalogueResponseSchema = z.object({
  permissions: z.array(z.object({ key: z.string(), module: z.string(), entity: z.string(), action: z.string(), description: z.string() })),
});
const grantedPermissionsResponseSchema = z.object({ permissionKeys: z.array(z.string()) });
const fieldPermissionsResponseSchema = z.object({
  fieldPermissions: z.array(z.object({ fieldKey: z.string(), canView: z.boolean(), canEdit: z.boolean() })),
});
const fieldDefinitionsResponseSchema = z.object({
  module: z.string(),
  entity: z.string(),
  fields: z.array(z.object({ fieldKey: z.string(), isVisible: z.boolean().optional() })),
});

function asRole(res: { body: unknown }) {
  return roleRowSchema.parse(res.body);
}
function asPaginatedRoles(res: { body: unknown }) {
  return paginatedRolesSchema.parse(res.body);
}

async function findPermissionId(schemaName: string, key: string): Promise<string> {
  const [row] = await withTenantSchema(schemaName, (tx) => tx.select().from(permissions).where(eq(permissions.key, key)).limit(1));
  if (!row) {
    throw new Error(`expected permission ${key} to exist in the seeded catalogue`);
  }
  return row.id;
}

interface SeededTenant {
  schemaName: string;
  companyId: string;
  userId: string;
  roleId: string;
  accessToken: string;
}

async function seedTenant(label: string, permissionKeys: string[]): Promise<SeededTenant> {
  const unique = randomUUID().slice(0, 8);
  const tenant = await createTenantSchema({ name: `${label} Co`, slug: `${label}-${unique}` });

  const { companyId, userId } = await withTenantSchema(tenant.schemaName, async (tx) => {
    const [company] = await tx
      .insert(companies)
      .values({ name: `${label} Co`, fiscalYearStartMonth: 1, timezone: "America/New_York", createdBy: randomUUID() })
      .returning();
    if (!company) {
      throw new Error("failed to insert company");
    }
    const [user] = await tx
      .insert(users)
      .values({ companyId: company.id, email: `${label}-${unique}@example.com`, name: `${label} Admin`, status: "active", createdBy: randomUUID() })
      .returning();
    if (!user) {
      throw new Error("failed to insert user");
    }
    return { companyId: company.id, userId: user.id };
  });

  const role = await createRole({ schemaName: tenant.schemaName, companyId, name: `${label}-role`, createdBy: userId });
  await assignRoleToUser(tenant.schemaName, companyId, userId, role.id, userId);
  for (const key of permissionKeys) {
    const permissionId = await findPermissionId(tenant.schemaName, key);
    await grantPermissionToRole(tenant.schemaName, companyId, role.id, permissionId, userId);
  }

  const { token } = await signAccessToken({ sub: userId, tenant: tenant.id, company_id: companyId, roles: [], scope: "full" });

  return { schemaName: tenant.schemaName, companyId, userId, roleId: role.id, accessToken: token };
}

describe("modules/roles - RBAC admin surface (roles, permissions, field-permissions)", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "creates and renames a role, rejecting a duplicate name",
    async () => {
      const tenant = await seedTenant("crud", ["admin.role.create", "admin.role.read", "admin.role.update"]);
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const created = asRole(
        await request(app).post("/api/v1/roles").set("Authorization", authHeader).send({ name: "Purchasing Manager" }),
      );
      expect(created.companyId).toBe(tenant.companyId);

      const dupRes = await request(app).post("/api/v1/roles").set("Authorization", authHeader).send({ name: "Purchasing Manager" });
      expect(dupRes.status).toBe(409);

      const renameRes = await request(app)
        .patch(`/api/v1/roles/${created.id}`)
        .set("Authorization", authHeader)
        .send({ name: "Senior Purchasing Manager" });
      expect(renameRes.status).toBe(200);
      expect(asRole(renameRes).name).toBe("Senior Purchasing Manager");

      const listRes = asPaginatedRoles(await request(app).get("/api/v1/roles").set("Authorization", authHeader));
      expect(listRes.items.some((row) => row.id === created.id)).toBe(true);

      const optionsRes = optionsResponseSchema.parse(
        (await request(app).get("/api/v1/roles/options").set("Authorization", authHeader)).body,
      );
      expect(optionsRes.options.some((o) => o.value === created.id && o.label === "Senior Purchasing Manager")).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "GET /permissions returns the full catalogue, sourced from the module registry",
    async () => {
      const tenant = await seedTenant("catalogue", []);
      const app = createApp();

      const res = await request(app).get("/api/v1/permissions").set("Authorization", `Bearer ${tenant.accessToken}`);
      expect(res.status).toBe(200);
      const catalogue = catalogueResponseSchema.parse(res.body);
      expect(catalogue.permissions.some((p) => p.key === "admin.company.read")).toBe(true);
      expect(catalogue.permissions.some((p) => p.key === "admin.branch.create")).toBe(true);
      expect(catalogue.permissions.some((p) => p.key === "admin.role.update")).toBe(true);
      expect(catalogue.permissions.some((p) => p.key === "users.user.update")).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "granting/revoking a permission on a role takes effect on the caller's very next request - no TTL wait",
    async () => {
      const tenant = await seedTenant("grant-immediacy", ["admin.role.read", "admin.role.update"]);
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      // The caller's own role doesn't hold admin.company.read yet.
      const beforeRes = await request(app).get("/api/v1/companies").set("Authorization", authHeader);
      expect(beforeRes.status).toBe(403);

      const grantRes = await request(app)
        .post(`/api/v1/roles/${tenant.roleId}/permissions`)
        .set("Authorization", authHeader)
        .send({ permissionKey: "admin.company.read" });
      expect(grantRes.status).toBe(204);

      // Same access token, same cache - no TTL wait, no re-login.
      const afterGrantRes = await request(app).get("/api/v1/companies").set("Authorization", authHeader);
      expect(afterGrantRes.status).toBe(200);

      const grantedRes = grantedPermissionsResponseSchema.parse(
        (await request(app).get(`/api/v1/roles/${tenant.roleId}/permissions`).set("Authorization", authHeader)).body,
      );
      expect(grantedRes.permissionKeys).toContain("admin.company.read");

      const revokeRes = await request(app)
        .delete(`/api/v1/roles/${tenant.roleId}/permissions/${encodeURIComponent("admin.company.read")}`)
        .set("Authorization", authHeader);
      expect(revokeRes.status).toBe(204);

      const afterRevokeRes = await request(app).get("/api/v1/companies").set("Authorization", authHeader);
      expect(afterRevokeRes.status).toBe(403);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "field-permissions get/save round-trips, and revoking can_view on purchase.pricing.purchaseRateUsd strips it from the very next field-definitions GET (FE-7's demo)",
    async () => {
      const tenant = await seedTenant("field-perms", [
        "admin.role.read",
        "admin.role.update",
        "field_definitions.field.read",
      ]);
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      // No overrides yet.
      const initialGet = fieldPermissionsResponseSchema.parse(
        (
          await request(app)
            .get(`/api/v1/roles/${tenant.roleId}/field-permissions`)
            .query({ module: "purchase", entity: "pricing" })
            .set("Authorization", authHeader)
        ).body,
      );
      expect(initialGet.fieldPermissions).toHaveLength(0);

      const beforeDefs = fieldDefinitionsResponseSchema.parse(
        (await request(app).get("/api/v1/field-definitions/purchase/pricing").set("Authorization", authHeader)).body,
      );
      const beforeField = beforeDefs.fields.find((f) => f.fieldKey === "purchaseRateUsd");
      expect(beforeField?.isVisible).toBe(true);

      const saveRes = await request(app)
        .put(`/api/v1/roles/${tenant.roleId}/field-permissions`)
        .set("Authorization", authHeader)
        .send({ module: "purchase", entity: "pricing", rows: [{ fieldKey: "purchaseRateUsd", canView: false, canEdit: false }] });
      expect(saveRes.status).toBe(204);

      const afterGet = fieldPermissionsResponseSchema.parse(
        (
          await request(app)
            .get(`/api/v1/roles/${tenant.roleId}/field-permissions`)
            .query({ module: "purchase", entity: "pricing" })
            .set("Authorization", authHeader)
        ).body,
      );
      expect(afterGet.fieldPermissions).toEqual([{ fieldKey: "purchaseRateUsd", canView: false, canEdit: false }]);

      // The very next GET on that entity - no TTL wait, same token.
      const afterDefs = fieldDefinitionsResponseSchema.parse(
        (await request(app).get("/api/v1/field-definitions/purchase/pricing").set("Authorization", authHeader)).body,
      );
      const afterField = afterDefs.fields.find((f) => f.fieldKey === "purchaseRateUsd");
      expect(afterField?.isVisible).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );
});
