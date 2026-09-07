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
  customerTypes,
  customers,
  divisions,
  incoterms,
  items,
  paymentTerms,
  permissions,
  ports,
  salesDashboardCountryBreakdown,
  salesDashboardCustomerBreakdown,
  salesDashboardItemBreakdown,
  stockLots,
  supplierTypes,
  suppliers,
  transportModes,
  uom,
  users,
  warehouses,
} from "../../../database/tenant/schema.js";
import { periodMonthOf, refreshSalesDashboardForCompany } from "../sales-dashboard-refresh.js";

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
  "sales.invoice.create",
  "sales.invoice.update",
  "sales.invoice.approve",
  "sales.receipt.record",
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

describe("core/reporting - S-6 (docs/SALES-MODULE-PLAN.md): Sales Performance Dashboard refresh", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "computes correct KPIs from seeded sales/delivery/invoice/payment data for the sale's own month",
    async () => {
      const tenant = await seedTenant("dashboard-kpis");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      // A full happy path: 40 units received, sold at 9000/unit (=360,000
      // revenue), bought at 8000/unit (=320,000 cost, no shared charges),
      // so gross profit should come out to exactly 40,000.
      const lotId = await createConfirmedReceiptLot(app, authHeader, tenant, "40");

      const salesRes = await request(app)
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
      expect(salesRes.status).toBe(201);
      const salesId = (salesRes.body as { id: string }).id;

      const itemRes = await request(app)
        .post(`/api/v1/sales/${salesId}/items`)
        .set("Authorization", authHeader)
        .send({ itemId: tenant.itemRefs.itemId, quantity: "40", uomId: tenant.itemRefs.uomId, salesRateUsd: "9000", exchangeRate: "3.6725" });
      expect(itemRes.status).toBe(201);
      const itemId = (itemRes.body as { id: string }).id;

      const pickRes = await request(app)
        .post(`/api/v1/sales/${salesId}/items/${itemId}/lots`)
        .set("Authorization", authHeader)
        .send({ stockLotId: lotId, qty: "40" });
      expect(pickRes.status).toBe(201);

      const approveRes = await request(app).patch(`/api/v1/sales/${salesId}/approve`).set("Authorization", authHeader);
      expect(approveRes.status).toBe(200);

      const deliveryCreateRes = await request(app)
        .post(`/api/v1/sales/${salesId}/deliveries`)
        .set("Authorization", authHeader)
        .send({ dispatchDate: "2024-06-20", warehouseId: tenant.salesRefs.warehouseId, items: [{ salesItemId: itemId, deliveredQuantity: "40" }] });
      expect(deliveryCreateRes.status).toBe(201);
      const deliveryId = (deliveryCreateRes.body as { id: string }).id;
      const deliveryConfirmRes = await request(app).patch(`/api/v1/sales/${salesId}/deliveries/${deliveryId}/confirm`).set("Authorization", authHeader);
      expect(deliveryConfirmRes.status).toBe(200);

      const invoiceCreateRes = await request(app)
        .post(`/api/v1/sales/${salesId}/invoices`)
        .set("Authorization", authHeader)
        .send({ invoiceDate: "2024-06-25", invoiceAmountUsd: "360000.00" });
      expect(invoiceCreateRes.status).toBe(201);
      const invoiceId = (invoiceCreateRes.body as { id: string }).id;
      const invoiceApproveRes = await request(app).patch(`/api/v1/sales/${salesId}/invoices/${invoiceId}/approve`).set("Authorization", authHeader);
      expect(invoiceApproveRes.status).toBe(200);

      const paymentRes = await request(app)
        .post("/api/v1/payments-received")
        .set("Authorization", authHeader)
        .send({
          customerId: tenant.salesRefs.customerId,
          paymentDate: "2024-07-01",
          paymentMode: "bank_transfer",
          allocations: [{ invoiceId, appliedAmountUsd: "200000.00" }],
        });
      expect(paymentRes.status).toBe(201);

      const periodMonth = periodMonthOf(new Date("2024-06-15T00:00:00Z"));
      await withTenantSchema(tenant.schemaName, (tx) => refreshSalesDashboardForCompany(tx, tenant.companyId, periodMonth));

      const dashboardRes = await request(app).get(`/api/v1/sales/dashboard?month=2024-06`).set("Authorization", authHeader);
      expect(dashboardRes.status).toBe(200);
      const body = dashboardRes.body as {
        snapshot: {
          totalSalesUsd: string;
          grossProfitUsd: string;
          netProfitUsd: string;
          outstandingReceivablesUsd: string;
          shipmentPendingCount: number;
          totalPurchasesUsd: string;
        } | null;
      };
      expect(body.snapshot).not.toBeNull();
      expect(body.snapshot?.totalSalesUsd).toBe("360000.00");
      expect(body.snapshot?.grossProfitUsd).toBe("40000.00");
      expect(body.snapshot?.netProfitUsd).toBe("40000.00");
      // 360,000 invoiced - 200,000 paid = 160,000 still outstanding.
      expect(body.snapshot?.outstandingReceivablesUsd).toBe("160000.00");
      // Fully delivered -> not pending.
      expect(body.snapshot?.shipmentPendingCount).toBe(0);
      expect(body.snapshot?.totalPurchasesUsd).toBe("320000.00");

      const customerBreakdown = await withTenantSchema(tenant.schemaName, (tx) =>
        tx.select().from(salesDashboardCustomerBreakdown).where(eq(salesDashboardCustomerBreakdown.companyId, tenant.companyId)),
      );
      expect(customerBreakdown).toHaveLength(1);
      expect(customerBreakdown[0]?.customerId).toBe(tenant.salesRefs.customerId);
      expect(customerBreakdown[0]?.salesAmountUsd).toBe("360000.00");

      const itemBreakdown = await withTenantSchema(tenant.schemaName, (tx) =>
        tx.select().from(salesDashboardItemBreakdown).where(eq(salesDashboardItemBreakdown.companyId, tenant.companyId)),
      );
      expect(itemBreakdown).toHaveLength(1);
      expect(itemBreakdown[0]?.itemId).toBe(tenant.itemRefs.itemId);

      const countryBreakdown = await withTenantSchema(tenant.schemaName, (tx) =>
        tx.select().from(salesDashboardCountryBreakdown).where(eq(salesDashboardCountryBreakdown.companyId, tenant.companyId)),
      );
      expect(countryBreakdown).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "GET /sales/dashboard returns an empty snapshot (never a live aggregate) for a month the refresh job hasn't run yet",
    async () => {
      const tenant = await seedTenant("dashboard-empty");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const res = await request(app).get("/api/v1/sales/dashboard?month=2099-01").set("Authorization", authHeader);
      expect(res.status).toBe(200);
      const body = res.body as { snapshot: unknown; customerBreakdown: unknown[]; itemBreakdown: unknown[]; countryBreakdown: unknown[] };
      expect(body.snapshot).toBeNull();
      expect(body.customerBreakdown).toHaveLength(0);
      expect(body.itemBreakdown).toHaveLength(0);
      expect(body.countryBreakdown).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "re-running the refresh for the same company/month upserts rather than duplicating rows",
    async () => {
      const tenant = await seedTenant("dashboard-idempotent");
      const periodMonth = "2024-06-01";

      await withTenantSchema(tenant.schemaName, (tx) => refreshSalesDashboardForCompany(tx, tenant.companyId, periodMonth));
      await withTenantSchema(tenant.schemaName, (tx) => refreshSalesDashboardForCompany(tx, tenant.companyId, periodMonth));

      const { salesDashboardSnapshots } = await import("../../../database/tenant/schema.js");
      const rows = await withTenantSchema(tenant.schemaName, (tx) =>
        tx.select().from(salesDashboardSnapshots).where(and(eq(salesDashboardSnapshots.companyId, tenant.companyId), eq(salesDashboardSnapshots.periodMonth, periodMonth))),
      );
      expect(rows).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );
});
