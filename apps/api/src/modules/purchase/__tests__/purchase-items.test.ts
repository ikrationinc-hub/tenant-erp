import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../../../app.js";
import { closeDbPool } from "../../../config/db.js";
import { closeRedis } from "../../../config/redis.js";
import { signAccessToken } from "../../../core/auth/jwt.js";
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
  itemGrades,
  items,
  paymentTerms,
  permissions,
  ports,
  purchases,
  suppliers,
  supplierTypes,
  transportModes,
  uom,
  users,
  warehouses,
} from "../../../database/tenant/schema.js";

const TEST_TIMEOUT_MS = 120_000;

const pricingSchema = z.object({
  purchaseRateUsd: z.string(),
  purchaseAmountUsd: z.string(),
  exchangeRate: z.string(),
  purchaseAmountAed: z.string(),
});

const itemRowSchema = z.object({
  id: z.string(),
  purchaseId: z.string(),
  itemId: z.string(),
  gradeId: z.string().nullable().optional(),
  quantity: z.string(),
  uomId: z.string(),
  pricing: pricingSchema,
});

function asItem(res: { body: unknown }) {
  return itemRowSchema.parse(res.body);
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
  itemRefs: { itemId: string; gradeId: string; uomId: string };
}

const ALL_PURCHASE_PERMISSIONS = ["purchase.po.create", "purchase.po.read", "purchase.po.update"];

