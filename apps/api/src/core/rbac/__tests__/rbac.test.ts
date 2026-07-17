import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { errorHandler } from "../../../common/middleware/error-handler.js";
import { rejectWriteForbiddenFields, sendFiltered } from "../../../common/middleware/field-rbac.js";
import { requirePermission } from "../../../common/middleware/rbac.js";
import { requestContextMiddleware } from "../../../common/middleware/request-context.middleware.js";
import { scopeResolverMiddleware } from "../../../common/middleware/scope-resolver.js";
import { closeDbPool } from "../../../config/db.js";
import { closeRedis } from "../../../config/redis.js";
import { signAccessToken } from "../../../core/auth/jwt.js";
import { createTenantSchema, type ProvisionedTenant } from "../../../core/tenant/provisioner.js";
import { closeTenantDbPool, withTenantSchema } from "../../../database/get-db.js";
import { companies, permissions, users } from "../../../database/tenant/schema.js";
import {
  assignRoleToUser,
  createRole,
  grantPermissionToRole,
  revokePermissionFromRole,
  setFieldPermission,
} from "../mutations.js";
import { resolve } from "../resolve.js";

const TEST_TIMEOUT_MS = 120_000;

const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

interface SeededUser {
  tenant: ProvisionedTenant;
  companyId: string;
  userId: string;
}

async function seedTenantWithUser(label: string): Promise<SeededUser> {
  const unique = randomUUID().slice(0, 8);
  const tenant = await createTenantSchema({ name: `${label} Co`, slug: `${label}-${unique}` });

  const { companyId, userId } = await withTenantSchema(tenant.schemaName, async (tx) => {
    const [company] = await tx
      .insert(companies)
      .values({
        name: `${label} Co`,
        countryCode: "US",
        currencyCode: "USD",
        fiscalYearStartMonth: 1,
        timezone: "America/New_York",
        createdBy: randomUUID(),
      })
      .returning();
    if (!company) {
      throw new Error("failed to insert company");
    }

    const [user] = await tx
      .insert(users)
      .values({
        companyId: company.id,
        email: `${label}-${unique}@example.com`,
        mobile: "+10000000000",
        name: `${label} User`,
        status: "active",
        createdBy: randomUUID(),
      })
      .returning();
    if (!user) {
      throw new Error("failed to insert user");
    }

    return { companyId: company.id, userId: user.id };
  });

  return { tenant, companyId, userId };
}

async function findPermissionId(schemaName: string, key: string): Promise<string> {
  const [row] = await withTenantSchema(schemaName, (tx) =>
    tx.select().from(permissions).where(eq(permissions.key, key)).limit(1),
  );
  if (!row) {
    throw new Error(`expected "${key}" to already be seeded by the provisioner`);
  }
  return row.id;
}

async function issueAccessToken(seed: SeededUser): Promise<string> {
  const { token } = await signAccessToken({
    sub: seed.userId,
    tenant: seed.tenant.id,
    company_id: seed.companyId,
    roles: [],
    scope: "full",
  });
  return token;
}

