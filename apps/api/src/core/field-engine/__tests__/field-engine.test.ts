import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { RequestContext } from "../../../common/context/request-context.js";
import { closeDbPool } from "../../../config/db.js";
import { closeRedis } from "../../../config/redis.js";
import { createTenantSchema, type ProvisionedTenant } from "../../../core/tenant/provisioner.js";
import { closeTenantDbPool, withTenantSchema } from "../../../database/get-db.js";
import { companies, fieldDefinitions, users } from "../../../database/tenant/schema.js";
import { and, eq } from "drizzle-orm";
import { assignRoleToUser, createRole, setFieldPermission } from "../../rbac/mutations.js";
import { seedDefaultFieldDefinitions } from "../../provisioning/seed-field-definitions.js";
import { updateFieldDefinition } from "../mutations.js";
import { resolveFieldDefinitions } from "../resolve.js";
import { assertValidAgainstFieldDefinitions, checkAgainstFieldDefinitions } from "../validate.js";

const TEST_TIMEOUT_MS = 120_000;

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

  await seedDefaultFieldDefinitions({
    schemaName: tenant.schemaName,
    companyId,
    createdBy: userId,
  });

  return { tenant, companyId, userId };
}

function ctxFor(seed: SeededUser): RequestContext {
  return {
    requestId: randomUUID(),
    tenantScope: {
      tenantId: seed.tenant.id,
      tenantSchema: seed.tenant.schemaName,
      companyId: seed.companyId,
      userId: seed.userId,
    },
  };
}

async function findFieldDefinitionId(
  schemaName: string,
  companyId: string,
  module: string,
  entity: string,
  fieldKey: string,
): Promise<string> {
  const [row] = await withTenantSchema(schemaName, (tx) =>
    tx
      .select()
      .from(fieldDefinitions)
      .where(
        and(
          eq(fieldDefinitions.companyId, companyId),
          eq(fieldDefinitions.module, module),
          eq(fieldDefinitions.entity, entity),
          eq(fieldDefinitions.fieldKey, fieldKey),
        ),
      )
      .limit(1),
  );
  if (!row) {
    throw new Error(`expected a provisioned field_definitions row for ${module}.${entity}.${fieldKey}`);
  }
  return row.id;
}

