import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
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
  paymentTerms,
  permissions,
  ports,
  stockLots,
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
}

const ALL_PURCHASE_PERMISSIONS = [
  "purchase.po.create",
  "purchase.po.read",
  "purchase.po.update",
  "purchase.po.issue",
  "purchase.po.cancel",
  "purchase.receipt.create",
  "purchase.receipt.confirm",
];

async function seedTenant(label: string): Promise<SeededTenant> {
  const unique = randomUUID().slice(0, 8);
  const tenant = await createTenantSchema({ name: `${label} Co`, slug: `${label}-${unique}` });

  const { companyId, userId, purchaseRefs, itemRefs } = await withTenantSchema(tenant.schemaName, async (tx) => {
    const [company] = await tx
      .insert(companies)
      .values({ name: `${label} Co`, fiscalYearStartMonth: 1, timezone: "America/New_York", createdBy: randomUUID() })
      .returning();
    if (!company) throw new Error("failed to insert company");
    const [user] = await tx
      .insert(users)
      .values({ companyId: company.id, email: `${label}-${unique}@example.com`, name: `${label} Admin`, status: "active", createdBy: randomUUID() })
      .returning();
    if (!user) throw new Error("failed to insert user");

    const [branch] = await tx.insert(branches).values({ companyId: company.id, name: "Main Branch", code: "MAIN", createdBy: user.id }).returning();
    const [supplierType] = await tx.insert(supplierTypes).values({ companyId: company.id, code: "LOCAL", name: "Local", createdBy: user.id }).returning();
    const [country] = await tx.insert(countries).values({ companyId: company.id, code: "AE", name: "UAE", createdBy: user.id }).returning();
    const [paymentTerm] = await tx.insert(paymentTerms).values({ companyId: company.id, code: "NET30", name: "30 Days", createdBy: user.id }).returning();
    const [currency] = await tx.insert(currencies).values({ companyId: company.id, code: "USD", name: "US Dollar", createdBy: user.id }).returning();
    if (!branch || !supplierType || !country || !paymentTerm || !currency) throw new Error("failed to insert prerequisite masters");
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
    const [division] = await tx.insert(divisions).values({ companyId: company.id, code: "CONTAINER", name: "Container", createdBy: user.id }).returning();
    const [container] = await tx.insert(containers).values({ companyId: company.id, code: "CONT-1", name: "CONT-1", createdBy: user.id }).returning();

    if (!supplier || !transportMode || !portA || !portB || !warehouse || !incoterm || !item || !unit || !division || !container) {
      throw new Error("failed to insert prerequisite masters");
    }

    return {
      companyId: company.id,
      userId: user.id,
      purchaseRefs: {
        divisionId: division.id,
        branchId: branch.id,
        buyerId: company.id,
        supplierId: supplier.id,
        transportModeId: transportMode.id,
        portAId: portA.id,
        portBId: portB.id,
        warehouseId: warehouse.id,
        incotermId: incoterm.id,
        containerId: container.id,
      },
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

  return { schemaName: tenant.schemaName, companyId, userId, accessToken: token, purchaseRefs, itemRefs };
}

describe("modules/inventory - S-2 receipt-confirm landed-rate computation", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "a purchase WITH a purchase_additional_costs row: stock_lots.landedRate = purchaseRateUsd + this line's pro-rata (by qty) share of freight+insurance+customs+other",
    async () => {
      const tenant = await seedTenant("landed-rate-with-costs");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const createRes = await request(app)
        .post("/api/v1/purchases")
        .set("Authorization", authHeader)
        .send({
          purchaseDate: "2024-06-15",
          divisionId: tenant.purchaseRefs.divisionId,
          pricingType: "fixed",
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
      expect(createRes.status).toBe(201);
      const purchaseId = (createRes.body as { id: string }).id;

      // Single item line, qty 100 @ purchaseRateUsd 8000.
      const itemRes = await request(app)
        .post(`/api/v1/purchases/${purchaseId}/items`)
        .set("Authorization", authHeader)
        .send({ itemId: tenant.itemRefs.itemId, quantity: "100", uomId: tenant.itemRefs.uomId, purchaseRateUsd: "8000", exchangeRate: "3.6725" });
      expect(itemRes.status).toBe(201);
      const purchaseItemId = (itemRes.body as { id: string }).id;

      // freight 300 + insurance 100 + customs 50 + other(0+0+0) = 450 total, single line absorbs it all -> +4.50/unit.
      const costsRes = await request(app)
        .patch(`/api/v1/purchases/${purchaseId}/costs`)
        .set("Authorization", authHeader)
        .send({ freight: "300", insurance: "100", customs: "50" });
      expect(costsRes.status).toBe(200);

      await request(app).patch(`/api/v1/purchases/${purchaseId}/issue`).set("Authorization", authHeader);

      const receiptRes = await request(app)
        .post(`/api/v1/purchases/${purchaseId}/receipts`)
        .set("Authorization", authHeader)
        .send({ receiptDate: "2024-06-20", warehouseId: tenant.purchaseRefs.warehouseId, items: [{ purchaseItemId, receivedQuantity: "100" }] });
      expect(receiptRes.status).toBe(201);
      const receiptId = (receiptRes.body as { id: string }).id;

      const confirmRes = await request(app).patch(`/api/v1/purchases/${purchaseId}/receipts/${receiptId}/confirm`).set("Authorization", authHeader);
      expect(confirmRes.status).toBe(200);

      const [lot] = await withTenantSchema(tenant.schemaName, (tx) =>
        tx.select().from(stockLots).where(and(eq(stockLots.receiptId, receiptId), eq(stockLots.purchaseItemId, purchaseItemId))),
      );
      expect(lot).toBeDefined();
      // 8000 + 450/100 = 8000 + 4.5 = 8004.5
      expect(lot?.landedRate).toBe("8004.500000");
      expect(lot?.receivedQty).toBe("100.000000");
      expect(lot?.reservedQty).toBe("0.000000");
      expect(lot?.deliveredQty).toBe("0.000000");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a purchase with NO purchase_additional_costs row: stock_lots.landedRate equals the raw purchaseRateUsd - never an error",
    async () => {
      const tenant = await seedTenant("landed-rate-no-costs");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const createRes = await request(app)
        .post("/api/v1/purchases")
        .set("Authorization", authHeader)
        .send({
          purchaseDate: "2024-06-15",
          divisionId: tenant.purchaseRefs.divisionId,
          pricingType: "fixed",
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
      expect(createRes.status).toBe(201);
      const purchaseId = (createRes.body as { id: string }).id;

      const itemRes = await request(app)
        .post(`/api/v1/purchases/${purchaseId}/items`)
        .set("Authorization", authHeader)
        .send({ itemId: tenant.itemRefs.itemId, quantity: "50", uomId: tenant.itemRefs.uomId, purchaseRateUsd: "7500", exchangeRate: "3.6725" });
      expect(itemRes.status).toBe(201);
      const purchaseItemId = (itemRes.body as { id: string }).id;

      // No PATCH .../costs call at all - no purchase_additional_costs row exists for this purchase.
      await request(app).patch(`/api/v1/purchases/${purchaseId}/issue`).set("Authorization", authHeader);

      const receiptRes = await request(app)
        .post(`/api/v1/purchases/${purchaseId}/receipts`)
        .set("Authorization", authHeader)
        .send({ receiptDate: "2024-06-20", warehouseId: tenant.purchaseRefs.warehouseId, items: [{ purchaseItemId, receivedQuantity: "50" }] });
      expect(receiptRes.status).toBe(201);
      const receiptId = (receiptRes.body as { id: string }).id;

      const confirmRes = await request(app).patch(`/api/v1/purchases/${purchaseId}/receipts/${receiptId}/confirm`).set("Authorization", authHeader);
      expect(confirmRes.status).toBe(200);

      const [lot] = await withTenantSchema(tenant.schemaName, (tx) =>
        tx.select().from(stockLots).where(and(eq(stockLots.receiptId, receiptId), eq(stockLots.purchaseItemId, purchaseItemId))),
      );
      expect(lot).toBeDefined();
      expect(lot?.landedRate).toBe("7500.000000");
    },
    TEST_TIMEOUT_MS,
  );
});
