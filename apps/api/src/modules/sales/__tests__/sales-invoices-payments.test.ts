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
  supplierTypes,
  suppliers,
  transportModes,
  uom,
  users,
  warehouses,
} from "../../../database/tenant/schema.js";

const TEST_TIMEOUT_MS = 120_000;

const invoiceStatusSchema = z.object({ id: z.string(), status: z.enum(["draft", "approved", "reversed", "paid"]) });
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

async function deliverAndConfirm(
  app: ReturnType<typeof createApp>,
  authHeader: string,
  tenant: SeededTenant,
  salesId: string,
  itemId: string,
  qty: string,
): Promise<void> {
  const createRes = await request(app)
    .post(`/api/v1/sales/${salesId}/deliveries`)
    .set("Authorization", authHeader)
    .send({ dispatchDate: "2024-06-20", warehouseId: tenant.salesRefs.warehouseId, items: [{ salesItemId: itemId, deliveredQuantity: qty }] });
  expect(createRes.status).toBe(201);
  const deliveryId = (createRes.body as { id: string }).id;
  const confirmRes = await request(app).patch(`/api/v1/sales/${salesId}/deliveries/${deliveryId}/confirm`).set("Authorization", authHeader);
  expect(confirmRes.status).toBe(200);
}

/** Full happy path through approve + full delivery, ready to invoice. */
async function setupDeliveredSales(
  app: ReturnType<typeof createApp>,
  authHeader: string,
  tenant: SeededTenant,
  qty: string,
): Promise<{ salesId: string; itemId: string }> {
  const lotId = await createConfirmedReceiptLot(app, authHeader, tenant, qty);
  const salesId = await createDraftSales(app, authHeader, tenant);
  const itemId = await addSalesItem(app, authHeader, salesId, tenant, qty);
  await pickLot(app, authHeader, salesId, itemId, lotId, qty);
  const approveRes = await request(app).patch(`/api/v1/sales/${salesId}/approve`).set("Authorization", authHeader);
  expect(approveRes.status).toBe(200);
  await deliverAndConfirm(app, authHeader, tenant, salesId, itemId, qty);
  return { salesId, itemId };
}

async function createAndApproveInvoice(
  app: ReturnType<typeof createApp>,
  authHeader: string,
  salesId: string,
  amountUsd: string,
  items?: { salesItemId: string; invoicedQuantity: string; invoicedAmountUsd: string }[],
): Promise<string> {
  const createRes = await request(app)
    .post(`/api/v1/sales/${salesId}/invoices`)
    .set("Authorization", authHeader)
    .send({ invoiceDate: "2024-06-25", invoiceAmountUsd: amountUsd, ...(items ? { items } : {}) });
  expect(createRes.status).toBe(201);
  const invoiceId = (createRes.body as { id: string }).id;
  const approveRes = await request(app).patch(`/api/v1/sales/${salesId}/invoices/${invoiceId}/approve`).set("Authorization", authHeader);
  expect(approveRes.status).toBe(200);
  return invoiceId;
}

