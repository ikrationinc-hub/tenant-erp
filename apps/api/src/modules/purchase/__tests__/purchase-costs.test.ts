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
import { seedDefaultNumberSeries } from "../../../core/provisioning/seed-number-series.js";
import { assignRoleToUser, createRole, grantPermissionToRole } from "../../../core/rbac/mutations.js";
import { createTenantSchema } from "../../../core/tenant/provisioner.js";
import { closeTenantDbPool, withTenantSchema } from "../../../database/get-db.js";
import {
  branches,
  companies,
  countries,
  currencies,
  incoterms,
  paymentTerms,
  permissions,
  ports,
  purchases,
  suppliers,
  supplierTypes,
  transportModes,
  users,
  warehouses,
} from "../../../database/tenant/schema.js";

const TEST_TIMEOUT_MS = 120_000;

const costsRowSchema = z.object({
  id: z.string(),
  purchaseId: z.string(),
  freight: z.string(),
  insurance: z.string(),
  customs: z.string(),
  otherCharges: z.string(),
  otherCharges2: z.string(),
  otherCharges3: z.string(),
});

function asCosts(res: { body: unknown }) {
  return costsRowSchema.parse(res.body);
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
  tenantId: string;
  companyId: string;
  userId: string;
  accessToken: string;
  purchaseRefs: {
    branchId: string;
    buyerId: string;
    supplierId: string;
    transportModeId: string;
    portAId: string;
    portBId: string;
    warehouseId: string;
    incotermId: string;
  };
}

const ALL_PURCHASE_PERMISSIONS = ["purchase.po.create", "purchase.po.read", "purchase.po.update"];

async function seedTenant(label: string, extraPermissionKeys: string[] = []): Promise<SeededTenant> {
  const unique = randomUUID().slice(0, 8);
  const tenant = await createTenantSchema({ name: `${label} Co`, slug: `${label}-${unique}` });

  const { companyId, userId, purchaseRefs } = await withTenantSchema(tenant.schemaName, async (tx) => {
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

    const [branch] = await tx.insert(branches).values({ companyId: company.id, name: "Main Branch", code: "MAIN", createdBy: user.id }).returning();
    const [supplierType] = await tx.insert(supplierTypes).values({ companyId: company.id, code: "LOCAL", name: "Local", createdBy: user.id }).returning();
    const [country] = await tx.insert(countries).values({ companyId: company.id, code: "AE", name: "UAE", createdBy: user.id }).returning();
    const [paymentTerm] = await tx.insert(paymentTerms).values({ companyId: company.id, code: "NET30", name: "30 Days", createdBy: user.id }).returning();
    const [currency] = await tx.insert(currencies).values({ companyId: company.id, code: "USD", name: "US Dollar", createdBy: user.id }).returning();
    if (!branch || !supplierType || !country || !paymentTerm || !currency) {
      throw new Error("failed to insert prerequisite masters");
    }
    const [supplier] = await tx
      .insert(suppliers)
      .values({
        companyId: company.id,
        code: "SUP-0001",
        name: "Acme Metals Trading",
        supplierTypeId: supplierType.id,
        countryId: country.id,
        paymentTermId: paymentTerm.id,
        currencyId: currency.id,
        createdBy: user.id,
      })
      .returning();

    const [transportMode] = await tx.insert(transportModes).values({ companyId: company.id, code: "SEA", name: "Sea Freight", createdBy: user.id }).returning();
    const [portA] = await tx.insert(ports).values({ companyId: company.id, code: "JEA", name: "Jebel Ali", createdBy: user.id }).returning();
    const [portB] = await tx.insert(ports).values({ companyId: company.id, code: "SHA", name: "Shanghai", createdBy: user.id }).returning();
    const [warehouse] = await tx.insert(warehouses).values({ companyId: company.id, code: "WH1", name: "Main Warehouse", createdBy: user.id }).returning();
    const [incoterm] = await tx.insert(incoterms).values({ companyId: company.id, code: "CIF", name: "Cost, Insurance and Freight", createdBy: user.id }).returning();

    if (!supplier || !transportMode || !portA || !portB || !warehouse || !incoterm) {
      throw new Error("failed to insert prerequisite masters");
    }

    return {
      companyId: company.id,
      userId: user.id,
      purchaseRefs: {
        branchId: branch.id,
        buyerId: user.id,
        supplierId: supplier.id,
        transportModeId: transportMode.id,
        portAId: portA.id,
        portBId: portB.id,
        warehouseId: warehouse.id,
        incotermId: incoterm.id,
      },
    };
  });

  await seedDefaultNumberSeries({ schemaName: tenant.schemaName, companyId, createdBy: userId });
  await seedDefaultFieldDefinitions({ schemaName: tenant.schemaName, companyId, createdBy: userId });

  const role = await createRole({ schemaName: tenant.schemaName, companyId, name: `${label}-role`, createdBy: userId });
  await assignRoleToUser(tenant.schemaName, companyId, userId, role.id, userId);
  for (const key of [...ALL_PURCHASE_PERMISSIONS, ...extraPermissionKeys]) {
    const permissionId = await findPermissionId(tenant.schemaName, key);
    await grantPermissionToRole(tenant.schemaName, companyId, role.id, permissionId, userId);
  }

  const { token } = await signAccessToken({ sub: userId, tenant: tenant.id, company_id: companyId, roles: [], scope: "full" });

  return { schemaName: tenant.schemaName, tenantId: tenant.id, companyId, userId, accessToken: token, purchaseRefs };
}

