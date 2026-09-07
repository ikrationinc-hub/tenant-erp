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
  customerTypes,
  customers,
  divisions,
  incoterms,
  items,
  paymentTerms,
  permissions,
  ports,
  stockLots,
  stockMovements,
  supplierTypes,
  suppliers,
  transportModes,
  uom,
  users,
  warehouses,
} from "../../../database/tenant/schema.js";

const TEST_TIMEOUT_MS = 120_000;

const deliveryStatusSchema = z.object({ id: z.string(), status: z.enum(["draft", "confirmed", "reversed"]) });

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
  salesRefs: {
    divisionId: string;
    branchId: string;
    sellerId: string;
    customerId: string;
    transportModeId: string;
    portAId: string;
    portBId: string;
    warehouseId: string;
    incotermId: string;
    containerId: string;
  };
  itemRefs: { itemId: string; uomId: string };
  purchaseRefs: { supplierId: string };
}

const ALL_PERMISSIONS = [
  "sales.order.create",
  "sales.order.read",
  "sales.order.update",
  "sales.order.approve",
  "sales.order.cancel",
  "sales.delivery.create",
  "sales.delivery.confirm",
  "purchase.po.create",
  "purchase.po.read",
  "purchase.po.update",
  "purchase.po.issue",
  "purchase.receipt.create",
  "purchase.receipt.confirm",
];

