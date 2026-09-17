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
  purchaseReceiptItems,
  purchaseReceipts,
  stockMovements,
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
  "purchase.receipt.create",
  "purchase.receipt.confirm",
  "purchase.invoice.create",
  "purchase.invoice.approve",
  "purchase.line.shortclose",
  "purchase.line.reopen",
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

async function issuePurchase(app: ReturnType<typeof createApp>, authHeader: string, purchaseId: string): Promise<void> {
  const res = await request(app).patch(`/api/v1/purchases/${purchaseId}/issue`).set("Authorization", authHeader);
  expect(res.status).toBe(200);
}

async function receiveAndConfirm(
  app: ReturnType<typeof createApp>,
  authHeader: string,
  purchaseId: string,
  warehouseId: string,
  purchaseItemId: string,
  receivedQuantity: string,
): Promise<void> {
  const res = await request(app)
    .post(`/api/v1/purchases/${purchaseId}/receipts`)
    .set("Authorization", authHeader)
    .send({ receiptDate: "2024-06-20", warehouseId, items: [{ purchaseItemId, receivedQuantity }] });
  expect(res.status).toBe(201);
  const receiptId = (res.body as { id: string }).id;
  const confirmRes = await request(app).patch(`/api/v1/purchases/${purchaseId}/receipts/${receiptId}/confirm`).set("Authorization", authHeader);
  expect(confirmRes.status).toBe(200);
}

function shortClose(app: ReturnType<typeof createApp>, authHeader: string, purchaseId: string, itemId: string, reason?: string) {
  return request(app)
    .post(`/api/v1/purchases/${purchaseId}/lines/${itemId}/short-close`)
    .set("Authorization", authHeader)
    .send(reason === undefined ? {} : { reason });
}

function reopen(app: ReturnType<typeof createApp>, authHeader: string, purchaseId: string, itemId: string) {
  return request(app).post(`/api/v1/purchases/${purchaseId}/lines/${itemId}/reopen`).set("Authorization", authHeader);
}

function createBillRaw(
  app: ReturnType<typeof createApp>,
  authHeader: string,
  purchaseId: string,
  items: Array<{ purchaseItemId: string; billedQuantity: string; billedAmountUsd: string }>,
) {
  return request(app)
    .post(`/api/v1/purchases/${purchaseId}/invoices`)
    .set("Authorization", authHeader)
    .send({ invoiceDate: "2024-06-20", invoiceAmountUsd: "50000", items });
}

async function stockMovementsForPurchase(schemaName: string, companyId: string, purchaseId: string) {
  return withTenantSchema(schemaName, (tx) =>
    tx
      .select({ id: stockMovements.id, quantity: stockMovements.quantity, movementType: stockMovements.movementType })
      .from(stockMovements)
      .innerJoin(purchaseReceipts, eq(purchaseReceipts.id, stockMovements.receiptId))
      .where(and(eq(stockMovements.companyId, companyId), eq(purchaseReceipts.purchaseId, purchaseId))),
  );
}

async function receiptItemsForPurchase(schemaName: string, companyId: string, purchaseId: string) {
  return withTenantSchema(schemaName, (tx) =>
    tx
      .select({ id: purchaseReceiptItems.id, receivedQuantity: purchaseReceiptItems.receivedQuantity })
      .from(purchaseReceiptItems)
      .innerJoin(purchaseReceipts, eq(purchaseReceipts.id, purchaseReceiptItems.receiptId))
      .where(and(eq(purchaseReceipts.companyId, companyId), eq(purchaseReceipts.purchaseId, purchaseId))),
  );
}

async function shortCloseAuditEntry(schemaName: string, companyId: string, itemId: string) {
  return withTenantSchema(schemaName, (tx) =>
    tx
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.companyId, companyId), eq(auditLogs.entityId, itemId), eq(auditLogs.action, "purchase_item.short_closed"))),
  );
}