describe("modules/sales - S-5 (docs/SALES-MODULE-PLAN.md): Invoice + Payment Received (accounts receivable)", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "invoice created; outstanding = amount until paid",
    async () => {
      const tenant = await seedTenant("invoice-outstanding");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const { salesId } = await setupDeliveredSales(app, authHeader, tenant, "40");

      const invoiceId = await createAndApproveInvoice(app, authHeader, salesId, "360000.00");

      const outstandingRes = await request(app)
        .get(`/api/v1/payments-received/outstanding-invoices/${tenant.salesRefs.customerId}`)
        .set("Authorization", authHeader);
      expect(outstandingRes.status).toBe(200);
      const items = (outstandingRes.body as { items: { id: string; outstandingAmountUsd: string }[] }).items;
      const invoiceRow = items.find((row) => row.id === invoiceId);
      expect(invoiceRow?.outstandingAmountUsd).toBe("360000.00");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "partial payment across two separate payments completes an invoice - stays approved until the second, then auto-pays",
    async () => {
      const tenant = await seedTenant("partial-payment");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const { salesId } = await setupDeliveredSales(app, authHeader, tenant, "40");
      const invoiceId = await createAndApproveInvoice(app, authHeader, salesId, "360000.00");

      const firstPayment = await request(app)
        .post("/api/v1/payments-received")
        .set("Authorization", authHeader)
        .send({
          customerId: tenant.salesRefs.customerId,
          paymentDate: "2024-07-01",
          paymentMode: "bank_transfer",
          allocations: [{ invoiceId, appliedAmountUsd: "200000.00" }],
        });
      expect(firstPayment.status).toBe(201);

      const midGet = await request(app).get(`/api/v1/sales/${salesId}`).set("Authorization", authHeader);
      expect((midGet.body as { paidStatus: string }).paidStatus).toBe("partial");

      const secondPayment = await request(app)
        .post("/api/v1/payments-received")
        .set("Authorization", authHeader)
        .send({
          customerId: tenant.salesRefs.customerId,
          paymentDate: "2024-07-05",
          paymentMode: "bank_transfer",
          allocations: [{ invoiceId, appliedAmountUsd: "160000.00" }],
        });
      expect(secondPayment.status).toBe(201);

      const finalGet = await request(app).get(`/api/v1/sales/${salesId}`).set("Authorization", authHeader);
      expect((finalGet.body as { paidStatus: string }).paidStatus).toBe("fully_paid");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "one payment settling two invoices atomically",
    async () => {
      const tenant = await seedTenant("settle-two-invoices");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const { salesId, itemId } = await setupDeliveredSales(app, authHeader, tenant, "40");

      const firstInvoiceId = await createAndApproveInvoice(app, authHeader, salesId, "180000.00", [
        { salesItemId: itemId, invoicedQuantity: "20", invoicedAmountUsd: "180000.00" },
      ]);
      const secondInvoiceId = await createAndApproveInvoice(app, authHeader, salesId, "180000.00", [
        { salesItemId: itemId, invoicedQuantity: "20", invoicedAmountUsd: "180000.00" },
      ]);

      const paymentRes = await request(app)
        .post("/api/v1/payments-received")
        .set("Authorization", authHeader)
        .send({
          customerId: tenant.salesRefs.customerId,
          paymentDate: "2024-07-10",
          paymentMode: "cheque",
          referenceNumber: "CHQ-1001",
          allocations: [
            { invoiceId: firstInvoiceId, appliedAmountUsd: "180000.00" },
            { invoiceId: secondInvoiceId, appliedAmountUsd: "180000.00" },
          ],
        });
      expect(paymentRes.status).toBe(201);
      expect((paymentRes.body as { paymentAmountUsd: string }).paymentAmountUsd).toBe("360000.00");

      const finalGet = await request(app).get(`/api/v1/sales/${salesId}`).set("Authorization", authHeader);
      const body = finalGet.body as { paidStatus: string; invoicedStatus: string; status: string };
      expect(body.paidStatus).toBe("fully_paid");
      expect(body.invoicedStatus).toBe("fully_invoiced");
      // Both delivered AND invoiced are fully done, and both invoices are
      // approved (paid) - maybeAutoCloseSalesOrder should have fired.
      expect(body.status).toBe("closed");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "over-invoicing is blocked - cannot invoice more than delivered",
    async () => {
      const tenant = await seedTenant("over-invoice");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const { salesId, itemId } = await setupDeliveredSales(app, authHeader, tenant, "30");

      const createRes = await request(app)
        .post(`/api/v1/sales/${salesId}/invoices`)
        .set("Authorization", authHeader)
        .send({
          invoiceDate: "2024-06-25",
          invoiceAmountUsd: "279000.00",
          items: [{ salesItemId: itemId, invoicedQuantity: "31", invoicedAmountUsd: "279000.00" }],
        });
      expect(createRes.status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "cannot invoice against a Draft sales order",
    async () => {
      const tenant = await seedTenant("invoice-against-draft");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const salesId = await createDraftSales(app, authHeader, tenant);

      const createRes = await request(app)
        .post(`/api/v1/sales/${salesId}/invoices`)
        .set("Authorization", authHeader)
        .send({ invoiceDate: "2024-06-25", invoiceAmountUsd: "1000.00" });
      expect(createRes.status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "invoice independent of delivery - a header-only invoice can be created and approved with nothing delivered yet",
    async () => {
      const tenant = await seedTenant("invoice-independent");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const lotId = await createConfirmedReceiptLot(app, authHeader, tenant, "50");
      const salesId = await createDraftSales(app, authHeader, tenant);
      const itemId = await addSalesItem(app, authHeader, salesId, tenant, "50");
      await pickLot(app, authHeader, salesId, itemId, lotId, "50");
      const approveRes = await request(app).patch(`/api/v1/sales/${salesId}/approve`).set("Authorization", authHeader);
      expect(approveRes.status).toBe(200);

      // Nothing delivered yet - a header-only invoice (no items) is still
      // allowed (docs/adr/0028's own "invoice independent of delivery").
      const invoiceId = await createAndApproveInvoice(app, authHeader, salesId, "450000.00");
      expect(invoiceStatusSchema.parse({ id: invoiceId, status: "approved" }).status).toBe("approved");

      const getRes = await request(app).get(`/api/v1/sales/${salesId}`).set("Authorization", authHeader);
      expect((getRes.body as { deliveredStatus: string }).deliveredStatus).toBe("not_delivered");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "outstanding-invoices picker excludes another customer's invoices and already-fully-paid invoices",
    async () => {
      const tenant = await seedTenant("picker-exclusions");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const { salesId: paidSalesId } = await setupDeliveredSales(app, authHeader, tenant, "10");
      const paidInvoiceId = await createAndApproveInvoice(app, authHeader, paidSalesId, "90000.00");
      const payRes = await request(app)
        .post("/api/v1/payments-received")
        .set("Authorization", authHeader)
        .send({
          customerId: tenant.salesRefs.customerId,
          paymentDate: "2024-07-01",
          paymentMode: "cash",
          allocations: [{ invoiceId: paidInvoiceId, appliedAmountUsd: "90000.00" }],
        });
      expect(payRes.status).toBe(201);

      const { salesId: openSalesId } = await setupDeliveredSales(app, authHeader, tenant, "10");
      const openInvoiceId = await createAndApproveInvoice(app, authHeader, openSalesId, "90000.00");

      const [otherCustomer] = await withTenantSchema(tenant.schemaName, async (tx) => {
        const [customerType] = await tx.select().from(customerTypes).where(eq(customerTypes.companyId, tenant.companyId)).limit(1);
        const [country] = await tx.select().from(countries).where(eq(countries.companyId, tenant.companyId)).limit(1);
        const [paymentTerm] = await tx.select().from(paymentTerms).where(eq(paymentTerms.companyId, tenant.companyId)).limit(1);
        const [currency] = await tx.select().from(currencies).where(eq(currencies.companyId, tenant.companyId)).limit(1);
        if (!customerType || !country || !paymentTerm || !currency) {
          throw new Error("failed to look up prerequisite masters for other customer");
        }
        return tx
          .insert(customers)
          .values({
            companyId: tenant.companyId,
            code: "CUS-0002",
            name: "Other Customer",
            customerTypeId: customerType.id,
            countryId: country.id,
            paymentTermId: paymentTerm.id,
            currencyId: currency.id,
            createdBy: tenant.userId,
          })
          .returning();
      });

      const outstandingRes = await request(app)
        .get(`/api/v1/payments-received/outstanding-invoices/${tenant.salesRefs.customerId}`)
        .set("Authorization", authHeader);
      expect(outstandingRes.status).toBe(200);
      const ids = (outstandingRes.body as { items: { id: string }[] }).items.map((row) => row.id);
      expect(ids).toContain(openInvoiceId);
      expect(ids).not.toContain(paidInvoiceId);

      const otherOutstandingRes = await request(app)
        .get(`/api/v1/payments-received/outstanding-invoices/${otherCustomer?.id}`)
        .set("Authorization", authHeader);
      expect((otherOutstandingRes.body as { items: unknown[] }).items).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "credit-exposure warning reflects real outstanding receivables",
    async () => {
      const tenant = await seedTenant("credit-receivables");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      await withTenantSchema(tenant.schemaName, (tx) =>
        tx.update(customers).set({ creditLimit: "100000.00" }).where(eq(customers.id, tenant.salesRefs.customerId)),
      );

      const { salesId: firstSalesId } = await setupDeliveredSales(app, authHeader, tenant, "10");
      await createAndApproveInvoice(app, authHeader, firstSalesId, "90000.00"); // unpaid - counts as outstanding

      const lotId = await createConfirmedReceiptLot(app, authHeader, tenant, "10");
      const secondSalesId = await createDraftSales(app, authHeader, tenant);
      const secondItemId = await addSalesItem(app, authHeader, secondSalesId, tenant, "10");
      await pickLot(app, authHeader, secondSalesId, secondItemId, lotId, "10");

      // 90,000 outstanding + 90,000 this sale = 180,000 > 100,000 limit.
      const approveRes = await request(app).patch(`/api/v1/sales/${secondSalesId}/approve`).set("Authorization", authHeader);
      expect(approveRes.status).toBe(200);
      const body = approveRes.body as { warnings?: string[] };
      expect(body.warnings?.length).toBeGreaterThan(0);
      expect(body.warnings?.[0]).toMatch(/outstanding receivables/);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "gapless numbering under 20 concurrent invoice creates",
    async () => {
      const tenant = await seedTenant("gapless-invoice-numbering");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const { salesId } = await setupDeliveredSales(app, authHeader, tenant, "40");

      const CONCURRENCY = 20;
      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, () =>
          request(app)
            .post(`/api/v1/sales/${salesId}/invoices`)
            .set("Authorization", authHeader)
            .send({ invoiceDate: "2024-06-25", invoiceAmountUsd: "1000.00" }),
        ),
      );

      const succeeded = results.filter((res) => res.status === 201);
      expect(succeeded).toHaveLength(CONCURRENCY);

      const numbers = succeeded.map((res) => (res.body as { invoiceNumber: string }).invoiceNumber);
      expect(new Set(numbers).size).toBe(CONCURRENCY);

      const suffixes = numbers.map((n) => Number(n.split("-").pop())).sort((a, b) => a - b);
      for (let i = 1; i < suffixes.length; i++) {
        expect(suffixes[i]).toBe((suffixes[i - 1] ?? 0) + 1);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "cannot pay more than an invoice's outstanding balance, and cannot pay a draft invoice",
    async () => {
      const tenant = await seedTenant("overpay-guard");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const { salesId } = await setupDeliveredSales(app, authHeader, tenant, "10");

      const createRes = await request(app)
        .post(`/api/v1/sales/${salesId}/invoices`)
        .set("Authorization", authHeader)
        .send({ invoiceDate: "2024-06-25", invoiceAmountUsd: "90000.00" });
      expect(createRes.status).toBe(201);
      const draftInvoiceId = (createRes.body as { id: string }).id;

      const payDraftRes = await request(app)
        .post("/api/v1/payments-received")
        .set("Authorization", authHeader)
        .send({
          customerId: tenant.salesRefs.customerId,
          paymentDate: "2024-07-01",
          paymentMode: "cash",
          allocations: [{ invoiceId: draftInvoiceId, appliedAmountUsd: "1000.00" }],
        });
      expect(payDraftRes.status).toBe(409);

      const approveRes = await request(app).patch(`/api/v1/sales/${salesId}/invoices/${draftInvoiceId}/approve`).set("Authorization", authHeader);
      expect(approveRes.status).toBe(200);

      const overpayRes = await request(app)
        .post("/api/v1/payments-received")
        .set("Authorization", authHeader)
        .send({
          customerId: tenant.salesRefs.customerId,
          paymentDate: "2024-07-01",
          paymentMode: "cash",
          allocations: [{ invoiceId: draftInvoiceId, appliedAmountUsd: "90000.01" }],
        });
      expect(overpayRes.status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "cannot cancel a sales order that already has an invoice against it, even with nothing delivered yet",
    async () => {
      const tenant = await seedTenant("cancel-blocked-by-invoice");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const lotId = await createConfirmedReceiptLot(app, authHeader, tenant, "50");
      const salesId = await createDraftSales(app, authHeader, tenant);
      const itemId = await addSalesItem(app, authHeader, salesId, tenant, "50");
      await pickLot(app, authHeader, salesId, itemId, lotId, "50");
      const approveRes = await request(app).patch(`/api/v1/sales/${salesId}/approve`).set("Authorization", authHeader);
      expect(approveRes.status).toBe(200);

      // Invoice independent of delivery (docs/adr/0028) - nothing delivered
      // yet, but the invoice itself is enough to block cancel.
      await createAndApproveInvoice(app, authHeader, salesId, "450000.00");

      const cancelRes = await request(app).patch(`/api/v1/sales/${salesId}/cancel`).set("Authorization", authHeader);
      expect(cancelRes.status).toBe(409);
      expect((cancelRes.body as { error: { message: string } }).error.message).toMatch(/already has an invoice/);

      const stillApproved = salesStatusSchema.parse((await request(app).get(`/api/v1/sales/${salesId}`).set("Authorization", authHeader)).body);
      expect(stillApproved.status).toBe("approved");
    },
    TEST_TIMEOUT_MS,
  );
});