async function createDraftPurchase(app: ReturnType<typeof createApp>, authHeader: string, tenant: SeededTenant): Promise<string> {
  const res = await request(app)
    .post("/api/v1/purchases")
    .set("Authorization", authHeader)
    .send({
      purchaseDate: "2024-06-15",
      branchId: tenant.purchaseRefs.branchId,
      buyerId: tenant.purchaseRefs.buyerId,
      supplierId: tenant.purchaseRefs.supplierId,
      shipment: {
        lotNumber: "LOT-1",
        containerNumber: "CONT-1",
        blNo: "BL-1",
        loadingDate: "2024-06-10",
        transportModeId: tenant.purchaseRefs.transportModeId,
        portOfLoadingId: tenant.purchaseRefs.portAId,
        portOfDischargeId: tenant.purchaseRefs.portBId,
        warehouseId: tenant.purchaseRefs.warehouseId,
        incotermId: tenant.purchaseRefs.incotermId,
      },
    });
  expect(res.status).toBe(201);
  return (res.body as { id: string }).id;
}

describe("modules/purchase - Record Purchase, session (c): additional costs (docs/spec/Purchase-V2.md Sub Tab 2, G)", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "user can set additional costs on a draft purchase, and a second PATCH updates the same row rather than inserting a new one",
    async () => {
      const tenant = await seedTenant("costs-upsert");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);

      const first = asCosts(
        await request(app).patch(`/api/v1/purchases/${purchaseId}/costs`).set("Authorization", authHeader).send({ freight: "1000", insurance: "250.50" }),
      );
      expect(first.freight).toBe("1000.00");
      expect(first.insurance).toBe("250.50");
      expect(first.customs).toBe("0.00");

      const second = asCosts(
        await request(app).patch(`/api/v1/purchases/${purchaseId}/costs`).set("Authorization", authHeader).send({ customs: "75" }),
      );
      // Same row - id unchanged, and the earlier fields survive an update that only touched `customs`.
      expect(second.id).toBe(first.id);
      expect(second.freight).toBe("1000.00");
      expect(second.insurance).toBe("250.50");
      expect(second.customs).toBe("75.00");

      const getRes = await request(app).get(`/api/v1/purchases/${purchaseId}`).set("Authorization", authHeader);
      expect((getRes.body as { additionalCosts: { id: string } }).additionalCosts.id).toBe(first.id);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a non-draft purchase rejects setting additional costs",
    async () => {
      const tenant = await seedTenant("immutable-costs");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);

      await withTenantSchema(tenant.schemaName, (tx) => tx.update(purchases).set({ status: "posted" }).where(eq(purchases.id, purchaseId)));

      const res = await request(app).patch(`/api/v1/purchases/${purchaseId}/costs`).set("Authorization", authHeader).send({ freight: "100" });
      expect(res.status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "renaming Other Charges via the field engine changes only the label, never the stored value or calculation",
    async () => {
      const tenant = await seedTenant("rename-other-charges", ["field_definitions.field.read", "field_definitions.field.update"]);
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);

      await request(app).patch(`/api/v1/purchases/${purchaseId}/costs`).set("Authorization", authHeader).send({ otherCharges: "500" });

      const fieldsBefore = await request(app).get("/api/v1/field-definitions/purchase/po").set("Authorization", authHeader);
      const otherChargesField = (fieldsBefore.body as { fields: { id: string; fieldKey: string; label: string }[] }).fields.find(
        (f) => f.fieldKey === "otherCharges",
      );
      expect(otherChargesField?.label).toBe("Other Charges");
      if (!otherChargesField?.id) {
        throw new Error("expected otherCharges to have a real provisioned field_definitions id");
      }

      const renameRes = await request(app)
        .patch(`/api/v1/field-definitions/${otherChargesField.id}`)
        .set("Authorization", authHeader)
        .send({ label: "Clearing Charges" });
      expect(renameRes.status).toBe(200);

      // The label changed...
      const fieldsAfter = await request(app).get("/api/v1/field-definitions/purchase/po").set("Authorization", authHeader);
      const renamedField = (fieldsAfter.body as { fields: { fieldKey: string; label: string }[] }).fields.find((f) => f.fieldKey === "otherCharges");
      expect(renamedField?.label).toBe("Clearing Charges");

      // ...but the purchase's stored value, column, and query are completely untouched.
      const getRes = await request(app).get(`/api/v1/purchases/${purchaseId}`).set("Authorization", authHeader);
      expect((getRes.body as { additionalCosts: { otherCharges: string } }).additionalCosts.otherCharges).toBe("500.00");
    },
    TEST_TIMEOUT_MS,
  );
});