function buildTestApp(): express.Express {
  const app = express();
  app.use(requestContextMiddleware);
  app.use(express.json());
  app.use(scopeResolverMiddleware);

  app.get("/probe/permission", requirePermission("purchase.po.approve"), (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.post("/probe/write", rejectWriteForbiddenFields("masters", "supplier"), (req, res) => {
    const received: unknown = req.body;
    res.status(200).json({ received });
  });

  app.get("/probe/read-one", async (_req, res, next) => {
    try {
      await sendFiltered(res, "masters", "supplier", {
        id: "s1",
        name: "Acme Metals",
        creditLimit: 100000,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/probe/read-list", async (_req, res, next) => {
    try {
      await sendFiltered(res, "masters", "supplier", [
        { id: "s1", name: "Acme Metals", creditLimit: 100000 },
        { id: "s2", name: "Beta Metals", creditLimit: 250000 },
      ]);
    } catch (error) {
      next(error);
    }
  });

  app.use(errorHandler);
  return app;
}

describe("permission engine (core/rbac)", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "grants access when the role includes the permission, denies when it doesn't",
    async () => {
      const seed = await seedTenantWithUser("rbac-grant");
      const app = buildTestApp();
      const permissionId = await findPermissionId(seed.tenant.schemaName, "purchase.po.approve");

      const role = await createRole({
        schemaName: seed.tenant.schemaName,
        companyId: seed.companyId,
        name: "Approver",
        createdBy: randomUUID(),
      });

      // No role assigned yet: denied.
      const deniedRes = await request(app)
        .get("/probe/permission")
        .set("Authorization", `Bearer ${await issueAccessToken(seed)}`);
      expect(deniedRes.status).toBe(403);

      await assignRoleToUser(seed.tenant.schemaName, seed.companyId, seed.userId, role.id, randomUUID());
      await grantPermissionToRole(seed.tenant.schemaName, seed.companyId, role.id, permissionId, randomUUID());

      const grantedRes = await request(app)
        .get("/probe/permission")
        .set("Authorization", `Bearer ${await issueAccessToken(seed)}`);
      expect(grantedRes.status).toBe(200);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "revoking a permission takes effect immediately, not after the cache TTL",
    async () => {
      const seed = await seedTenantWithUser("rbac-invalidate");
      const app = buildTestApp();
      const permissionId = await findPermissionId(seed.tenant.schemaName, "purchase.po.approve");

      const role = await createRole({
        schemaName: seed.tenant.schemaName,
        companyId: seed.companyId,
        name: "Approver",
        createdBy: randomUUID(),
      });
      await assignRoleToUser(seed.tenant.schemaName, seed.companyId, seed.userId, role.id, randomUUID());
      await grantPermissionToRole(seed.tenant.schemaName, seed.companyId, role.id, permissionId, randomUUID());

      const token = await issueAccessToken(seed);

      // First call populates the cache.
      const before = await request(app).get("/probe/permission").set("Authorization", `Bearer ${token}`);
      expect(before.status).toBe(200);

      await revokePermissionFromRole(seed.tenant.schemaName, seed.companyId, role.id, permissionId);

      // Same token, no wait, no restart, no TTL expiry - just revoked.
      const after = await request(app).get("/probe/permission").set("Authorization", `Bearer ${token}`);
      expect(after.status).toBe(403);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "resolve() reflects a granted permission in its returned Set without a second query",
    async () => {
      const seed = await seedTenantWithUser("rbac-resolve");
      const permissionId = await findPermissionId(seed.tenant.schemaName, "purchase.po.approve");

      const role = await createRole({
        schemaName: seed.tenant.schemaName,
        companyId: seed.companyId,
        name: "Approver",
        createdBy: randomUUID(),
      });
      await assignRoleToUser(seed.tenant.schemaName, seed.companyId, seed.userId, role.id, randomUUID());
      await grantPermissionToRole(seed.tenant.schemaName, seed.companyId, role.id, permissionId, randomUUID());

      const resolved = await resolve({
        requestId: randomUUID(),
        tenantScope: {
          tenantId: seed.tenant.id,
          tenantSchema: seed.tenant.schemaName,
          companyId: seed.companyId,
          userId: seed.userId,
        },
      });

      expect(resolved.permissions.has("purchase.po.approve")).toBe(true);
      expect(resolved.permissions.has("masters.supplier.delete")).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a write-forbidden field in the body is rejected with 403 naming the field",
    async () => {
      const seed = await seedTenantWithUser("rbac-write");
      const app = buildTestApp();

      const role = await createRole({
        schemaName: seed.tenant.schemaName,
        companyId: seed.companyId,
        name: "Restricted",
        createdBy: randomUUID(),
      });
      await assignRoleToUser(seed.tenant.schemaName, seed.companyId, seed.userId, role.id, randomUUID());
      await setFieldPermission({
        schemaName: seed.tenant.schemaName,
        companyId: seed.companyId,
        roleId: role.id,
        module: "masters",
        entity: "supplier",
        fieldKey: "creditLimit",
        canView: false,
        canEdit: false,
        createdBy: randomUUID(),
      });

      const token = await issueAccessToken(seed);

      const rejected = await request(app)
        .post("/probe/write")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Acme Metals", creditLimit: 500000 });

      expect(rejected.status).toBe(403);
      const rejectedBody = errorResponseSchema.parse(rejected.body);
      expect(rejectedBody.error.details).toMatchObject({ field: "creditLimit" });
      expect(rejectedBody.error.message).toContain("creditLimit");

      // A body with no forbidden field still goes through.
      const accepted = await request(app)
        .post("/probe/write")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Acme Metals" });
      expect(accepted.status).toBe(200);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a read-forbidden field is stripped from both a single GET and a list",
    async () => {
      const seed = await seedTenantWithUser("rbac-read");
      const app = buildTestApp();

      const role = await createRole({
        schemaName: seed.tenant.schemaName,
        companyId: seed.companyId,
        name: "Restricted Viewer",
        createdBy: randomUUID(),
      });
      await assignRoleToUser(seed.tenant.schemaName, seed.companyId, seed.userId, role.id, randomUUID());
      await setFieldPermission({
        schemaName: seed.tenant.schemaName,
        companyId: seed.companyId,
        roleId: role.id,
        module: "masters",
        entity: "supplier",
        fieldKey: "creditLimit",
        canView: false,
        canEdit: false,
        createdBy: randomUUID(),
      });

      const token = await issueAccessToken(seed);

      const single = await request(app).get("/probe/read-one").set("Authorization", `Bearer ${token}`);
      expect(single.status).toBe(200);
      expect(single.body).not.toHaveProperty("creditLimit");
      expect(single.body).toMatchObject({ id: "s1", name: "Acme Metals" });

      const list = await request(app).get("/probe/read-list").set("Authorization", `Bearer ${token}`);
      expect(list.status).toBe(200);
      expect(Array.isArray(list.body)).toBe(true);
      for (const row of list.body as unknown[]) {
        expect(row).not.toHaveProperty("creditLimit");
      }
      expect(list.body).toMatchObject([{ id: "s1", name: "Acme Metals" }, { id: "s2", name: "Beta Metals" }]);
    },
    TEST_TIMEOUT_MS,
  );
});