describe("modules/purchase - PO short-close (docs/PO-SHORT-CLOSE.md)", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "short-close on a line with received 7 of ordered 10 sets short_closed_qty=3, line_status=short_closed, audited with reason",
    async () => {
      const tenant = await seedTenant("shortclose-basic");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      const itemId = await addItem(app, authHeader, purchaseId, tenant, "10");
      await issuePurchase(app, authHeader, purchaseId);
      await receiveAndConfirm(app, authHeader, purchaseId, tenant.purchaseRefs.warehouseId, itemId, "7");

      const res = await shortClose(app, authHeader, purchaseId, itemId, "Supplier confirmed no further shipment for this lot");
      expect(res.status).toBe(200);
      const body = res.body as { shortClosedQty: string; lineStatus: string };
      expect(Number(body.shortClosedQty)).toBe(3);
      expect(body.lineStatus).toBe("short_closed");

      const auditRows = await shortCloseAuditEntry(tenant.schemaName, tenant.companyId, itemId);
      expect(auditRows).toHaveLength(1);
      expect((auditRows[0]?.after as { reason?: string } | null)?.reason).toBe("Supplier confirmed no further shipment for this lot");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "short-close is rejected without a reason",
    async () => {
      const tenant = await seedTenant("shortclose-no-reason");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      const itemId = await addItem(app, authHeader, purchaseId, tenant, "10");
      await issuePurchase(app, authHeader, purchaseId);
      await receiveAndConfirm(app, authHeader, purchaseId, tenant.purchaseRefs.warehouseId, itemId, "7");

      const res = await shortClose(app, authHeader, purchaseId, itemId, "");
      expect(res.status).toBe(422);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "short-close is rejected once received_qty already equals ordered_qty",
    async () => {
      const tenant = await seedTenant("shortclose-fully-received");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      const itemId = await addItem(app, authHeader, purchaseId, tenant, "10");
      await issuePurchase(app, authHeader, purchaseId);
      await receiveAndConfirm(app, authHeader, purchaseId, tenant.purchaseRefs.warehouseId, itemId, "10");

      const res = await shortClose(app, authHeader, purchaseId, itemId, "Nothing left to write off");
      expect(res.status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "short-close is rejected if zero receipts exist against the line - short-closing with nothing received is a cancellation, not a short-close",
    async () => {
      const tenant = await seedTenant("shortclose-zero-receipts");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      const itemId = await addItem(app, authHeader, purchaseId, tenant, "10");
      await issuePurchase(app, authHeader, purchaseId);

      const res = await shortClose(app, authHeader, purchaseId, itemId, "Nothing arrived yet");
      expect(res.status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "short-close-remaining applies to every partial line and skips lines that aren't short-closable",
    async () => {
      const tenant = await seedTenant("shortclose-remaining");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      const partialItemId = await addItem(app, authHeader, purchaseId, tenant, "10");
      const fullyReceivedItemId = await addItem(app, authHeader, purchaseId, tenant, "5");
      await issuePurchase(app, authHeader, purchaseId);
      await receiveAndConfirm(app, authHeader, purchaseId, tenant.purchaseRefs.warehouseId, partialItemId, "6");
      await receiveAndConfirm(app, authHeader, purchaseId, tenant.purchaseRefs.warehouseId, fullyReceivedItemId, "5");

      const res = await request(app)
        .post(`/api/v1/purchases/${purchaseId}/short-close-remaining`)
        .set("Authorization", authHeader)
        .send({ reason: "Finalizing the rest of this order" });
      expect(res.status).toBe(200);
      const body = res.body as { items: Array<{ id: string; lineStatus: string }> };
      expect(body.items).toHaveLength(1);
      expect(body.items[0]?.id).toBe(partialItemId);
      expect(body.items[0]?.lineStatus).toBe("short_closed");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "PO received_status becomes short_closed when all lines are fully_received or short_closed; stays partial if any line is still genuinely open",
    async () => {
      const tenant = await seedTenant("shortclose-po-status");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      const shortClosedItemId = await addItem(app, authHeader, purchaseId, tenant, "10");
      const stillOpenItemId = await addItem(app, authHeader, purchaseId, tenant, "5");
      await issuePurchase(app, authHeader, purchaseId);
      await receiveAndConfirm(app, authHeader, purchaseId, tenant.purchaseRefs.warehouseId, shortClosedItemId, "7");
      await receiveAndConfirm(app, authHeader, purchaseId, tenant.purchaseRefs.warehouseId, stillOpenItemId, "2");

      const beforeShortClose = await request(app).get(`/api/v1/purchases/${purchaseId}`).set("Authorization", authHeader);
      expect((beforeShortClose.body as { receivedStatus: string }).receivedStatus).toBe("partial");

      await shortClose(app, authHeader, purchaseId, shortClosedItemId, "Partial shipment, rest not coming");
      const afterFirstShortClose = await request(app).get(`/api/v1/purchases/${purchaseId}`).set("Authorization", authHeader);
      // stillOpenItemId (received 2 of 5) is genuinely pending - PO stays partial.
      expect((afterFirstShortClose.body as { receivedStatus: string }).receivedStatus).toBe("partial");

      await shortClose(app, authHeader, purchaseId, stillOpenItemId, "This one too, finalizing the whole order");
      const afterBothShortClosed = await request(app).get(`/api/v1/purchases/${purchaseId}`).set("Authorization", authHeader);
      expect((afterBothShortClosed.body as { receivedStatus: string }).receivedStatus).toBe("short_closed");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "reopen clears short_closed_qty and returns the line to partial",
    async () => {
      const tenant = await seedTenant("shortclose-reopen");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      const itemId = await addItem(app, authHeader, purchaseId, tenant, "10");
      await issuePurchase(app, authHeader, purchaseId);
      await receiveAndConfirm(app, authHeader, purchaseId, tenant.purchaseRefs.warehouseId, itemId, "7");
      await shortClose(app, authHeader, purchaseId, itemId, "Supplier said no more is coming");

      const res = await reopen(app, authHeader, purchaseId, itemId);
      expect(res.status).toBe(200);
      const body = res.body as { shortClosedQty: string; lineStatus: string };
      expect(Number(body.shortClosedQty)).toBe(0);
      expect(body.lineStatus).toBe("partial");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "short-close does NOT alter any existing stock_movement or purchase_receipt_item row",
    async () => {
      const tenant = await seedTenant("shortclose-no-mutation");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      const itemId = await addItem(app, authHeader, purchaseId, tenant, "10");
      await issuePurchase(app, authHeader, purchaseId);
      await receiveAndConfirm(app, authHeader, purchaseId, tenant.purchaseRefs.warehouseId, itemId, "7");

      const movementsBefore = await stockMovementsForPurchase(tenant.schemaName, tenant.companyId, purchaseId);
      const receiptItemsBefore = await receiptItemsForPurchase(tenant.schemaName, tenant.companyId, purchaseId);

      await shortClose(app, authHeader, purchaseId, itemId, "Finalizing at received quantity");

      const movementsAfter = await stockMovementsForPurchase(tenant.schemaName, tenant.companyId, purchaseId);
      const receiptItemsAfter = await receiptItemsForPurchase(tenant.schemaName, tenant.companyId, purchaseId);

      expect(movementsAfter).toEqual(movementsBefore);
      expect(receiptItemsAfter).toEqual(receiptItemsBefore);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "creating a Bill against a short-closed PO line defaults/caps at the received qty (7), never ordered (10)",
    async () => {
      const tenant = await seedTenant("shortclose-bill-cap");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      const itemId = await addItem(app, authHeader, purchaseId, tenant, "10");
      await issuePurchase(app, authHeader, purchaseId);
      await receiveAndConfirm(app, authHeader, purchaseId, tenant.purchaseRefs.warehouseId, itemId, "7");
      await shortClose(app, authHeader, purchaseId, itemId, "Rest not coming");

      const overCapRes = await createBillRaw(app, authHeader, purchaseId, [
        { purchaseItemId: itemId, billedQuantity: "10", billedAmountUsd: "80000" },
      ]);
      expect(overCapRes.status).toBe(409);

      const atCapRes = await createBillRaw(app, authHeader, purchaseId, [
        { purchaseItemId: itemId, billedQuantity: "7", billedAmountUsd: "56000" },
      ]);
      expect(atCapRes.status).toBe(201);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "short-closing a line does NOT prematurely mark billedStatus done - the reduced billable ceiling (7) still genuinely needs billing, and only billing it fully retires Convert to Bill and auto-closes the PO",
    async () => {
      const tenant = await seedTenant("shortclose-billed-status");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      const itemId = await addItem(app, authHeader, purchaseId, tenant, "10");
      await issuePurchase(app, authHeader, purchaseId);
      await receiveAndConfirm(app, authHeader, purchaseId, tenant.purchaseRefs.warehouseId, itemId, "7");

      await shortClose(app, authHeader, purchaseId, itemId, "Rest not coming");

      // Nothing has been billed yet - billedStatus must NOT jump straight
      // to "done" just because the line was short-closed on the received
      // side. The billable ceiling (7) is still a real, non-zero amount
      // genuinely awaiting a bill.
      const afterShortClose = await request(app).get(`/api/v1/purchases/${purchaseId}`).set("Authorization", authHeader);
      const afterShortCloseBody = afterShortClose.body as { receivedStatus: string; billedStatus: string; status: string };
      expect(afterShortCloseBody.receivedStatus).toBe("short_closed");
      expect(afterShortCloseBody.billedStatus).toBe("not_billed");
      expect(afterShortCloseBody.status).toBe("issued");

      const billRes = await createBillRaw(app, authHeader, purchaseId, [
        { purchaseItemId: itemId, billedQuantity: "7", billedAmountUsd: "56000" },
      ]);
      expect(billRes.status).toBe(201);
      const billId = (billRes.body as { id: string }).id;
      const approveRes = await request(app).patch(`/api/v1/purchases/${purchaseId}/invoices/${billId}/approve`).set("Authorization", authHeader);
      expect(approveRes.status).toBe(200);

      // Billing the full billable remainder (7) reaches fully_billed for
      // real, and with the received axis already short_closed (done), the
      // PO auto-closes - it must not sit in Issued forever just because
      // short-close was involved.
      const afterBill = await request(app).get(`/api/v1/purchases/${purchaseId}`).set("Authorization", authHeader);
      const afterBillBody = afterBill.body as { receivedStatus: string; billedStatus: string; status: string };
      expect(afterBillBody.billedStatus).toBe("fully_billed");
      expect(afterBillBody.status).toBe("closed");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "on an ORDINARY (non-short-closed) partially-received PO, a Bill attempting to exceed received quantity is rejected too - proves the received-qty ceiling is universal, not scoped only to short-closed lines",
    async () => {
      const tenant = await seedTenant("universal-bill-ceiling");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      const itemId = await addItem(app, authHeader, purchaseId, tenant, "10");
      await issuePurchase(app, authHeader, purchaseId);
      await receiveAndConfirm(app, authHeader, purchaseId, tenant.purchaseRefs.warehouseId, itemId, "7");
      // Deliberately no short-close call at all on this line.

      const overReceivedRes = await createBillRaw(app, authHeader, purchaseId, [
        { purchaseItemId: itemId, billedQuantity: "8", billedAmountUsd: "64000" },
      ]);
      expect(overReceivedRes.status).toBe(409);
      expect((overReceivedRes.body as { error?: { message?: string } }).error?.message).toMatch(/billable/i);

      const atReceivedRes = await createBillRaw(app, authHeader, purchaseId, [
        { purchaseItemId: itemId, billedQuantity: "7", billedAmountUsd: "56000" },
      ]);
      expect(atReceivedRes.status).toBe(201);
    },
    TEST_TIMEOUT_MS,
  );
});