async function seedTenant(label: string): Promise<SeededTenant> {
  const unique = randomUUID().slice(0, 8);
  const tenant = await createTenantSchema({ name: `${label} Co`, slug: `${label}-${unique}` });

  const { companyId, userId, salesRefs, itemRefs, purchaseRefs } = await withTenantSchema(tenant.schemaName, async (tx) => {
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
    const [customerType] = await tx.insert(customerTypes).values({ companyId: company.id, code: "LOCAL", name: "Local", createdBy: user.id }).returning();
    const [country] = await tx.insert(countries).values({ companyId: company.id, code: "AE", name: "UAE", createdBy: user.id }).returning();
    const [paymentTerm] = await tx.insert(paymentTerms).values({ companyId: company.id, code: "NET30", name: "30 Days", createdBy: user.id }).returning();
    const [currency] = await tx.insert(currencies).values({ companyId: company.id, code: "USD", name: "US Dollar", createdBy: user.id }).returning();
    if (!branch || !supplierType || !customerType || !country || !paymentTerm || !currency) {
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
    const [customer] = await tx
      .insert(customers)
      .values({
        companyId: company.id,
        code: "CUS-0001",
        name: "Northgate Metals",
        customerTypeId: customerType.id,
        countryId: country.id,
        paymentTermId: paymentTerm.id,
        currencyId: currency.id,
        creditLimit: "1000000.00",
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

    if (!supplier || !customer || !transportMode || !portA || !portB || !warehouse || !incoterm || !item || !unit || !division || !container) {
      throw new Error("failed to insert prerequisite masters");
    }

    return {
      companyId: company.id,
      userId: user.id,
      salesRefs: {
        divisionId: division.id,
        branchId: branch.id,
        sellerId: company.id,
        customerId: customer.id,
        transportModeId: transportMode.id,
        portAId: portA.id,
        portBId: portB.id,
        warehouseId: warehouse.id,
        incotermId: incoterm.id,
        containerId: container.id,
      },
      itemRefs: { itemId: item.id, uomId: unit.id },
      purchaseRefs: { supplierId: supplier.id },
    };
  });

  await seedDefaultNumberSeries({ schemaName: tenant.schemaName, companyId, createdBy: userId });

  const role = await createRole({ schemaName: tenant.schemaName, companyId, name: `${label}-role`, createdBy: userId });
  await assignRoleToUser(tenant.schemaName, companyId, userId, role.id, userId);
  for (const key of ALL_PERMISSIONS) {
    const permissionId = await findPermissionId(tenant.schemaName, key);
    await grantPermissionToRole(tenant.schemaName, companyId, role.id, permissionId, userId);
  }

  const { token } = await signAccessToken({ sub: userId, tenant: tenant.id, company_id: companyId, roles: [], scope: "full" });

  return { schemaName: tenant.schemaName, companyId, userId, accessToken: token, salesRefs, itemRefs, purchaseRefs };
}

async function createConfirmedReceiptLot(app: ReturnType<typeof createApp>, authHeader: string, tenant: SeededTenant, quantity: string): Promise<string> {
  const poRes = await request(app)
    .post("/api/v1/purchases")
    .set("Authorization", authHeader)
    .send({
      purchaseDate: "2024-06-01",
      divisionId: tenant.salesRefs.divisionId,
      pricingType: "fixed",
      branchId: tenant.salesRefs.branchId,
      buyerId: tenant.salesRefs.sellerId,
      supplierId: tenant.purchaseRefs.supplierId,
      shipment: {
        lotNumber: "PLOT-1",
        containerId: tenant.salesRefs.containerId,
        blNo: "PBL-1",
        loadingDate: "2024-05-25",
        transportModeId: tenant.salesRefs.transportModeId,
        portOfLoadingId: tenant.salesRefs.portAId,
        portOfDischargeId: tenant.salesRefs.portBId,
        warehouseId: tenant.salesRefs.warehouseId,
        incotermId: tenant.salesRefs.incotermId,
      },
    });
  expect(poRes.status).toBe(201);
  const purchaseId = (poRes.body as { id: string }).id;

  const itemRes = await request(app)
    .post(`/api/v1/purchases/${purchaseId}/items`)
    .set("Authorization", authHeader)
    .send({ itemId: tenant.itemRefs.itemId, quantity, uomId: tenant.itemRefs.uomId, purchaseRateUsd: "8000", exchangeRate: "3.6725" });
  expect(itemRes.status).toBe(201);
  const purchaseItemId = (itemRes.body as { id: string }).id;

  const issueRes = await request(app).patch(`/api/v1/purchases/${purchaseId}/issue`).set("Authorization", authHeader);
  expect(issueRes.status).toBe(200);

  const receiptRes = await request(app)
    .post(`/api/v1/purchases/${purchaseId}/receipts`)
    .set("Authorization", authHeader)
    .send({ receiptDate: "2024-06-05", warehouseId: tenant.salesRefs.warehouseId, items: [{ purchaseItemId, receivedQuantity: quantity }] });
  expect(receiptRes.status).toBe(201);
  const receiptId = (receiptRes.body as { id: string }).id;

  const confirmRes = await request(app).patch(`/api/v1/purchases/${purchaseId}/receipts/${receiptId}/confirm`).set("Authorization", authHeader);
  expect(confirmRes.status).toBe(200);

  const [lot] = await withTenantSchema(tenant.schemaName, (tx) =>
    tx.select().from(stockLots).where(and(eq(stockLots.companyId, tenant.companyId), eq(stockLots.receiptId, receiptId))),
  );
  if (!lot) {
    throw new Error("expected a stock_lots row to exist after receipt confirmation");
  }
  return lot.id;
}

async function createDraftSales(app: ReturnType<typeof createApp>, authHeader: string, tenant: SeededTenant): Promise<string> {
  const res = await request(app)
    .post("/api/v1/sales")
    .set("Authorization", authHeader)
    .send({
      salesDate: "2024-06-15",
      divisionId: tenant.salesRefs.divisionId,
      pricingType: "fixed",
      branchId: tenant.salesRefs.branchId,
      sellerId: tenant.salesRefs.sellerId,
      customerId: tenant.salesRefs.customerId,
      shipment: {
        lotNumber: "SLOT-1",
        containerId: tenant.salesRefs.containerId,
        blNo: "SBL-1",
        loadingDate: "2024-06-10",
        transportModeId: tenant.salesRefs.transportModeId,
        portOfLoadingId: tenant.salesRefs.portAId,
        portOfDischargeId: tenant.salesRefs.portBId,
        warehouseId: tenant.salesRefs.warehouseId,
        incotermId: tenant.salesRefs.incotermId,
      },
    });
  expect(res.status).toBe(201);
  return (res.body as { id: string }).id;
}

async function addSalesItem(app: ReturnType<typeof createApp>, authHeader: string, salesId: string, tenant: SeededTenant, quantity: string): Promise<string> {
  const res = await request(app)
    .post(`/api/v1/sales/${salesId}/items`)
    .set("Authorization", authHeader)
    .send({ itemId: tenant.itemRefs.itemId, quantity, uomId: tenant.itemRefs.uomId, salesRateUsd: "9000", exchangeRate: "3.6725" });
  expect(res.status).toBe(201);
  return (res.body as { id: string }).id;
}

async function pickLot(app: ReturnType<typeof createApp>, authHeader: string, salesId: string, itemId: string, stockLotId: string, qty: string): Promise<void> {
  const res = await request(app)
    .post(`/api/v1/sales/${salesId}/items/${itemId}/lots`)
    .set("Authorization", authHeader)
    .send({ stockLotId, qty });
  expect(res.status).toBe(201);
}

/** Full happy path: draft sales -> item -> pick lot -> approve (reserves) -> returns a ready-to-deliver sales+item pair. */
async function setupApprovedSales(
  app: ReturnType<typeof createApp>,
  authHeader: string,
  tenant: SeededTenant,
  lotQty: string,
  itemQty: string,
): Promise<{ salesId: string; itemId: string; lotId: string }> {
  const lotId = await createConfirmedReceiptLot(app, authHeader, tenant, lotQty);
  const salesId = await createDraftSales(app, authHeader, tenant);
  const itemId = await addSalesItem(app, authHeader, salesId, tenant, itemQty);
  await pickLot(app, authHeader, salesId, itemId, lotId, itemQty);
  const approveRes = await request(app).patch(`/api/v1/sales/${salesId}/approve`).set("Authorization", authHeader);
  expect(approveRes.status).toBe(200);
  return { salesId, itemId, lotId };
}

describe("modules/sales - S-4 (docs/SALES-MODULE-PLAN.md): Delivery consumes reservation -> stock out", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "confirming a delivery converts the reservation to an outbound stock_movements row, in the same transaction as the status change",
    async () => {
      const tenant = await seedTenant("confirm-moves-stock");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const { salesId, itemId, lotId } = await setupApprovedSales(app, authHeader, tenant, "100", "40");

      const createRes = await request(app)
        .post(`/api/v1/sales/${salesId}/deliveries`)
        .set("Authorization", authHeader)
        .send({ dispatchDate: "2024-06-20", warehouseId: tenant.salesRefs.warehouseId, items: [{ salesItemId: itemId, deliveredQuantity: "40" }] });
      expect(createRes.status).toBe(201);
      const deliveryId = (createRes.body as { id: string }).id;

      const confirmRes = await request(app).patch(`/api/v1/sales/${salesId}/deliveries/${deliveryId}/confirm`).set("Authorization", authHeader);
      expect(confirmRes.status).toBe(200);
      expect(deliveryStatusSchema.parse(confirmRes.body).status).toBe("confirmed");

      const movements = await withTenantSchema(tenant.schemaName, (tx) =>
        tx.select().from(stockMovements).where(and(eq(stockMovements.companyId, tenant.companyId), eq(stockMovements.movementType, "sale_delivery"))),
      );
      expect(movements).toHaveLength(1);
      expect(movements[0]?.quantity).toBe("-40.000000");

      const [lot] = await withTenantSchema(tenant.schemaName, (tx) => tx.select().from(stockLots).where(eq(stockLots.id, lotId)));
      expect(lot?.deliveredQty).toBe("40.000000");
      expect(lot?.reservedQty).toBe("0.000000");

      const getRes = await request(app).get(`/api/v1/sales/${salesId}`).set("Authorization", authHeader);
      const body = getRes.body as { deliveredStatus: string; realized: boolean };
      expect(body.deliveredStatus).toBe("fully_delivered");
      expect(body.realized).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "partial delivery leaves deliveredStatus partial and the remainder still reserved; a second delivery completes it",
    async () => {
      const tenant = await seedTenant("partial-delivery");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const { salesId, itemId, lotId } = await setupApprovedSales(app, authHeader, tenant, "100", "100");

      const firstCreate = await request(app)
        .post(`/api/v1/sales/${salesId}/deliveries`)
        .set("Authorization", authHeader)
        .send({ dispatchDate: "2024-06-20", warehouseId: tenant.salesRefs.warehouseId, items: [{ salesItemId: itemId, deliveredQuantity: "60" }] });
      expect(firstCreate.status).toBe(201);
      const firstDeliveryId = (firstCreate.body as { id: string }).id;
      const firstConfirm = await request(app).patch(`/api/v1/sales/${salesId}/deliveries/${firstDeliveryId}/confirm`).set("Authorization", authHeader);
      expect(firstConfirm.status).toBe(200);

      const midGet = await request(app).get(`/api/v1/sales/${salesId}`).set("Authorization", authHeader);
      const midBody = midGet.body as { deliveredStatus: string; realized: boolean };
      expect(midBody.deliveredStatus).toBe("partial");
      expect(midBody.realized).toBe(true);

      const [afterFirst] = await withTenantSchema(tenant.schemaName, (tx) => tx.select().from(stockLots).where(eq(stockLots.id, lotId)));
      expect(afterFirst?.reservedQty).toBe("40.000000");
      expect(afterFirst?.deliveredQty).toBe("60.000000");

      const secondCreate = await request(app)
        .post(`/api/v1/sales/${salesId}/deliveries`)
        .set("Authorization", authHeader)
        .send({ dispatchDate: "2024-06-25", warehouseId: tenant.salesRefs.warehouseId, items: [{ salesItemId: itemId, deliveredQuantity: "40" }] });
      expect(secondCreate.status).toBe(201);
      const secondDeliveryId = (secondCreate.body as { id: string }).id;
      const secondConfirm = await request(app).patch(`/api/v1/sales/${salesId}/deliveries/${secondDeliveryId}/confirm`).set("Authorization", authHeader);
      expect(secondConfirm.status).toBe(200);

      const finalGet = await request(app).get(`/api/v1/sales/${salesId}`).set("Authorization", authHeader);
      const finalBody = finalGet.body as { deliveredStatus: string };
      expect(finalBody.deliveredStatus).toBe("fully_delivered");

      const [afterSecond] = await withTenantSchema(tenant.schemaName, (tx) => tx.select().from(stockLots).where(eq(stockLots.id, lotId)));
      expect(afterSecond?.reservedQty).toBe("0.000000");
      expect(afterSecond?.deliveredQty).toBe("100.000000");

      const movements = await withTenantSchema(tenant.schemaName, (tx) =>
        tx.select().from(stockMovements).where(and(eq(stockMovements.companyId, tenant.companyId), eq(stockMovements.movementType, "sale_delivery"))),
      );
      expect(movements).toHaveLength(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "cannot deliver more than reserved - the create-time guard rejects it",
    async () => {
      const tenant = await seedTenant("over-deliver");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const { salesId, itemId } = await setupApprovedSales(app, authHeader, tenant, "100", "30");

      const createRes = await request(app)
        .post(`/api/v1/sales/${salesId}/deliveries`)
        .set("Authorization", authHeader)
        .send({ dispatchDate: "2024-06-20", warehouseId: tenant.salesRefs.warehouseId, items: [{ salesItemId: itemId, deliveredQuantity: "31" }] });
      expect(createRes.status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "cannot deliver against a Draft sales order",
    async () => {
      const tenant = await seedTenant("deliver-against-draft");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const lotId = await createConfirmedReceiptLot(app, authHeader, tenant, "100");
      const salesId = await createDraftSales(app, authHeader, tenant);
      const itemId = await addSalesItem(app, authHeader, salesId, tenant, "20");
      await pickLot(app, authHeader, salesId, itemId, lotId, "20");

      const createRes = await request(app)
        .post(`/api/v1/sales/${salesId}/deliveries`)
        .set("Authorization", authHeader)
        .send({ dispatchDate: "2024-06-20", warehouseId: tenant.salesRefs.warehouseId, items: [{ salesItemId: itemId, deliveredQuantity: "20" }] });
      expect(createRes.status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "cannot deliver against a Cancelled sales order",
    async () => {
      const tenant = await seedTenant("deliver-against-cancelled");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const { salesId, itemId } = await setupApprovedSales(app, authHeader, tenant, "100", "20");

      const cancelRes = await request(app).patch(`/api/v1/sales/${salesId}/cancel`).set("Authorization", authHeader);
      expect(cancelRes.status).toBe(200);

      const createRes = await request(app)
        .post(`/api/v1/sales/${salesId}/deliveries`)
        .set("Authorization", authHeader)
        .send({ dispatchDate: "2024-06-20", warehouseId: tenant.salesRefs.warehouseId, items: [{ salesItemId: itemId, deliveredQuantity: "20" }] });
      expect(createRes.status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "no stock_movements row is ever mutated - append-only, even across two deliveries against the same sale",
    async () => {
      const tenant = await seedTenant("append-only");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const { salesId, itemId } = await setupApprovedSales(app, authHeader, tenant, "100", "100");

      const firstCreate = await request(app)
        .post(`/api/v1/sales/${salesId}/deliveries`)
        .set("Authorization", authHeader)
        .send({ dispatchDate: "2024-06-20", warehouseId: tenant.salesRefs.warehouseId, items: [{ salesItemId: itemId, deliveredQuantity: "50" }] });
      const firstDeliveryId = (firstCreate.body as { id: string }).id;
      await request(app).patch(`/api/v1/sales/${salesId}/deliveries/${firstDeliveryId}/confirm`).set("Authorization", authHeader);

      const afterFirst = await withTenantSchema(tenant.schemaName, (tx) =>
        tx.select().from(stockMovements).where(and(eq(stockMovements.companyId, tenant.companyId), eq(stockMovements.movementType, "sale_delivery"))),
      );
      expect(afterFirst).toHaveLength(1);
      const firstMovementSnapshot = { ...afterFirst[0] };

      const secondCreate = await request(app)
        .post(`/api/v1/sales/${salesId}/deliveries`)
        .set("Authorization", authHeader)
        .send({ dispatchDate: "2024-06-25", warehouseId: tenant.salesRefs.warehouseId, items: [{ salesItemId: itemId, deliveredQuantity: "50" }] });
      const secondDeliveryId = (secondCreate.body as { id: string }).id;
      await request(app).patch(`/api/v1/sales/${salesId}/deliveries/${secondDeliveryId}/confirm`).set("Authorization", authHeader);

      const afterSecond = await withTenantSchema(tenant.schemaName, (tx) =>
        tx.select().from(stockMovements).where(and(eq(stockMovements.companyId, tenant.companyId), eq(stockMovements.movementType, "sale_delivery"))),
      );
      expect(afterSecond).toHaveLength(2);
      expect(afterSecond.find((m) => m.id === firstMovementSnapshot.id)).toEqual(firstMovementSnapshot);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "gapless numbering under 20 concurrent creates - no duplicate, no gap in deliveryOrderNo",
    async () => {
      const tenant = await seedTenant("gapless-delivery-numbering");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const lotId = await createConfirmedReceiptLot(app, authHeader, tenant, "1000");
      const salesId = await createDraftSales(app, authHeader, tenant);
      const itemId = await addSalesItem(app, authHeader, salesId, tenant, "1000");
      await pickLot(app, authHeader, salesId, itemId, lotId, "1000");
      const approveRes = await request(app).patch(`/api/v1/sales/${salesId}/approve`).set("Authorization", authHeader);
      expect(approveRes.status).toBe(200);

      const CONCURRENCY = 20;
      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, (_, i) =>
          request(app)
            .post(`/api/v1/sales/${salesId}/deliveries`)
            .set("Authorization", authHeader)
            .send({ dispatchDate: "2024-06-20", warehouseId: tenant.salesRefs.warehouseId, items: [{ salesItemId: itemId, deliveredQuantity: "1" }] })
            .then((res) => ({ i, res })),
        ),
      );

      const succeeded = results.filter(({ res }) => res.status === 201);
      expect(succeeded).toHaveLength(CONCURRENCY);

      const numbers = succeeded.map(({ res }) => (res.body as { deliveryOrderNo: string }).deliveryOrderNo);
      expect(new Set(numbers).size).toBe(CONCURRENCY);

      const suffixes = numbers.map((n) => Number(n.split("-").pop())).sort((a, b) => a - b);
      for (let i = 1; i < suffixes.length; i++) {
        expect(suffixes[i]).toBe((suffixes[i - 1] ?? 0) + 1);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
