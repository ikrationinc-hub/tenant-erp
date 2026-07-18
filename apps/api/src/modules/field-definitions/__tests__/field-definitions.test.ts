import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../../../app.js";
import { closeDbPool } from "../../../config/db.js";
import { closeRedis } from "../../../config/redis.js";
import { signAccessToken } from "../../../core/auth/jwt.js";
import { seedDefaultFieldDefinitions } from "../../../core/provisioning/seed-field-definitions.js";
import { assignRoleToUser, createRole, grantPermissionToRole } from "../../../core/rbac/mutations.js";
import { createTenantSchema } from "../../../core/tenant/provisioner.js";
import { closeTenantDbPool, withTenantSchema } from "../../../database/get-db.js";
import { companies, fieldDefinitions, permissions, users } from "../../../database/tenant/schema.js";

const TEST_TIMEOUT_MS = 120_000;

const effectiveFieldSchema = z.object({
  id: z.string().nullable().optional(),
  fieldKey: z.string(),
  label: z.string(),
  dataType: z.string(),
  isVisible: z.boolean(),
  isEditable: z.boolean(),
});

const getFieldDefinitionsResponseSchema = z.object({
  module: z.string(),
  entity: z.string(),
  fields: z.array(effectiveFieldSchema),
});

function asGetFieldDefinitions(res: { body: unknown }) {
  return getFieldDefinitionsResponseSchema.parse(res.body);
}

async function findPermissionId(schemaName: string, key: string): Promise<string> {
  const [row] = await withTenantSchema(schemaName, (tx) =>
    tx.select().from(permissions).where(eq(permissions.key, key)).limit(1),
  );
  if (!row) {
    throw new Error(`expected permission ${key} to exist in the seeded catalogue`);
  }
  return row.id;
}

interface SeededAdmin {
  tenantId: string;
  schemaName: string;
  companyId: string;
  userId: string;
  accessToken: string;
}

async function seedTenantWithAdmin(label: string, permissionKeys: string[]): Promise<SeededAdmin> {
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
        name: `${label} Admin`,
        status: "active",
        createdBy: randomUUID(),
      })
      .returning();
    if (!user) {
      throw new Error("failed to insert user");
    }
    return { companyId: company.id, userId: user.id };
  });

  await seedDefaultFieldDefinitions({ schemaName: tenant.schemaName, companyId, createdBy: userId });

  const role = await createRole({
    schemaName: tenant.schemaName,
    companyId,
    name: `${label}-role`,
    createdBy: userId,
  });
  await assignRoleToUser(tenant.schemaName, companyId, userId, role.id, userId);
  for (const key of permissionKeys) {
    const permissionId = await findPermissionId(tenant.schemaName, key);
    await grantPermissionToRole(tenant.schemaName, companyId, role.id, permissionId, userId);
  }

  const { token } = await signAccessToken({
    sub: userId,
    tenant: tenant.id,
    company_id: companyId,
    roles: [],
    scope: "full",
  });

  return { tenantId: tenant.id, schemaName: tenant.schemaName, companyId, userId, accessToken: token };
}

describe("field-definitions HTTP module", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "GET returns the resolved field schema for a module/entity",
    async () => {
      const admin = await seedTenantWithAdmin("fd-get", ["field_definitions.field.read"]);

      const res = await request(createApp())
        .get("/api/v1/field-definitions/purchase/po")
        .set("Authorization", `Bearer ${admin.accessToken}`);

      expect(res.status).toBe(200);
      const otherCharges = asGetFieldDefinitions(res).fields.find((f) => f.fieldKey === "otherCharges");
      expect(otherCharges?.label).toBe("Other Charges");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "PATCH rejects an attempt to override dataType with a 422 - it is structurally not an overridable field",
    async () => {
      const admin = await seedTenantWithAdmin("fd-datatype", [
        "field_definitions.field.read",
        "field_definitions.field.update",
      ]);

      const [row] = await withTenantSchema(admin.schemaName, (tx) =>
        tx.select().from(fieldDefinitions).limit(1),
      );
      if (!row) {
        throw new Error("expected at least one seeded field_definitions row");
      }
      const id = row.id;

      const res = await request(createApp())
        .patch(`/api/v1/field-definitions/${id}`)
        .set("Authorization", `Bearer ${admin.accessToken}`)
        .send({ dataType: "text" });

      expect(res.status).toBe(422);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the spec proof: PATCH renames Other Charges to Clearing Charges, and GET reflects it with no deploy or migration",
    async () => {
      const admin = await seedTenantWithAdmin("fd-proof", [
        "field_definitions.field.read",
        "field_definitions.field.update",
      ]);
      const app = createApp();
      const authHeader = `Bearer ${admin.accessToken}`;

      const before = await request(app)
        .get("/api/v1/field-definitions/purchase/po")
        .set("Authorization", authHeader);
      const otherChargesBefore = asGetFieldDefinitions(before).fields.find((f) => f.fieldKey === "otherCharges");
      expect(otherChargesBefore?.label).toBe("Other Charges");
      if (!otherChargesBefore?.id) {
        throw new Error("expected otherCharges to have a real provisioned id");
      }

      const patchRes = await request(app)
        .patch(`/api/v1/field-definitions/${otherChargesBefore.id}`)
        .set("Authorization", authHeader)
        .send({ label: "Clearing Charges" });
      expect(patchRes.status).toBe(200);

      const after = await request(app)
        .get("/api/v1/field-definitions/purchase/po")
        .set("Authorization", authHeader);
      const otherChargesAfter = asGetFieldDefinitions(after).fields.find((f) => f.fieldKey === "otherCharges");
      expect(otherChargesAfter?.label).toBe("Clearing Charges");
      expect(otherChargesAfter?.fieldKey).toBe("otherCharges");
      expect(otherChargesAfter?.dataType).toBe("decimal");
    },
    TEST_TIMEOUT_MS,
  );
});