describe("core/field-engine", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "the real spec requirement: renaming Other Charges to Clearing Charges is reflected immediately, with no code change",
    async () => {
      const seed = await seedTenantWithUser("field-rename");
      const ctx = ctxFor(seed);

      const before = await resolveFieldDefinitions(ctx, "purchase", "po");
      const otherCharges = before.find((f) => f.fieldKey === "otherCharges");
      expect(otherCharges?.label).toBe("Other Charges");

      const id = await findFieldDefinitionId(seed.tenant.schemaName, seed.companyId, "purchase", "po", "otherCharges");
      await updateFieldDefinition({
        id,
        companyId: seed.companyId,
        schemaName: seed.tenant.schemaName,
        updatedBy: seed.userId,
        label: "Clearing Charges",
      });

      const after = await resolveFieldDefinitions(ctx, "purchase", "po");
      const renamed = after.find((f) => f.fieldKey === "otherCharges");
      expect(renamed?.label).toBe("Clearing Charges");
      // The column/key/calculation identity never moved - only the label did.
      expect(renamed?.fieldKey).toBe("otherCharges");
      expect(renamed?.dataType).toBe("decimal");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "an is_system field cannot be hidden",
    async () => {
      const seed = await seedTenantWithUser("field-system-hide");
      const id = await findFieldDefinitionId(seed.tenant.schemaName, seed.companyId, "users", "user", "email");

      await expect(
        updateFieldDefinition({
          id,
          companyId: seed.companyId,
          schemaName: seed.tenant.schemaName,
          updatedBy: seed.userId,
          isVisible: false,
        }),
      ).rejects.toThrow(/cannot be hidden/i);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "an is_system field cannot be made optional",
    async () => {
      const seed = await seedTenantWithUser("field-system-optional");
      const id = await findFieldDefinitionId(seed.tenant.schemaName, seed.companyId, "users", "user", "email");

      await expect(
        updateFieldDefinition({
          id,
          companyId: seed.companyId,
          schemaName: seed.tenant.schemaName,
          updatedBy: seed.userId,
          isMandatory: false,
        }),
      ).rejects.toThrow(/cannot be made optional/i);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "cache invalidates immediately on an override - no stale label after the write commits",
    async () => {
      const seed = await seedTenantWithUser("field-cache");
      const ctx = ctxFor(seed);
      const id = await findFieldDefinitionId(seed.tenant.schemaName, seed.companyId, "purchase", "po", "freight");

      const before = await resolveFieldDefinitions(ctx, "purchase", "po");
      expect(before.find((f) => f.fieldKey === "freight")?.label).toBe("Freight");

      await updateFieldDefinition({
        id,
        companyId: seed.companyId,
        schemaName: seed.tenant.schemaName,
        updatedBy: seed.userId,
        label: "Freight Cost",
      });

      const after = await resolveFieldDefinitions(ctx, "purchase", "po");
      expect(after.find((f) => f.fieldKey === "freight")?.label).toBe("Freight Cost");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "field permissions correctly intersect with definitions - a role's canView: false hides a field the company hasn't restricted",
    async () => {
      const seed = await seedTenantWithUser("field-permission-intersect");
      const ctx = ctxFor(seed);

      const before = await resolveFieldDefinitions(ctx, "purchase", "po");
      expect(before.find((f) => f.fieldKey === "insurance")?.isVisible).toBe(true);

      const role = await createRole({
        schemaName: seed.tenant.schemaName,
        companyId: seed.companyId,
        name: "Field Restricted",
        createdBy: seed.userId,
      });
      await assignRoleToUser(seed.tenant.schemaName, seed.companyId, seed.userId, role.id, seed.userId);
      await setFieldPermission({
        schemaName: seed.tenant.schemaName,
        companyId: seed.companyId,
        roleId: role.id,
        module: "purchase",
        entity: "po",
        fieldKey: "insurance",
        canView: false,
        canEdit: false,
        createdBy: seed.userId,
      });

      const after = await resolveFieldDefinitions(ctx, "purchase", "po");
      const insurance = after.find((f) => f.fieldKey === "insurance");
      expect(insurance?.isVisible).toBe(false);
      expect(insurance?.isEditable).toBe(false);
      // Unrelated fields are untouched by this one field-level grant.
      expect(after.find((f) => f.fieldKey === "freight")?.isVisible).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  describe("checkAgainstFieldDefinitions / assertValidAgainstFieldDefinitions", () => {
    it(
      "a mandatory override is enforced by the validator against a real resolved field list",
      async () => {
        const seed = await seedTenantWithUser("field-validator");
        const ctx = ctxFor(seed);
        const id = await findFieldDefinitionId(seed.tenant.schemaName, seed.companyId, "purchase", "po", "freight");

        await updateFieldDefinition({
          id,
          companyId: seed.companyId,
          schemaName: seed.tenant.schemaName,
          updatedBy: seed.userId,
          isMandatory: true,
        });

        const fields = await resolveFieldDefinitions(ctx, "purchase", "po");

        const issues = checkAgainstFieldDefinitions(fields, { freight: undefined, insurance: 100 });
        expect(issues).toContainEqual({ fieldKey: "freight", message: "Freight is required" });

        expect(() => assertValidAgainstFieldDefinitions(fields, { freight: undefined })).toThrow(
          /required/i,
        );
        expect(() => assertValidAgainstFieldDefinitions(fields, { freight: 500 })).not.toThrow();
      },
      TEST_TIMEOUT_MS,
    );
  });
});
