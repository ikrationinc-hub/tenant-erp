import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
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
  containers,
  countries,
  currencies,
  divisions,
  incoterms,
  items,
  lmeExchanges,
  marketPrices,
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

const lmeRecordSchema = z.object({
  id: z.string(),
  purchaseId: z.string(),
  lmeExchangeId: z.string(),
  marketPriceId: z.string(),
  metal: z.string(),
  lmeType: z.string(),
  lmePriceUsd: z.string(),
  fixingDate: z.string(),
  agreedPremiumPct: z.string(),
  finalPurchaseRateUsd: z.string(),
});

function asLmeRecord(res: { body: unknown }) {
  return lmeRecordSchema.parse(res.body);
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
    divisionId: string;
    branchId: string;
    buyerId: string;
    supplierId: string;
    transportModeId: string;
    portAId: string;
    portBId: string;
    warehouseId: string;
    incotermId: string;
    containerId: string;
  };
  lmeExchangeId: string;
  itemRefs: { itemId: string; uomId: string };
}

const ALL_PURCHASE_PERMISSIONS = ["purchase.po.create", "purchase.po.read", "purchase.po.update"];

async function seedTenant(label: string): Promise<SeededTenant> {
  const unique = randomUUID().slice(0, 8);
  const tenant = await createTenantSchema({ name: `${label} Co`, slug: `${label}-${unique}` });

  const { companyId, userId, purchaseRefs, lmeExchangeId, itemRefs } = await withTenantSchema(tenant.schemaName, async (tx) => {
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
    const [lmeExchange] = await tx.insert(lmeExchanges).values({ companyId: company.id, code: "LME", name: "London Metal Exchange", createdBy: user.id }).returning();
    const [division] = await tx.insert(divisions).values({ companyId: company.id, code: "CONTAINER", name: "Container", createdBy: user.id }).returning();
    const [container] = await tx.insert(containers).values({ companyId: company.id, code: "CONT-1", name: "CONT-1", createdBy: user.id }).returning();
    const [item] = await tx.insert(items).values({ companyId: company.id, code: "CU-CATH", name: "Copper Cathode", itemType: "metals", createdBy: user.id }).returning();
    const [unit] = await tx.insert(uom).values({ companyId: company.id, code: "MT", name: "Metric Ton", createdBy: user.id }).returning();

    if (!supplier || !transportMode || !portA || !portB || !warehouse || !incoterm || !lmeExchange || !division || !container || !item || !unit) {
      throw new Error("failed to insert prerequisite masters");
    }

    return {
      companyId: company.id,
      userId: user.id,
      purchaseRefs: {
        divisionId: division.id,
        branchId: branch.id,
        buyerId: company.id, // buyer names a company, not a user (client correction)
        supplierId: supplier.id,
        transportModeId: transportMode.id,
        portAId: portA.id,
        portBId: portB.id,
        warehouseId: warehouse.id,
        incotermId: incoterm.id,
        containerId: container.id,
      },
      lmeExchangeId: lmeExchange.id,
      itemRefs: { itemId: item.id, uomId: unit.id },
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

  return { schemaName: tenant.schemaName, companyId, userId, accessToken: token, purchaseRefs, lmeExchangeId, itemRefs };
}

async function createDraftPurchase(app: ReturnType<typeof createApp>, authHeader: string, tenant: SeededTenant): Promise<string> {
  const res = await request(app)
    .post("/api/v1/purchases")
    .set("Authorization", authHeader)
    .send({
      purchaseDate: "2024-06-15",
      divisionId: tenant.purchaseRefs.divisionId,
      pricingType: "lme",
      branchId: tenant.purchaseRefs.branchId,
      buyerId: tenant.purchaseRefs.buyerId,
      supplierId: tenant.purchaseRefs.supplierId,
      shipment: {
        lotNumber: "LOT-1",
        containerId: tenant.purchaseRefs.containerId,
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

async function addLmeRecord(
  app: ReturnType<typeof createApp>,
  authHeader: string,
  purchaseId: string,
  tenant: SeededTenant,
  overrides: Partial<{ lmePriceUsd: string; agreedPremiumPct: string }> = {},
) {
  const res = await request(app)
    .post(`/api/v1/purchases/${purchaseId}/lme-records`)
    .set("Authorization", authHeader)
    .send({
      lmeExchangeId: tenant.lmeExchangeId,
      metal: "Copper",
      lmeType: "close",
      lmePriceUsd: "8400",
      fixingDate: "2024-06-01",
      agreedPremiumPct: "2",
      ...overrides,
    });
  expect(res.status).toBe(201);
  return asLmeRecord(res);
}

/** pricing_type is always "lme" on this file's purchases (createDraftPurchase) - purchaseRateUsd is never sent, same as resolveItemRate requires. */
async function addItem(app: ReturnType<typeof createApp>, authHeader: string, purchaseId: string, tenant: SeededTenant, quantity: string): Promise<string> {
  const res = await request(app)
    .post(`/api/v1/purchases/${purchaseId}/items`)
    .set("Authorization", authHeader)
    .send({ itemId: tenant.itemRefs.itemId, quantity, uomId: tenant.itemRefs.uomId, exchangeRate: "3.6725" });
  expect(res.status).toBe(201);
  return (res.body as { id: string }).id;
}

describe("modules/purchase - Platform Hedging / LME Records, session (d): LME pricing (docs/spec/Purchase-V2.md Sub Tab 3, A)", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "FR-201/FR-202: records an LME purchase price and fixing date, going through market_prices first - never straight onto the transaction",
    async () => {
      const tenant = await seedTenant("fr201-202");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);

      const res = await request(app)
        .post(`/api/v1/purchases/${purchaseId}/lme-records`)
        .set("Authorization", authHeader)
        .send({ lmeExchangeId: tenant.lmeExchangeId, metal: "Copper", lmeType: "close", lmePriceUsd: "8432.75", fixingDate: "2024-06-12", agreedPremiumPct: "2.35" });

      expect(res.status).toBe(201);
      const record = asLmeRecord(res);
      expect(record.lmePriceUsd).toBe("8432.750000");
      expect(record.fixingDate).toBe("2024-06-12");
      // The metal recorded on market_prices is also snapshotted directly
      // onto the lme_record itself - the UI's LME Records table renders
      // this column straight off this row (dataIndex: "metal"), it never
      // joins back to market_prices to resolve it.
      expect(record.metal).toBe("Copper");

      // The price actually landed in the immutable ledger first.
      const [marketPrice] = await withTenantSchema(tenant.schemaName, (tx) =>
        tx.select().from(marketPrices).where(and(eq(marketPrices.id, record.marketPriceId), eq(marketPrices.companyId, tenant.companyId))),
      );
      expect(marketPrice?.source).toBe("manual");
      expect(marketPrice?.price).toBe("8432.750000");
      expect(marketPrice?.metal).toBe("Copper");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "FR-203: Final Purchase Rate = LME Price x (Agreed% / 100), a DIRECT multiplier - not a markup added on top",
    async () => {
      const tenant = await seedTenant("fr203");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      async function recordFinalRate(lmePriceUsd: string, agreedPremiumPct: string): Promise<string> {
        const purchaseId = await createDraftPurchase(app, authHeader, tenant);
        const record = asLmeRecord(
          await request(app)
            .post(`/api/v1/purchases/${purchaseId}/lme-records`)
            .set("Authorization", authHeader)
            .send({ lmeExchangeId: tenant.lmeExchangeId, metal: "Copper", lmeType: "close", lmePriceUsd, fixingDate: "2024-06-12", agreedPremiumPct }),
        );
        return record.finalPurchaseRateUsd;
      }

      // The client's own examples: agreed% below 100 lands BELOW the LME
      // price (not an error), agreed% above 100 lands above it - neither
      // is a markup calculation.
      expect(await recordFinalRate("100", "98")).toBe("98.000000");
      expect(await recordFinalRate("100", "104")).toBe("104.000000");

      // A realistic figure, full precision, no float drift:
      // 8432.75 x (98.5 / 100) = 8306.25875 (fits numeric(18,6) exactly).
      expect(await recordFinalRate("8432.75", "98.5")).toBe("8306.258750");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "an LME record can be added even after the purchase has been issued (resolved open question #6 - not gated by draft status)",
    async () => {
      const tenant = await seedTenant("post-issue-lme");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);

      await withTenantSchema(tenant.schemaName, (tx) => tx.update(purchases).set({ status: "issued" }).where(eq(purchases.id, purchaseId)));

      const res = await request(app)
        .post(`/api/v1/purchases/${purchaseId}/lme-records`)
        .set("Authorization", authHeader)
        .send({ lmeExchangeId: tenant.lmeExchangeId, metal: "Copper", lmeType: "close", lmePriceUsd: "8500", fixingDate: "2024-07-01", agreedPremiumPct: "2" });
      expect(res.status).toBe(201);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "multiple LME records can be recorded against the same purchase (a provisional fixing, then a final one)",
    async () => {
      const tenant = await seedTenant("provisional-final");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);

      await request(app)
        .post(`/api/v1/purchases/${purchaseId}/lme-records`)
        .set("Authorization", authHeader)
        .send({ lmeExchangeId: tenant.lmeExchangeId, metal: "Copper", lmeType: "close", lmePriceUsd: "8400", fixingDate: "2024-06-01", agreedPremiumPct: "2" });
      await request(app)
        .post(`/api/v1/purchases/${purchaseId}/lme-records`)
        .set("Authorization", authHeader)
        .send({ lmeExchangeId: tenant.lmeExchangeId, metal: "Copper", lmeType: "close", lmePriceUsd: "8450", fixingDate: "2024-06-20", agreedPremiumPct: "2" });

      const getRes = await request(app).get(`/api/v1/purchases/${purchaseId}`).set("Authorization", authHeader);
      const records = (getRes.body as { lmeRecords: unknown[] }).lmeRecords;
      expect(records).toHaveLength(2);
    },
    TEST_TIMEOUT_MS,
  );

  describe("Prompt 23: edit/remove - locked once used by an item, otherwise free (not gated by the purchase's own status)", () => {
    it(
      "GET /purchases/:id reports isUsed: false for an unused record",
      async () => {
        const tenant = await seedTenant("lme-unused-flag");
        const app = createApp();
        const authHeader = `Bearer ${tenant.accessToken}`;
        const purchaseId = await createDraftPurchase(app, authHeader, tenant);
        await addLmeRecord(app, authHeader, purchaseId, tenant);

        const res = await request(app).get(`/api/v1/purchases/${purchaseId}`).set("Authorization", authHeader);
        const records = (res.body as { lmeRecords: Array<{ isUsed: boolean }> }).lmeRecords;
        expect(records[0]?.isUsed).toBe(false);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "editing an unused record re-records into market_prices and recomputes the final rate",
      async () => {
        const tenant = await seedTenant("lme-edit-unused");
        const app = createApp();
        const authHeader = `Bearer ${tenant.accessToken}`;
        const purchaseId = await createDraftPurchase(app, authHeader, tenant);
        const record = await addLmeRecord(app, authHeader, purchaseId, tenant, { lmePriceUsd: "8400", agreedPremiumPct: "2" });

        const res = await request(app)
          .patch(`/api/v1/purchases/${purchaseId}/lme-records/${record.id}`)
          .set("Authorization", authHeader)
          .send({
            lmeExchangeId: tenant.lmeExchangeId,
            metal: "Copper",
            lmeType: "close",
            lmePriceUsd: "100",
            fixingDate: "2024-06-05",
            agreedPremiumPct: "98",
          });
        expect(res.status).toBe(200);
        const updated = asLmeRecord(res);
        // The client's own example - 100 x (98/100) = 98, exactly.
        expect(updated.finalPurchaseRateUsd).toBe("98.000000");
        expect(updated.fixingDate).toBe("2024-06-05");
        // A fresh market_prices row, not the original one mutated.
        expect(updated.marketPriceId).not.toBe(record.marketPriceId);
        const [marketPrice] = await withTenantSchema(tenant.schemaName, (tx) =>
          tx.select().from(marketPrices).where(and(eq(marketPrices.id, updated.marketPriceId), eq(marketPrices.companyId, tenant.companyId))),
        );
        expect(marketPrice?.price).toBe("100.000000");
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "removing an unused record soft-deletes it - it disappears from GET /purchases/:id",
      async () => {
        const tenant = await seedTenant("lme-remove-unused");
        const app = createApp();
        const authHeader = `Bearer ${tenant.accessToken}`;
        const purchaseId = await createDraftPurchase(app, authHeader, tenant);
        const record = await addLmeRecord(app, authHeader, purchaseId, tenant);

        const deleteRes = await request(app).delete(`/api/v1/purchases/${purchaseId}/lme-records/${record.id}`).set("Authorization", authHeader);
        expect(deleteRes.status).toBe(204);

        const getRes = await request(app).get(`/api/v1/purchases/${purchaseId}`).set("Authorization", authHeader);
        const records = (getRes.body as { lmeRecords: Array<{ id: string }> }).lmeRecords;
        expect(records.some((r) => r.id === record.id)).toBe(false);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "once an item has snapshotted a record's rate, editing or removing that record is rejected - and GET reports isUsed: true",
      async () => {
        const tenant = await seedTenant("lme-locked-once-used");
        const app = createApp();
        const authHeader = `Bearer ${tenant.accessToken}`;
        const purchaseId = await createDraftPurchase(app, authHeader, tenant);
        const record = await addLmeRecord(app, authHeader, purchaseId, tenant);
        await addItem(app, authHeader, purchaseId, tenant, "10");

        const getRes = await request(app).get(`/api/v1/purchases/${purchaseId}`).set("Authorization", authHeader);
        const records = (getRes.body as { lmeRecords: Array<{ id: string; isUsed: boolean }> }).lmeRecords;
        expect(records.find((r) => r.id === record.id)?.isUsed).toBe(true);

        const editRes = await request(app)
          .patch(`/api/v1/purchases/${purchaseId}/lme-records/${record.id}`)
          .set("Authorization", authHeader)
          .send({ lmeExchangeId: tenant.lmeExchangeId, metal: "Copper", lmeType: "close", lmePriceUsd: "9000", fixingDate: "2024-06-10", agreedPremiumPct: "3" });
        expect(editRes.status).toBe(409);

        const deleteRes = await request(app).delete(`/api/v1/purchases/${purchaseId}/lme-records/${record.id}`).set("Authorization", authHeader);
        expect(deleteRes.status).toBe(409);

        // The lock is per-record, not per-purchase - a SECOND, still-unused record on the same purchase is untouched.
        const secondRecord = await addLmeRecord(app, authHeader, purchaseId, tenant, { lmePriceUsd: "8600", agreedPremiumPct: "3" });
        const secondEditRes = await request(app)
          .patch(`/api/v1/purchases/${purchaseId}/lme-records/${secondRecord.id}`)
          .set("Authorization", authHeader)
          .send({ lmeExchangeId: tenant.lmeExchangeId, metal: "Copper", lmeType: "close", lmePriceUsd: "8700", fixingDate: "2024-06-11", agreedPremiumPct: "3" });
        expect(secondEditRes.status).toBe(200);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "editing/removing an unused record is allowed even on an Issued purchase (not gated by the purchase's own status)",
      async () => {
        const tenant = await seedTenant("lme-edit-post-issue");
        const app = createApp();
        const authHeader = `Bearer ${tenant.accessToken}`;
        const purchaseId = await createDraftPurchase(app, authHeader, tenant);
        const record = await addLmeRecord(app, authHeader, purchaseId, tenant);

        await withTenantSchema(tenant.schemaName, (tx) => tx.update(purchases).set({ status: "issued" }).where(eq(purchases.id, purchaseId)));

        const editRes = await request(app)
          .patch(`/api/v1/purchases/${purchaseId}/lme-records/${record.id}`)
          .set("Authorization", authHeader)
          .send({ lmeExchangeId: tenant.lmeExchangeId, metal: "Copper", lmeType: "close", lmePriceUsd: "8600", fixingDate: "2024-06-15", agreedPremiumPct: "3" });
        expect(editRes.status).toBe(200);
      },
      TEST_TIMEOUT_MS,
    );
  });
});
