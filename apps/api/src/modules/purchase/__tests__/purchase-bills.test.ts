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
  auditLogs,
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
  purchaseBills,
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

const ALL_PERMISSIONS = [
  "purchase.po.create",
  "purchase.po.read",
  "purchase.po.update",
  "purchase.po.issue",
  "purchase.po.cancel",
  "purchase.invoice.create",
  "purchase.invoice.update",
  "purchase.invoice.approve",
  "purchase.receipt.create",
  "purchase.receipt.confirm",
  "inventory.stock.read",
];

async function seedTenant(label: string): Promise<SeededTenant> {
  const unique = randomUUID().slice(0, 8);
  const tenant = await createTenantSchema({ name: `${label} Co`, slug: `${label}-${unique}` });

  const { companyId, userId, purchaseRefs, itemRefs } = await withTenantSchema(tenant.schemaName, async (tx) => {
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
  for (const key of ALL_PERMISSIONS) {
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
  expect(res.status).toBe(201);
  return (res.body as { id: string }).id;
}

async function addItem(app: ReturnType<typeof createApp>, authHeader: string, purchaseId: string, tenant: SeededTenant, quantity: string): Promise<string> {
  const res = await request(app)
    .post(`/api/v1/purchases/${purchaseId}/items`)
    .set("Authorization", authHeader)
    .send({ itemId: tenant.itemRefs.itemId, quantity, uomId: tenant.itemRefs.uomId, purchaseRateUsd: "8000", exchangeRate: "3.6725" });
  expect(res.status).toBe(201);
  return (res.body as { id: string }).id;
}

async function approvePurchase(app: ReturnType<typeof createApp>, authHeader: string, purchaseId: string): Promise<void> {
  const res = await request(app).patch(`/api/v1/purchases/${purchaseId}/issue`).set("Authorization", authHeader);
  expect(res.status).toBe(200);
}

interface CreateInvoiceOptions {
  invoiceAmountUsd?: string;
  dueDate?: string;
  taxAmount?: string;
  items?: Array<{ purchaseItemId: string; billedQuantity: string; billedAmountUsd: string }>;
}

async function createInvoiceRaw(
  app: ReturnType<typeof createApp>,
  authHeader: string,
  purchaseId: string,
  options: CreateInvoiceOptions = {},
): Promise<{ status: number; body: { id?: string; invoiceNumber?: string } }> {
  const res = await request(app)
    .post(`/api/v1/purchases/${purchaseId}/invoices`)
    .set("Authorization", authHeader)
    .send({
      invoiceDate: "2024-06-20",
      invoiceAmountUsd: options.invoiceAmountUsd ?? "50000",
      ...(options.dueDate ? { dueDate: options.dueDate } : {}),
      ...(options.taxAmount ? { taxAmount: options.taxAmount } : {}),
      ...(options.items ? { items: options.items } : {}),
    });
  return { status: res.status, body: res.body as { id?: string; invoiceNumber?: string } };
}

async function createInvoice(app: ReturnType<typeof createApp>, authHeader: string, purchaseId: string, invoiceAmountUsd = "50000"): Promise<string> {
  const { status, body } = await createInvoiceRaw(app, authHeader, purchaseId, { invoiceAmountUsd });
  expect(status).toBe(201);
  if (!body.id) throw new Error("expected an invoice id");
  return body.id;
}

async function approveInvoice(
  app: ReturnType<typeof createApp>,
  authHeader: string,
  purchaseId: string,
  invoiceId: string,
): Promise<{ status: number; body: unknown }> {
  const res = await request(app).patch(`/api/v1/purchases/${purchaseId}/invoices/${invoiceId}/approve`).set("Authorization", authHeader);
  return { status: res.status, body: res.body };
}

async function createReceipt(
  app: ReturnType<typeof createApp>,
  authHeader: string,
  purchaseId: string,
  warehouseId: string,
  purchaseItemId: string,
  receivedQuantity: string,
): Promise<string> {
  const res = await request(app)
    .post(`/api/v1/purchases/${purchaseId}/receipts`)
    .set("Authorization", authHeader)
    .send({ receiptDate: "2024-06-20", warehouseId, items: [{ purchaseItemId, receivedQuantity }] });
  expect(res.status).toBe(201);
  const receiptId = (res.body as { id: string }).id;
  const confirmRes = await request(app).patch(`/api/v1/purchases/${purchaseId}/receipts/${receiptId}/confirm`).set("Authorization", authHeader);
  expect(confirmRes.status).toBe(200);
  return receiptId;
}

const invoiceStatusSchema = z.object({ id: z.string(), status: z.enum(["draft", "approved", "reversed", "paid"]) });

describe("modules/purchase - the Bill (PL-2/ADR 0017: renamed from Prompt 22's Supplier Invoice, still purely financial)", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "approving a bill is purely a status change - no stock_movements row is written",
    async () => {
      const tenant = await seedTenant("bill-no-stock");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      await addItem(app, authHeader, purchaseId, tenant, "100");
      await approvePurchase(app, authHeader, purchaseId);
      const invoiceId = await createInvoice(app, authHeader, purchaseId);

      const { status, body } = await approveInvoice(app, authHeader, purchaseId, invoiceId);
      expect(status).toBe(200);
      expect(invoiceStatusSchema.parse(body).status).toBe("approved");

      const balanceRes = await request(app).get("/api/v1/inventory/balances").set("Authorization", authHeader);
      expect(balanceRes.status).toBe(200);
      expect((balanceRes.body as { items: unknown[] }).items).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "bill approval is rejected while the underlying purchase is still Draft",
    async () => {
      const tenant = await seedTenant("bill-needs-po-approved");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      await addItem(app, authHeader, purchaseId, tenant, "10");
      const invoiceId = await createInvoice(app, authHeader, purchaseId);

      const { status } = await approveInvoice(app, authHeader, purchaseId, invoiceId);
      expect(status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a purchase can have MULTIPLE bills - partial billing is unconditional, not a flag (PL-2 supersedes ALLOW_PARTIAL_INVOICING)",
    async () => {
      const tenant = await seedTenant("bill-multiple");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      await addItem(app, authHeader, purchaseId, tenant, "10");
      await approvePurchase(app, authHeader, purchaseId);
      await createInvoice(app, authHeader, purchaseId);

      const secondRes = await request(app)
        .post(`/api/v1/purchases/${purchaseId}/invoices`)
        .set("Authorization", authHeader)
        .send({ invoiceDate: "2024-06-21", invoiceAmountUsd: "1000" });
      expect(secondRes.status).toBe(201);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "editing a purchase item after bill approval no longer flips the bill back to draft - there is nothing to reconcile",
    async () => {
      const tenant = await seedTenant("no-reconciliation");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      const itemId = await addItem(app, authHeader, purchaseId, tenant, "100");
      await approvePurchase(app, authHeader, purchaseId);
      const invoiceId = await createInvoice(app, authHeader, purchaseId);
      await approveInvoice(app, authHeader, purchaseId, invoiceId);

      const editRes = await request(app)
        .patch(`/api/v1/purchases/${purchaseId}/items/${itemId}`)
        .set("Authorization", authHeader)
        .send({ quantity: "130" });
      expect(editRes.status).toBe(200);

      const [bill] = await withTenantSchema(tenant.schemaName, (tx) => tx.select().from(purchaseBills).where(eq(purchaseBills.id, invoiceId)));
      expect(bill?.status).toBe("approved");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the bill's own fields lock once approved - an edit is rejected, matching the purchase header's own Draft-only lock",
    async () => {
      const tenant = await seedTenant("bill-fields-lock");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      await addItem(app, authHeader, purchaseId, tenant, "10");
      await approvePurchase(app, authHeader, purchaseId);
      const invoiceId = await createInvoice(app, authHeader, purchaseId);
      await approveInvoice(app, authHeader, purchaseId, invoiceId);

      const editRes = await request(app)
        .patch(`/api/v1/purchases/${purchaseId}/invoices/${invoiceId}`)
        .set("Authorization", authHeader)
        .send({ supplierInvoiceNo: "SUP-REF-1" });
      expect(editRes.status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the bill number is never null and follows the BILL-{FY}-{0000} pattern, distinct from the purchase's own number and from any historical SINV series",
    async () => {
      const tenant = await seedTenant("bill-numbering");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      await addItem(app, authHeader, purchaseId, tenant, "10");
      await approvePurchase(app, authHeader, purchaseId);

      const { status, body } = await createInvoiceRaw(app, authHeader, purchaseId);
      expect(status).toBe(201);
      expect(body.invoiceNumber).toMatch(/^BILL-2024-\d{4}$/);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the bill is visible on GET /purchases/:id alongside its other sub-resources, under the wire key 'invoices'",
    async () => {
      const tenant = await seedTenant("bill-in-getById");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      await addItem(app, authHeader, purchaseId, tenant, "10");
      await approvePurchase(app, authHeader, purchaseId);
      const invoiceId = await createInvoice(app, authHeader, purchaseId);

      const res = await request(app).get(`/api/v1/purchases/${purchaseId}`).set("Authorization", authHeader);
      expect(res.status).toBe(200);
      const body = res.body as { invoices: Array<{ id: string; status: string }> };
      expect(body.invoices.some((i) => i.id === invoiceId && i.status === "draft")).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "invoiceAmountUsd is mandatory - creating a bill without one is rejected",
    async () => {
      const tenant = await seedTenant("bill-amount-mandatory");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      await addItem(app, authHeader, purchaseId, tenant, "10");
      await approvePurchase(app, authHeader, purchaseId);

      const res = await request(app)
        .post(`/api/v1/purchases/${purchaseId}/invoices`)
        .set("Authorization", authHeader)
        .send({ invoiceDate: "2024-06-20" });
      expect(res.status).toBe(422);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "GET /purchases/:id computes the bill's variance against the purchase's own computed items total - informational, never blocking",
    async () => {
      const tenant = await seedTenant("bill-variance");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      // quantity 10 x purchaseRateUsd 8000 (addItem's fixed rate) = 80000.00 purchase items total.
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      await addItem(app, authHeader, purchaseId, tenant, "10");
      await approvePurchase(app, authHeader, purchaseId);
      const invoiceId = await createInvoice(app, authHeader, purchaseId, "82000");

      const res = await request(app).get(`/api/v1/purchases/${purchaseId}`).set("Authorization", authHeader);
      expect(res.status).toBe(200);
      const body = res.body as {
        invoices: Array<{ id: string; purchaseItemsAmountUsd: string; varianceUsd: string; variancePct: string }>;
      };
      const invoice = body.invoices.find((i) => i.id === invoiceId);
      expect(invoice?.purchaseItemsAmountUsd).toBe("80000.00");
      expect(invoice?.varianceUsd).toBe("2000.00");
      expect(invoice?.variancePct).toBe("2.50");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "dueDate and taxAmount round-trip as a clean, optional seam - never enforced, never computed",
    async () => {
      const tenant = await seedTenant("bill-due-tax");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      await addItem(app, authHeader, purchaseId, tenant, "10");
      await approvePurchase(app, authHeader, purchaseId);

      const { status, body } = await createInvoiceRaw(app, authHeader, purchaseId, { dueDate: "2024-07-20", taxAmount: "500.00" });
      expect(status).toBe(201);

      const res = await request(app).get(`/api/v1/purchases/${purchaseId}`).set("Authorization", authHeader);
      const invoice = (res.body as { invoices: Array<{ id: string; dueDate: string | null; taxAmount: string | null }> }).invoices.find(
        (i) => i.id === body.id,
      );
      expect(invoice?.dueDate).toBe("2024-07-20");
      expect(invoice?.taxAmount).toBe("500.00");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "bill can be created and approved WITH itemized lines - billed_status reflects partial: bill 40 of 100 -> partial",
    async () => {
      const tenant = await seedTenant("bill-partial");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      const itemId = await addItem(app, authHeader, purchaseId, tenant, "100");
      await approvePurchase(app, authHeader, purchaseId);

      const { status } = await createInvoiceRaw(app, authHeader, purchaseId, {
        invoiceAmountUsd: "32000",
        items: [{ purchaseItemId: itemId, billedQuantity: "40", billedAmountUsd: "32000" }],
      });
      expect(status).toBe(201);

      const res = await request(app).get(`/api/v1/purchases/${purchaseId}`).set("Authorization", authHeader);
      expect((res.body as { billedStatus: string }).billedStatus).toBe("partial");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "PO reaches fully_billed only when the full ordered quantity has been billed, across multiple bills",
    async () => {
      const tenant = await seedTenant("bill-fully-billed");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      const itemId = await addItem(app, authHeader, purchaseId, tenant, "100");
      await approvePurchase(app, authHeader, purchaseId);

      await createInvoiceRaw(app, authHeader, purchaseId, {
        invoiceAmountUsd: "24000",
        items: [{ purchaseItemId: itemId, billedQuantity: "30", billedAmountUsd: "24000" }],
      });
      const midRes = await request(app).get(`/api/v1/purchases/${purchaseId}`).set("Authorization", authHeader);
      expect((midRes.body as { billedStatus: string }).billedStatus).toBe("partial");

      await createInvoiceRaw(app, authHeader, purchaseId, {
        invoiceAmountUsd: "56000",
        items: [{ purchaseItemId: itemId, billedQuantity: "70", billedAmountUsd: "56000" }],
      });
      const finalRes = await request(app).get(`/api/v1/purchases/${purchaseId}`).set("Authorization", authHeader);
      expect((finalRes.body as { billedStatus: string }).billedStatus).toBe("fully_billed");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "cannot bill 101 of 100 - over-billing is blocked at bill create time, summed across every existing bill",
    async () => {
      const tenant = await seedTenant("bill-over-billing");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      const itemId = await addItem(app, authHeader, purchaseId, tenant, "100");
      await approvePurchase(app, authHeader, purchaseId);

      const { status } = await createInvoiceRaw(app, authHeader, purchaseId, {
        invoiceAmountUsd: "80800",
        items: [{ purchaseItemId: itemId, billedQuantity: "101", billedAmountUsd: "80800" }],
      });
      expect(status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "cannot bill over the remaining balance across two bills either",
    async () => {
      const tenant = await seedTenant("bill-over-billing-cumulative");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      const itemId = await addItem(app, authHeader, purchaseId, tenant, "100");
      await approvePurchase(app, authHeader, purchaseId);

      await createInvoiceRaw(app, authHeader, purchaseId, {
        invoiceAmountUsd: "48000",
        items: [{ purchaseItemId: itemId, billedQuantity: "60", billedAmountUsd: "48000" }],
      });

      const { status } = await createInvoiceRaw(app, authHeader, purchaseId, {
        invoiceAmountUsd: "32800",
        items: [{ purchaseItemId: itemId, billedQuantity: "41", billedAmountUsd: "32800" }],
      });
      expect(status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Receipt and Bill are independent - a PO can be received-not-billed and billed-not-received",
    async () => {
      const receivedNotBilled = await seedTenant("received-not-billed");
      const app1 = createApp();
      const authHeader1 = `Bearer ${receivedNotBilled.accessToken}`;
      const purchaseId1 = await createDraftPurchase(app1, authHeader1, receivedNotBilled);
      const itemId1 = await addItem(app1, authHeader1, purchaseId1, receivedNotBilled, "50");
      await approvePurchase(app1, authHeader1, purchaseId1);
      await createReceipt(app1, authHeader1, purchaseId1, receivedNotBilled.purchaseRefs.warehouseId, itemId1, "50");

      const res1 = await request(app1).get(`/api/v1/purchases/${purchaseId1}`).set("Authorization", authHeader1);
      const body1 = res1.body as { receivedStatus: string; billedStatus: string };
      expect(body1.receivedStatus).toBe("fully_received");
      expect(body1.billedStatus).toBe("not_billed");

      const billedNotReceived = await seedTenant("billed-not-received");
      const app2 = createApp();
      const authHeader2 = `Bearer ${billedNotReceived.accessToken}`;
      const purchaseId2 = await createDraftPurchase(app2, authHeader2, billedNotReceived);
      const itemId2 = await addItem(app2, authHeader2, purchaseId2, billedNotReceived, "50");
      await approvePurchase(app2, authHeader2, purchaseId2);
      await createInvoiceRaw(app2, authHeader2, purchaseId2, {
        invoiceAmountUsd: "40000",
        items: [{ purchaseItemId: itemId2, billedQuantity: "50", billedAmountUsd: "40000" }],
      });

      const res2 = await request(app2).get(`/api/v1/purchases/${purchaseId2}`).set("Authorization", authHeader2);
      const body2 = res2.body as { receivedStatus: string; billedStatus: string };
      expect(body2.receivedStatus).toBe("not_received");
      expect(body2.billedStatus).toBe("fully_billed");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "bill approval is audited",
    async () => {
      const tenant = await seedTenant("bill-audit");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      await addItem(app, authHeader, purchaseId, tenant, "10");
      await approvePurchase(app, authHeader, purchaseId);
      const invoiceId = await createInvoice(app, authHeader, purchaseId);

      const { status } = await approveInvoice(app, authHeader, purchaseId, invoiceId);
      expect(status).toBe(200);

      const auditRows = await withTenantSchema(tenant.schemaName, (tx) =>
        tx.select().from(auditLogs).where(and(eq(auditLogs.entity, "purchase_invoice"), eq(auditLogs.entityId, invoiceId))),
      );
      expect(auditRows.some((row) => row.action === "purchase_invoice.approved")).toBe(true);
      const approvedRow = auditRows.find((row) => row.action === "purchase_invoice.approved");
      expect(approvedRow?.before).toEqual({ status: "draft" });
      expect(approvedRow?.after).toEqual({ status: "approved" });
    },
    TEST_TIMEOUT_MS,
  );
});