async function seedTenant(label: string): Promise<SeededTenant> {
  const unique = randomUUID().slice(0, 8);
  const tenant = await createTenantSchema({ name: `${label} Co`, slug: `${label}-${unique}` });

  const { companyId, userId, purchaseRefs, itemRefs } = await withTenantSchema(tenant.schemaName, async (tx) => {
    const [company] = await tx
      .insert(companies)
      .values({ name: `${label} Co`, countryCode: "US", currencyCode: "USD", fiscalYearStartMonth: 1, timezone: "America/New_York", createdBy: randomUUID() })
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
    if (!supplierType || !country || !paymentTerm || !currency) {
      throw new Error("failed to insert supplier prerequisite masters");
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

    const [item] = await tx.insert(items).values({ companyId: company.id, code: "CU-CATH", name: "Copper Cathode", itemType: "metals", createdBy: user.id }).returning();
    const [grade] = await tx.insert(itemGrades).values({ companyId: company.id, code: "A", name: "Grade A", createdBy: user.id }).returning();
    const [unit] = await tx.insert(uom).values({ companyId: company.id, code: "MT", name: "Metric Ton", createdBy: user.id }).returning();

    if (!branch || !supplier || !transportMode || !portA || !portB || !warehouse || !incoterm || !item || !grade || !unit) {
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
      itemRefs: { itemId: item.id, gradeId: grade.id, uomId: unit.id },
    };
  });

  await seedDefaultNumberSeries({ schemaName: tenant.schemaName, companyId, createdBy: userId });

  const role = await createRole({ schemaName: tenant.schemaName, companyId, name: `${label}-role`, createdBy: userId });
  await assignRoleToUser(tenant.schemaName, companyId, userId, role.id, userId);
  for (const key of ALL_PURCHASE_PERMISSIONS) {
    const permissionId = await findPermissionId(tenant.schemaName, key);
    await grantPermissionToRole(tenant.schemaName, companyId, role.id, permissionId, userId);
  }

  const { token } = await signAccessToken({ sub: userId, tenant: tenant.id, company_id: companyId, roles: [], scope: "full" });

  return { schemaName: tenant.schemaName, companyId, userId, accessToken: token, purchaseRefs, itemRefs };
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

describe("modules/purchase - Record Purchase, session (b): items + pricing (docs/spec/Purchase-V2.md Sub Tab 2, D-E)", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "FR-104: user can add one or multiple purchase items to a purchase",
    async () => {
      const tenant = await seedTenant("fr104");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);

      const first = asItem(
        await request(app)
          .post(`/api/v1/purchases/${purchaseId}/items`)
          .set("Authorization", authHeader)
          .send({
            itemId: tenant.itemRefs.itemId,
            gradeId: tenant.itemRefs.gradeId,
            quantity: "100",
            uomId: tenant.itemRefs.uomId,
            purchaseRateUsd: "8000",
            exchangeRate: "3.6725",
          }),
      );
      const second = asItem(
        await request(app)
          .post(`/api/v1/purchases/${purchaseId}/items`)
          .set("Authorization", authHeader)
          .send({
            itemId: tenant.itemRefs.itemId,
            quantity: "50",
            uomId: tenant.itemRefs.uomId,
            purchaseRateUsd: "8100",
            exchangeRate: "3.6725",
          }),
      );

      expect(first.id).not.toBe(second.id);

      const getRes = await request(app).get(`/api/v1/purchases/${purchaseId}`).set("Authorization", authHeader);
      expect(getRes.status).toBe(200);
      const items = (getRes.body as { items: unknown[] }).items;
      expect(items).toHaveLength(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "FR-105/FR-106: purchase_amount_usd = quantity x purchase_rate_usd, purchase_amount_aed = purchase_amount_usd x exchange_rate",
    async () => {
      const tenant = await seedTenant("fr105-106");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);

      const item = asItem(
        await request(app)
          .post(`/api/v1/purchases/${purchaseId}/items`)
          .set("Authorization", authHeader)
          .send({
            itemId: tenant.itemRefs.itemId,
            quantity: "10",
            uomId: tenant.itemRefs.uomId,
            purchaseRateUsd: "100.50",
            exchangeRate: "3.6725",
          }),
      );

      // FR-105: 10 x 100.50 = 1005.00
      expect(item.pricing.purchaseAmountUsd).toBe("1005.00");
      // FR-106: 1005.00 x 3.6725 = 3690.8625 -> rounds to 3690.86 (half up)
      expect(item.pricing.purchaseAmountAed).toBe("3690.86");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "THE MONEY TEST: 500 MT x $8,630.919625 (LME price 8,432.75 marked up 2.35%) x 3.6725 AED, exact to the fils",
    async () => {
      const tenant = await seedTenant("money-test");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);

      const item = asItem(
        await request(app)
          .post(`/api/v1/purchases/${purchaseId}/items`)
          .set("Authorization", authHeader)
          .send({
            itemId: tenant.itemRefs.itemId,
            quantity: "500",
            uomId: tenant.itemRefs.uomId,
            // 8432.75 x (1 + 2.35/100) = 8630.919625 - FR-203's own calculation
            // (session (d), not yet wired) is pre-applied here by hand; this
            // test exercises FR-105/FR-106 against an already-marked-up rate.
            purchaseRateUsd: "8630.919625",
            exchangeRate: "3.6725",
          }),
      );

      expect(item.pricing.purchaseRateUsd).toBe("8630.919625");
      // FR-105: 500 x 8630.919625 = 4315459.8125 -> 4315459.81
      expect(item.pricing.purchaseAmountUsd).toBe("4315459.81");
      // FR-106: 4315459.8125 (full precision, not the rounded 4315459.81) x
      // 3.6725 = 15848526.16140625 -> 15848526.16
      expect(item.pricing.purchaseAmountAed).toBe("15848526.16");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "user can edit a draft purchase item, and FR-105/FR-106 recompute from the new values",
    async () => {
      const tenant = await seedTenant("edit-item");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);

      const item = asItem(
        await request(app)
          .post(`/api/v1/purchases/${purchaseId}/items`)
          .set("Authorization", authHeader)
          .send({ itemId: tenant.itemRefs.itemId, quantity: "10", uomId: tenant.itemRefs.uomId, purchaseRateUsd: "100", exchangeRate: "3.6725" }),
      );

      const updateRes = await request(app)
        .patch(`/api/v1/purchases/${purchaseId}/items/${item.id}`)
        .set("Authorization", authHeader)
        .send({ quantity: "20" });
      expect(updateRes.status).toBe(200);
      const updated = asItem(updateRes);
      expect(updated.quantity).toBe("20.000000");
      // Recomputed against the NEW quantity, not the original.
      expect(updated.pricing.purchaseAmountUsd).toBe("2000.00");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a non-draft purchase rejects adding or editing items",
    async () => {
      const tenant = await seedTenant("immutable-items");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);

      const item = asItem(
        await request(app)
          .post(`/api/v1/purchases/${purchaseId}/items`)
          .set("Authorization", authHeader)
          .send({ itemId: tenant.itemRefs.itemId, quantity: "10", uomId: tenant.itemRefs.uomId, purchaseRateUsd: "100", exchangeRate: "3.6725" }),
      );

      await withTenantSchema(tenant.schemaName, (tx) => tx.update(purchases).set({ status: "posted" }).where(eq(purchases.id, purchaseId)));

      const addRes = await request(app)
        .post(`/api/v1/purchases/${purchaseId}/items`)
        .set("Authorization", authHeader)
        .send({ itemId: tenant.itemRefs.itemId, quantity: "5", uomId: tenant.itemRefs.uomId, purchaseRateUsd: "100", exchangeRate: "3.6725" });
      expect(addRes.status).toBe(409);

      const editRes = await request(app)
        .patch(`/api/v1/purchases/${purchaseId}/items/${item.id}`)
        .set("Authorization", authHeader)
        .send({ quantity: "999" });
      expect(editRes.status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );
});
