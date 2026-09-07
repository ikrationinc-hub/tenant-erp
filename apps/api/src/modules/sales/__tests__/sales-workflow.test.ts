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
  sales,
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

const salesStatusSchema = z.object({ id: z.string(), status: z.enum(["draft", "approved", "closed", "cancelled"]) });

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

const ALL_SALES_AND_PURCHASE_PERMISSIONS = [
  "sales.order.create",
  "sales.order.read",
  "sales.order.update",
  "sales.order.approve",
  "sales.order.cancel",
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
  for (const key of ALL_SALES_AND_PURCHASE_PERMISSIONS) {
    const permissionId = await findPermissionId(tenant.schemaName, key);
    await grantPermissionToRole(tenant.schemaName, companyId, role.id, permissionId, userId);
  }

  const { token } = await signAccessToken({ sub: userId, tenant: tenant.id, company_id: companyId, roles: [], scope: "full" });

  return { schemaName: tenant.schemaName, companyId, userId, accessToken: token, salesRefs, itemRefs, purchaseRefs };
}

/** Real Purchase Receipt confirm - the only way stock_lots rows get created (inventory-subscriber.ts). Gives sales tests a real, row-lockable lot to reserve against. */
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

describe("modules/sales - S-3 (docs/SALES-MODULE-PLAN.md): Draft -> Approved reserves lots, Cancel releases them", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "approving a sales order reserves its picked lot - stock_lots.reservedQty increases exactly",
    async () => {
      const tenant = await seedTenant("approve-reserves");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const lotId = await createConfirmedReceiptLot(app, authHeader, tenant, "100");

      const salesId = await createDraftSales(app, authHeader, tenant);
      const itemId = await addSalesItem(app, authHeader, salesId, tenant, "40");
      await pickLot(app, authHeader, salesId, itemId, lotId, "40");

      const approveRes = await request(app).patch(`/api/v1/sales/${salesId}/approve`).set("Authorization", authHeader);
      expect(approveRes.status).toBe(200);
      expect(salesStatusSchema.parse(approveRes.body).status).toBe("approved");

      const [lot] = await withTenantSchema(tenant.schemaName, (tx) => tx.select().from(stockLots).where(eq(stockLots.id, lotId)));
      expect(lot?.reservedQty).toBe("40.000000");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "approving over-allocated picks fails with the reservation's own ConflictError, and rolls back the whole approval",
    async () => {
      const tenant = await seedTenant("approve-over-allocated");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const lotId = await createConfirmedReceiptLot(app, authHeader, tenant, "50");

      const salesId = await createDraftSales(app, authHeader, tenant);
      const itemId = await addSalesItem(app, authHeader, salesId, tenant, "50");
      // Draft-time pick check allows exactly 50 (all of it) - a SECOND sale
      // then races to reserve the SAME lot fully, so by the time THIS one
      // approves, nothing is left.
      await pickLot(app, authHeader, salesId, itemId, lotId, "50");

      const otherSalesId = await createDraftSales(app, authHeader, tenant);
      const otherItemId = await addSalesItem(app, authHeader, otherSalesId, tenant, "50");
      await pickLot(app, authHeader, otherSalesId, otherItemId, lotId, "50");
      const otherApprove = await request(app).patch(`/api/v1/sales/${otherSalesId}/approve`).set("Authorization", authHeader);
      expect(otherApprove.status).toBe(200);

      const approveRes = await request(app).patch(`/api/v1/sales/${salesId}/approve`).set("Authorization", authHeader);
      expect(approveRes.status).toBe(409);

      const stillDraft = salesStatusSchema.parse((await request(app).get(`/api/v1/sales/${salesId}`).set("Authorization", authHeader)).body);
      expect(stillDraft.status).toBe("draft");

      const [lot] = await withTenantSchema(tenant.schemaName, (tx) => tx.select().from(stockLots).where(eq(stockLots.id, lotId)));
      expect(lot?.reservedQty).toBe("50.000000");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "cancelling an approved sales order releases its reservation - stock_lots.reservedQty restores exactly",
    async () => {
      const tenant = await seedTenant("cancel-releases");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const lotId = await createConfirmedReceiptLot(app, authHeader, tenant, "100");

      const salesId = await createDraftSales(app, authHeader, tenant);
      const itemId = await addSalesItem(app, authHeader, salesId, tenant, "30");
      await pickLot(app, authHeader, salesId, itemId, lotId, "30");

      const approveRes = await request(app).patch(`/api/v1/sales/${salesId}/approve`).set("Authorization", authHeader);
      expect(approveRes.status).toBe(200);

      const [afterApprove] = await withTenantSchema(tenant.schemaName, (tx) => tx.select().from(stockLots).where(eq(stockLots.id, lotId)));
      expect(afterApprove?.reservedQty).toBe("30.000000");

      const cancelRes = await request(app).patch(`/api/v1/sales/${salesId}/cancel`).set("Authorization", authHeader);
      expect(cancelRes.status).toBe(200);
      expect(salesStatusSchema.parse(cancelRes.body).status).toBe("cancelled");

      const [afterCancel] = await withTenantSchema(tenant.schemaName, (tx) => tx.select().from(stockLots).where(eq(stockLots.id, lotId)));
      expect(afterCancel?.reservedQty).toBe("0.000000");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a draft sales order can be cancelled with nothing to release",
    async () => {
      const tenant = await seedTenant("cancel-draft");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const salesId = await createDraftSales(app, authHeader, tenant);

      const cancelRes = await request(app).patch(`/api/v1/sales/${salesId}/cancel`).set("Authorization", authHeader);
      expect(cancelRes.status).toBe(200);
      expect(salesStatusSchema.parse(cancelRes.body).status).toBe("cancelled");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "cannot cancel an already-cancelled sales order",
    async () => {
      const tenant = await seedTenant("cancel-terminal");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const salesId = await createDraftSales(app, authHeader, tenant);

      const first = await request(app).patch(`/api/v1/sales/${salesId}/cancel`).set("Authorization", authHeader);
      expect(first.status).toBe(200);

      const second = await request(app).patch(`/api/v1/sales/${salesId}/cancel`).set("Authorization", authHeader);
      expect(second.status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "cannot approve a sales order with no items",
    async () => {
      const tenant = await seedTenant("approve-empty");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const salesId = await createDraftSales(app, authHeader, tenant);

      const approveRes = await request(app).patch(`/api/v1/sales/${salesId}/approve`).set("Authorization", authHeader);
      expect(approveRes.status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "two concurrent approvals of the same sales order - exactly one succeeds",
    async () => {
      const tenant = await seedTenant("concurrent-approve");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const lotId = await createConfirmedReceiptLot(app, authHeader, tenant, "100");
      const salesId = await createDraftSales(app, authHeader, tenant);
      const itemId = await addSalesItem(app, authHeader, salesId, tenant, "20");
      await pickLot(app, authHeader, salesId, itemId, lotId, "20");

      const [first, second] = await Promise.all([
        request(app).patch(`/api/v1/sales/${salesId}/approve`).set("Authorization", authHeader),
        request(app).patch(`/api/v1/sales/${salesId}/approve`).set("Authorization", authHeader),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);

      const [salesRow] = await withTenantSchema(tenant.schemaName, (tx) => tx.select().from(sales).where(eq(sales.id, salesId)));
      expect(salesRow?.status).toBe("approved");

      // Exactly one reservation's worth (20), never double-reserved by a
      // race between the two concurrent approve() calls.
      const [lot] = await withTenantSchema(tenant.schemaName, (tx) => tx.select().from(stockLots).where(eq(stockLots.id, lotId)));
      expect(lot?.reservedQty).toBe("20.000000");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "approving a sales order writes NO stock movement - stock only moves on delivery (S-4, not built yet)",
    async () => {
      const tenant = await seedTenant("approve-no-movement");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const lotId = await createConfirmedReceiptLot(app, authHeader, tenant, "100");
      const salesId = await createDraftSales(app, authHeader, tenant);
      const itemId = await addSalesItem(app, authHeader, salesId, tenant, "10");
      await pickLot(app, authHeader, salesId, itemId, lotId, "10");

      const approveRes = await request(app).patch(`/api/v1/sales/${salesId}/approve`).set("Authorization", authHeader);
      expect(approveRes.status).toBe(200);

      const movements = await withTenantSchema(tenant.schemaName, (tx) =>
        tx.select().from(stockMovements).where(and(eq(stockMovements.companyId, tenant.companyId), eq(stockMovements.referenceType, "sales_order_item"))),
      );
      expect(movements).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "credit-limit warning appears in the approve response when this sale pushes outstanding receivables over the limit, but never blocks approval",
    async () => {
      const tenant = await seedTenant("credit-warning");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      // Lower the customer's credit limit to something this one sale
      // alone will exceed.
      await withTenantSchema(tenant.schemaName, (tx) =>
        tx.update(customers).set({ creditLimit: "1000.00" }).where(eq(customers.id, tenant.salesRefs.customerId)),
      );

      const lotId = await createConfirmedReceiptLot(app, authHeader, tenant, "100");
      const salesId = await createDraftSales(app, authHeader, tenant);
      const itemId = await addSalesItem(app, authHeader, salesId, tenant, "50"); // 50 x 9000 = 450,000 >> 1,000 limit
      await pickLot(app, authHeader, salesId, itemId, lotId, "50");

      const approveRes = await request(app).patch(`/api/v1/sales/${salesId}/approve`).set("Authorization", authHeader);
      expect(approveRes.status).toBe(200);
      const body = approveRes.body as { status: string; warnings?: string[] };
      expect(body.status).toBe("approved");
      expect(body.warnings?.length).toBeGreaterThan(0);
      expect(body.warnings?.[0]).toMatch(/outstanding receivables/);
    },
    TEST_TIMEOUT_MS,
  );
});
