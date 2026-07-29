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

const staticOptionsSourceSchema = z.object({
  type: z.enum(["static", "enum"]),
  staticOptions: z.array(z.object({ value: z.string(), label: z.string() })),
});

const effectiveFieldSchema = z.object({
  id: z.string().nullable().optional(),
  fieldKey: z.string(),
  label: z.string(),
  dataType: z.string(),
  isVisible: z.boolean(),
  isMandatory: z.boolean(),
  isEditable: z.boolean(),
  optionsSource: z.union([z.string(), staticOptionsSourceSchema]).optional(),
  fieldType: z.string().optional(),
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

  /**
   * Prompt 16: every new field-definitions entity must match apps/web's
   * mocks (suppliers-handlers.ts / purchase-handlers.ts) field-for-field -
   * field keys, order, and mandatory flags, asserted as one ordered tuple
   * list per entity rather than spot-checking a single field.
   */
  async function fetchFields(admin: SeededAdmin, module: string, entity: string) {
    const res = await request(createApp())
      .get(`/api/v1/field-definitions/${module}/${entity}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(200);
    return asGetFieldDefinitions(res).fields;
  }

  async function fetchOrderedFields(
    admin: SeededAdmin,
    module: string,
    entity: string,
  ): Promise<{ fieldKey: string; isMandatory: boolean }[]> {
    const fields = await fetchFields(admin, module, entity);
    return fields.map((f) => ({ fieldKey: f.fieldKey, isMandatory: f.isMandatory }));
  }

  it(
    "suppliers/supplier matches suppliers-handlers.ts's supplierFieldDefinitions field-for-field",
    async () => {
      const admin = await seedTenantWithAdmin("fd-supplier", ["field_definitions.field.read"]);
      const fields = await fetchOrderedFields(admin, "suppliers", "supplier");
      expect(fields).toEqual([
        { fieldKey: "code", isMandatory: false },
        { fieldKey: "name", isMandatory: true },
        { fieldKey: "supplierTypeId", isMandatory: true },
        { fieldKey: "countryId", isMandatory: true },
        { fieldKey: "cityId", isMandatory: false },
        { fieldKey: "address", isMandatory: false },
        { fieldKey: "taxRegistrationNo", isMandatory: false },
        { fieldKey: "paymentTermId", isMandatory: true },
        { fieldKey: "currencyId", isMandatory: true },
        { fieldKey: "remarks", isMandatory: false },
      ]);

      // FR-002's server-assigned code needs fieldType AutoGenerated, not
      // just isEditable: false - otherwise apps/web's SchemaForm has no
      // signal to strip it from the submit payload, and createSupplierSchema
      // (.strict(), never declares "code") rejects the create outright
      // with a 422 unrecognized_keys, even for an empty "" value.
      const rawFields = await fetchFields(admin, "suppliers", "supplier");
      expect(rawFields.find((f) => f.fieldKey === "code")?.fieldType).toBe("AutoGenerated");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "purchase/header matches purchase-handlers.ts's HEADER_FIELDS field-for-field (header + flattened shipment + 6 attachment fields)",
    async () => {
      const admin = await seedTenantWithAdmin("fd-header", ["field_definitions.field.read"]);
      const fields = await fetchOrderedFields(admin, "purchase", "header");
      expect(fields).toEqual([
        { fieldKey: "purchaseNumber", isMandatory: false },
        { fieldKey: "purchaseDate", isMandatory: true },
        { fieldKey: "branchId", isMandatory: true },
        { fieldKey: "buyerId", isMandatory: true },
        { fieldKey: "supplierId", isMandatory: true },
        { fieldKey: "supplierInvoiceNo", isMandatory: false },
        { fieldKey: "supplierReferenceNo", isMandatory: false },
        { fieldKey: "lotNumber", isMandatory: true },
        { fieldKey: "containerNumber", isMandatory: true },
        { fieldKey: "blNo", isMandatory: true },
        { fieldKey: "loadingDate", isMandatory: true },
        { fieldKey: "transportModeId", isMandatory: true },
        { fieldKey: "vesselId", isMandatory: false },
        { fieldKey: "voyageNumber", isMandatory: false },
        { fieldKey: "portOfLoadingId", isMandatory: true },
        { fieldKey: "portOfDischargeId", isMandatory: true },
        { fieldKey: "warehouseId", isMandatory: true },
        { fieldKey: "incotermId", isMandatory: true },
        { fieldKey: "invoice", isMandatory: false },
        { fieldKey: "billOfLading", isMandatory: false },
        { fieldKey: "packingList", isMandatory: false },
        { fieldKey: "certificateOfOrigin", isMandatory: false },
        { fieldKey: "otherDocuments", isMandatory: false },
        { fieldKey: "otherDocuments2", isMandatory: false },
      ]);

      // The 6 attachment fields need fieldType FileUpload/MultiUpload, not
      // just a bare dataType - otherwise they'd resolve to a plain Textbox
      // client-side (apps/web's resolve-field-type.ts), which would be a
      // functional break, not a cosmetic one.
      const rawFields = await fetchFields(admin, "purchase", "header");
      expect(rawFields.find((f) => f.fieldKey === "invoice")?.fieldType).toBe("FileUpload");
      expect(rawFields.find((f) => f.fieldKey === "otherDocuments")?.fieldType).toBe("MultiUpload");

      // FR-101's server-assigned purchase number - same reasoning as
      // suppliers/supplier's "code" above.
      expect(rawFields.find((f) => f.fieldKey === "purchaseNumber")?.fieldType).toBe("AutoGenerated");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "purchase/po (Tier-2 Other Charges) still matches exactly - unchanged by this prompt",
    async () => {
      const admin = await seedTenantWithAdmin("fd-po", ["field_definitions.field.read"]);
      const fields = await fetchOrderedFields(admin, "purchase", "po");
      expect(fields).toEqual([
        { fieldKey: "freight", isMandatory: false },
        { fieldKey: "insurance", isMandatory: false },
        { fieldKey: "customs", isMandatory: false },
        { fieldKey: "otherCharges", isMandatory: false },
        { fieldKey: "otherCharges2", isMandatory: false },
        { fieldKey: "otherCharges3", isMandatory: false },
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "purchase/item matches purchase-handlers.ts's ITEM_FIELDS field-for-field",
    async () => {
      const admin = await seedTenantWithAdmin("fd-item", ["field_definitions.field.read"]);
      const fields = await fetchOrderedFields(admin, "purchase", "item");
      expect(fields).toEqual([
        { fieldKey: "itemId", isMandatory: true },
        { fieldKey: "gradeId", isMandatory: false },
        { fieldKey: "quantity", isMandatory: true },
        { fieldKey: "uomId", isMandatory: true },
        { fieldKey: "purchaseRateUsd", isMandatory: true },
        { fieldKey: "exchangeRate", isMandatory: true },
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "purchase/allocation matches purchase-handlers.ts's ALLOCATION_FIELDS, with reservedCustomerId sourced from the real customers master",
    async () => {
      const admin = await seedTenantWithAdmin("fd-allocation", ["field_definitions.field.read"]);
      const fields = await fetchOrderedFields(admin, "purchase", "allocation");
      expect(fields).toEqual([
        { fieldKey: "reservedCustomerId", isMandatory: true },
        { fieldKey: "allocationPct", isMandatory: true },
      ]);

      const rawFields = await fetchFields(admin, "purchase", "allocation");
      expect(rawFields.find((f) => f.fieldKey === "reservedCustomerId")?.optionsSource).toBe("masters:customers");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "purchase/lme_record matches purchase-handlers.ts's LME_RECORD_FIELDS field-for-field",
    async () => {
      const admin = await seedTenantWithAdmin("fd-lme", ["field_definitions.field.read"]);
      const fields = await fetchOrderedFields(admin, "purchase", "lme_record");
      expect(fields).toEqual([
        { fieldKey: "lmeExchangeId", isMandatory: true },
        { fieldKey: "metal", isMandatory: true },
        { fieldKey: "lmePriceUsd", isMandatory: true },
        { fieldKey: "fixingDate", isMandatory: true },
        { fieldKey: "agreedPremiumPct", isMandatory: true },
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "purchase/hedge matches purchase-handlers.ts's HEDGE_FIELDS field-for-field",
    async () => {
      const admin = await seedTenantWithAdmin("fd-hedge", ["field_definitions.field.read"]);
      const fields = await fetchOrderedFields(admin, "purchase", "hedge");
      expect(fields).toEqual([
        { fieldKey: "hedgePlatformId", isMandatory: true },
        { fieldKey: "contractNumber", isMandatory: true },
        { fieldKey: "position", isMandatory: true },
        { fieldKey: "quantity", isMandatory: true },
        { fieldKey: "rate", isMandatory: true },
        { fieldKey: "hedgeDate", isMandatory: true },
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  /**
   * The 5 (really 6 - masters/item.itemType was an undocumented 6th
   * offender the same bug class caught) static-enum select fields that
   * had no optionsSource at all - apps/web rendered an empty "No data"
   * dropdown for each. Asserted against the exact values apps/web/src/
   * mocks/admin-handlers.ts and purchase-handlers.ts already carry.
   */
  it(
    "admin/company.status and .fiscalYearStartMonth resolve their static optionsSource",
    async () => {
      const admin = await seedTenantWithAdmin("fd-company-static", ["field_definitions.field.read"]);
      const fields = await fetchFields(admin, "admin", "company");

      const status = fields.find((f) => f.fieldKey === "status");
      expect(status?.optionsSource).toEqual({
        type: "static",
        staticOptions: [
          { value: "active", label: "Active" },
          { value: "inactive", label: "Inactive" },
        ],
      });

      const fiscalYear = fields.find((f) => f.fieldKey === "fiscalYearStartMonth");
      const fiscalYearOptions = fiscalYear?.optionsSource;
      if (typeof fiscalYearOptions === "string" || !fiscalYearOptions) {
        throw new Error("expected fiscalYearStartMonth to have a static optionsSource object");
      }
      expect(fiscalYearOptions.staticOptions).toHaveLength(12);
      expect(fiscalYearOptions.staticOptions[0]).toEqual({ value: "1", label: "January" });
      expect(fiscalYearOptions.staticOptions[11]).toEqual({ value: "12", label: "December" });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "admin/branch.status resolves the same active/inactive optionsSource",
    async () => {
      const admin = await seedTenantWithAdmin("fd-branch-static", ["field_definitions.field.read"]);
      const fields = await fetchFields(admin, "admin", "branch");
      const status = fields.find((f) => f.fieldKey === "status");
      expect(status?.optionsSource).toEqual({
        type: "static",
        staticOptions: [
          { value: "active", label: "Active" },
          { value: "inactive", label: "Inactive" },
        ],
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "users/user.status resolves a labeled optionsSource even though the field is display-only (isEditable: false)",
    async () => {
      const admin = await seedTenantWithAdmin("fd-user-static", ["field_definitions.field.read"]);
      const fields = await fetchFields(admin, "users", "user");
      const status = fields.find((f) => f.fieldKey === "status");
      expect(status?.isEditable).toBe(false);
      expect(status?.optionsSource).toEqual({
        type: "static",
        staticOptions: [
          { value: "active", label: "Active" },
          { value: "inactive", label: "Inactive" },
        ],
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "masters/item.itemType resolves its metals/electronics/toys optionsSource (found by the same guard, not in the original bug report)",
    async () => {
      const admin = await seedTenantWithAdmin("fd-item-static", ["field_definitions.field.read"]);
      const fields = await fetchFields(admin, "masters", "item");
      const itemType = fields.find((f) => f.fieldKey === "itemType");
      expect(itemType?.optionsSource).toEqual({
        type: "static",
        staticOptions: [
          { value: "metals", label: "Metals" },
          { value: "electronics", label: "Electronics" },
          { value: "toys", label: "Toys" },
        ],
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "purchase/hedge.position resolves the buy/sell optionsSource - the Hedging Details drawer's Position field is no longer empty",
    async () => {
      const admin = await seedTenantWithAdmin("fd-hedge-static", ["field_definitions.field.read"]);
      const fields = await fetchFields(admin, "purchase", "hedge");
      const position = fields.find((f) => f.fieldKey === "position");
      expect(position?.optionsSource).toEqual({
        type: "enum",
        staticOptions: [
          { value: "buy", label: "Buy" },
          { value: "sell", label: "Sell" },
        ],
      });
    },
    TEST_TIMEOUT_MS,
  );
});
