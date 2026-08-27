import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../../app.js";
import { closeDbPool } from "../../../config/db.js";
import { closeRedis } from "../../../config/redis.js";
import { seedDefaultNumberSeries } from "../../../core/provisioning/seed-number-series.js";
import { signAccessToken } from "../../../core/auth/jwt.js";
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
  lmeRecords,
  paymentTerms,
  permissions,
  ports,
  purchasePricing,
  suppliers,
  supplierTypes,
  transportModes,
  uom,
  users,
  warehouses,
} from "../../../database/tenant/schema.js";

const TEST_TIMEOUT_MS = 120_000;

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
  itemRefs: { itemId: string; uomId: string };
  lmeExchangeId: string;
}

const ALL_PURCHASE_PERMISSIONS = [
  "purchase.po.create",
  "purchase.po.read",
  "purchase.po.update",
  "purchase.po.issue",
  "purchase.po.cancel",
  "brokers.broker.create",
];

async function seedTenant(label: string): Promise<SeededTenant> {
  const unique = randomUUID().slice(0, 8);
  const tenant = await createTenantSchema({ name: `${label} Co`, slug: `${label}-${unique}` });

  const { companyId, userId, purchaseRefs, itemRefs, lmeExchangeId } = await withTenantSchema(tenant.schemaName, async (tx) => {
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
    const [item] = await tx.insert(items).values({ companyId: company.id, code: "CU-CATH", name: "Copper Cathode", itemType: "metals", createdBy: user.id }).returning();
    const [unit] = await tx.insert(uom).values({ companyId: company.id, code: "MT", name: "Metric Ton", createdBy: user.id }).returning();
    const [lmeExchange] = await tx.insert(lmeExchanges).values({ companyId: company.id, code: "LME", name: "London Metal Exchange", createdBy: user.id }).returning();
    const [division] = await tx.insert(divisions).values({ companyId: company.id, code: "CONTAINER", name: "Container", createdBy: user.id }).returning();
    const [container] = await tx.insert(containers).values({ companyId: company.id, code: "CONT-1", name: "CONT-1", createdBy: user.id }).returning();

    if (!supplier || !transportMode || !portA || !portB || !warehouse || !incoterm || !item || !unit || !lmeExchange || !division || !container) {
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
      itemRefs: { itemId: item.id, uomId: unit.id },
      lmeExchangeId: lmeExchange.id,
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

  return { schemaName: tenant.schemaName, companyId, userId, accessToken: token, purchaseRefs, itemRefs, lmeExchangeId };
}

async function createDraftPurchase(app: ReturnType<typeof createApp>, authHeader: string, tenant: SeededTenant, pricingType: "lme" | "fixed"): Promise<string> {
  const res = await request(app)
    .post("/api/v1/purchases")
    .set("Authorization", authHeader)
    .send({
      purchaseDate: "2024-06-15",
      divisionId: tenant.purchaseRefs.divisionId,
      pricingType,
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

async function addLmeRecord(app: ReturnType<typeof createApp>, authHeader: string, purchaseId: string, tenant: SeededTenant): Promise<string> {
  const res = await request(app)
    .post(`/api/v1/purchases/${purchaseId}/lme-records`)
    .set("Authorization", authHeader)
    .send({ lmeExchangeId: tenant.lmeExchangeId, metal: "Copper", lmeType: "close", lmePriceUsd: "8200", fixingDate: "2024-06-12", agreedPremiumPct: "2.5" });
  expect(res.status).toBe(201);
  return (res.body as { finalPurchaseRateUsd: string }).finalPurchaseRateUsd;
}

describe("modules/purchase - Prompt 21 item 2: pricing_type drives item rate (lme = derived, fixed = manual)", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "under pricing_type='lme', adding an item before any LME record exists is rejected",
    async () => {
      const tenant = await seedTenant("lme-no-record");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant, "lme");

      const res = await request(app)
        .post(`/api/v1/purchases/${purchaseId}/items`)
        .set("Authorization", authHeader)
        .send({ itemId: tenant.itemRefs.itemId, quantity: "10", uomId: tenant.itemRefs.uomId, exchangeRate: "3.6725" });

      expect(res.status).toBe(422);
      expect((res.body as { error: { message: string } }).error.message).toContain("Add an LME record");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "under pricing_type='lme', a client-supplied purchaseRateUsd is rejected outright, not silently overridden",
    async () => {
      const tenant = await seedTenant("lme-client-rate");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant, "lme");
      await addLmeRecord(app, authHeader, purchaseId, tenant);

      const res = await request(app)
        .post(`/api/v1/purchases/${purchaseId}/items`)
        .set("Authorization", authHeader)
        .send({ itemId: tenant.itemRefs.itemId, quantity: "10", uomId: tenant.itemRefs.uomId, purchaseRateUsd: "9999", exchangeRate: "3.6725" });

      expect(res.status).toBe(422);
      expect((res.body as { error: { message: string } }).error.message).toContain("derived from the LME final rate");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "under pricing_type='lme', the item rate is auto-filled from the LME record's final rate",
    async () => {
      const tenant = await seedTenant("lme-autofill");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant, "lme");
      const finalPurchaseRateUsd = await addLmeRecord(app, authHeader, purchaseId, tenant);

      const res = await request(app)
        .post(`/api/v1/purchases/${purchaseId}/items`)
        .set("Authorization", authHeader)
        .send({ itemId: tenant.itemRefs.itemId, quantity: "10", uomId: tenant.itemRefs.uomId, exchangeRate: "3.6725" });

      expect(res.status).toBe(201);
      expect((res.body as { pricing: { purchaseRateUsd: string } }).pricing.purchaseRateUsd).toBe(finalPurchaseRateUsd);

      // Approve succeeds: valid item + an LME record both satisfied.
      const approveRes = await request(app).patch(`/api/v1/purchases/${purchaseId}/issue`).set("Authorization", authHeader);
      expect(approveRes.status).toBe(200);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "under pricing_type='lme', Approve is rejected without an LME record even though the guard's item checks would otherwise pass",
    async () => {
      const tenant = await seedTenant("lme-approve-guard");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant, "lme");
      await addLmeRecord(app, authHeader, purchaseId, tenant);
      const itemRes = await request(app)
        .post(`/api/v1/purchases/${purchaseId}/items`)
        .set("Authorization", authHeader)
        .send({ itemId: tenant.itemRefs.itemId, quantity: "10", uomId: tenant.itemRefs.uomId, exchangeRate: "3.6725" });
      expect(itemRes.status).toBe(201);

      // Directly remove the LME record the item was derived from, to
      // isolate the approve-time guard from the item-creation-time guard -
      // proves the two are independently enforced, not the same check.
      // purchase_pricing.lme_record_id (Prompt 23) FK-restricts a hard
      // delete of a referenced lme_records row - null it out first, same
      // as the app itself never hard-deletes an lme_record but this test
      // deliberately does, to reach a state the app can't otherwise produce.
      await withTenantSchema(tenant.schemaName, (tx) => tx.update(purchasePricing).set({ lmeRecordId: null }).where(eq(purchasePricing.companyId, tenant.companyId)));
      await withTenantSchema(tenant.schemaName, (tx) => tx.delete(lmeRecords).where(eq(lmeRecords.purchaseId, purchaseId)));

      const approveRes = await request(app).patch(`/api/v1/purchases/${purchaseId}/issue`).set("Authorization", authHeader);
      expect(approveRes.status).toBe(409);
      expect((approveRes.body as { error: { message: string } }).error.message).toBe(
        "Cannot issue: LME pricing requires at least one LME record",
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "under pricing_type='fixed', the item rate is manual as before - unaffected by any of the above",
    async () => {
      const tenant = await seedTenant("fixed-manual");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant, "fixed");

      const res = await request(app)
        .post(`/api/v1/purchases/${purchaseId}/items`)
        .set("Authorization", authHeader)
        .send({ itemId: tenant.itemRefs.itemId, quantity: "10", uomId: tenant.itemRefs.uomId, purchaseRateUsd: "8000", exchangeRate: "3.6725" });

      expect(res.status).toBe(201);
      expect((res.body as { pricing: { purchaseRateUsd: string } }).pricing.purchaseRateUsd).toBe("8000.000000");

      const approveRes = await request(app).patch(`/api/v1/purchases/${purchaseId}/issue`).set("Authorization", authHeader);
      expect(approveRes.status).toBe(200);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    // Prompt 21 item 4: broker_commission is money (rule 1) - stored via
    // parseMoney/roundAmount at the repository boundary, never the raw
    // client string, never a float. Asserting the RETURNED value is a
    // fixed-scale decimal STRING (never a JS number) is the closest a
    // black-box HTTP test can get to proving no float ever touched it.
    "a purchase's broker and broker_commission are optional, and the commission is stored as a fixed-scale decimal string",
    async () => {
      const tenant = await seedTenant("broker-commission");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const brokerRes = await request(app)
        .post("/api/v1/brokers")
        .set("Authorization", authHeader)
        .send({ name: "Commission Broker LLC" });
      expect(brokerRes.status).toBe(201);
      const brokerId = (brokerRes.body as { id: string }).id;

      const purchaseRes = await request(app)
        .post("/api/v1/purchases")
        .set("Authorization", authHeader)
        .send({
          purchaseDate: "2024-06-15",
          divisionId: tenant.purchaseRefs.divisionId,
          pricingType: "fixed",
          branchId: tenant.purchaseRefs.branchId,
          buyerId: tenant.purchaseRefs.buyerId,
          supplierId: tenant.purchaseRefs.supplierId,
          brokerId,
          brokerCommission: "1250.5",
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

      expect(purchaseRes.status).toBe(201);
      const body = purchaseRes.body as { brokerId: string; brokerCommission: string };
      expect(body.brokerId).toBe(brokerId);
      expect(typeof body.brokerCommission).toBe("string");
      expect(body.brokerCommission).toBe("1250.50");

      // A purchase without a broker at all is just as valid - "not every deal has a broker".
      const noBrokerId = await createDraftPurchase(app, authHeader, tenant, "fixed");
      const getRes = await request(app).get(`/api/v1/purchases/${noBrokerId}`).set("Authorization", authHeader);
      expect((getRes.body as { brokerId: string | null }).brokerId).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "lmeType is required on an LME record",
    async () => {
      const tenant = await seedTenant("lme-type-required");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant, "lme");

      const res = await request(app)
        .post(`/api/v1/purchases/${purchaseId}/lme-records`)
        .set("Authorization", authHeader)
        .send({ lmeExchangeId: tenant.lmeExchangeId, metal: "Copper", lmePriceUsd: "8200", fixingDate: "2024-06-12", agreedPremiumPct: "2.5" });

      expect(res.status).toBe(422);
    },
    TEST_TIMEOUT_MS,
  );
});
