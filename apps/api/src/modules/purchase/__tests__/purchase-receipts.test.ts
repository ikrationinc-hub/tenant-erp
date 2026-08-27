import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../../../app.js";
import { closeDbPool } from "../../../config/db.js";
import { eventBus } from "../../../common/events/bus.js";
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
    secondWarehouseId: string;
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
    const [secondWarehouse] = await tx.insert(warehouses).values({ companyId: company.id, code: "WH2", name: "Second Warehouse", createdBy: user.id }).returning();
    const [incoterm] = await tx.insert(incoterms).values({ companyId: company.id, code: "CIF", name: "Cost, Insurance and Freight", createdBy: user.id }).returning();
    const [item] = await tx.insert(items).values({ companyId: company.id, code: "CU-CATH", name: "Copper Cathode", itemType: "metals", createdBy: user.id }).returning();
    const [unit] = await tx.insert(uom).values({ companyId: company.id, code: "MT", name: "Metric Ton", createdBy: user.id }).returning();
    const [division] = await tx.insert(divisions).values({ companyId: company.id, code: "CONTAINER", name: "Container", createdBy: user.id }).returning();
    const [container] = await tx.insert(containers).values({ companyId: company.id, code: "CONT-1", name: "CONT-1", createdBy: user.id }).returning();

    if (!supplier || !transportMode || !portA || !portB || !warehouse || !secondWarehouse || !incoterm || !item || !unit || !division || !container) {
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
        secondWarehouseId: secondWarehouse.id,
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

async function createReceipt(
  app: ReturnType<typeof createApp>,
  authHeader: string,
  purchaseId: string,
  warehouseId: string,
  items: Array<{ purchaseItemId: string; receivedQuantity: string }>,
): Promise<{ status: number; body: { id?: string } }> {
  const res = await request(app)
    .post(`/api/v1/purchases/${purchaseId}/receipts`)
    .set("Authorization", authHeader)
    .send({ receiptDate: "2024-06-20", warehouseId, items });
  return { status: res.status, body: res.body as { id?: string } };
}

async function confirmReceipt(
  app: ReturnType<typeof createApp>,
  authHeader: string,
  purchaseId: string,
  receiptId: string,
): Promise<{ status: number; body: unknown }> {
  const res = await request(app).patch(`/api/v1/purchases/${purchaseId}/receipts/${receiptId}/confirm`).set("Authorization", authHeader);
  return { status: res.status, body: res.body };
}

async function movementsForReceipt(schemaName: string, companyId: string, receiptId: string) {
  return withTenantSchema(schemaName, (tx) =>
    tx
      .select()
      .from(stockMovements)
      .where(and(eq(stockMovements.companyId, companyId), eq(stockMovements.receiptId, receiptId))),
  );
}

const receiptStatusSchema = z.object({ id: z.string(), status: z.enum(["draft", "confirmed", "reversed"]) });

describe("modules/purchase - PL-1: purchase receipt moves stock, not PO approve or invoice approve", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "approving a PO writes NO stock movements - regression: the old purchase.approved stock write is gone",
    async () => {
      const tenant = await seedTenant("po-approve-no-stock");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      await addItem(app, authHeader, purchaseId, tenant, "100");

      await approvePurchase(app, authHeader, purchaseId);

      const balanceRes = await request(app).get("/api/v1/inventory/balances").set("Authorization", authHeader);
      expect(balanceRes.status).toBe(200);
      const body = balanceRes.body as { items: unknown[] };
      expect(body.items).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "creating a receipt writes NO stock - only confirming does",
    async () => {
      const tenant = await seedTenant("receipt-create-no-stock");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      const itemId = await addItem(app, authHeader, purchaseId, tenant, "100");
      await approvePurchase(app, authHeader, purchaseId);

      const { status, body } = await createReceipt(app, authHeader, purchaseId, tenant.purchaseRefs.warehouseId, [
        { purchaseItemId: itemId, receivedQuantity: "100" },
      ]);
      expect(status).toBe(201);
      const receiptId = body.id;
      if (!receiptId) throw new Error("expected a receipt id");

      const movements = await movementsForReceipt(tenant.schemaName, tenant.companyId, receiptId);
      expect(movements).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "confirming a receipt writes one signed purchase_receipt row per item, in the same transaction as the confirmation",
    async () => {
      const tenant = await seedTenant("receipt-confirm-moves-stock");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      const itemAId = await addItem(app, authHeader, purchaseId, tenant, "100");
      const itemBId = await addItem(app, authHeader, purchaseId, tenant, "50");
      await approvePurchase(app, authHeader, purchaseId);

      const { body: created } = await createReceipt(app, authHeader, purchaseId, tenant.purchaseRefs.warehouseId, [
        { purchaseItemId: itemAId, receivedQuantity: "100" },
        { purchaseItemId: itemBId, receivedQuantity: "50" },
      ]);
      const receiptId = created.id;
      if (!receiptId) throw new Error("expected a receipt id");

      const { status, body } = await confirmReceipt(app, authHeader, purchaseId, receiptId);
      expect(status).toBe(200);
      expect(receiptStatusSchema.parse(body).status).toBe("confirmed");

      const movements = await movementsForReceipt(tenant.schemaName, tenant.companyId, receiptId);
      expect(movements).toHaveLength(2);
      const byReference = new Map(movements.map((m) => [m.referenceId, m]));
      expect(byReference.get(itemAId)?.quantity).toBe("100.000000");
      expect(byReference.get(itemBId)?.quantity).toBe("50.000000");
      for (const movement of movements) {
        expect(movement.movementType).toBe("purchase_receipt");
        expect(movement.warehouseId).toBe(tenant.purchaseRefs.warehouseId);
        expect(movement.referenceType).toBe("purchase_item");
        expect(movement.receiptId).toBe(receiptId);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "partial receipt: receive 60 of 100 -> partial, balance 60; second receipt of 40 -> fully_received, balance 100",
    async () => {
      const tenant = await seedTenant("receipt-partial");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      const itemId = await addItem(app, authHeader, purchaseId, tenant, "100");
      await approvePurchase(app, authHeader, purchaseId);

      const { body: firstReceipt } = await createReceipt(app, authHeader, purchaseId, tenant.purchaseRefs.warehouseId, [
        { purchaseItemId: itemId, receivedQuantity: "60" },
      ]);
      if (!firstReceipt.id) throw new Error("expected a receipt id");
      await confirmReceipt(app, authHeader, purchaseId, firstReceipt.id);

      const afterFirst = await request(app).get(`/api/v1/purchases/${purchaseId}`).set("Authorization", authHeader);
      expect((afterFirst.body as { receivedStatus: string }).receivedStatus).toBe("partial");

      const balanceAfterFirst = await request(app).get("/api/v1/inventory/balances").set("Authorization", authHeader);
      const rowAfterFirst = (balanceAfterFirst.body as { items: Array<{ itemId: string; warehouseId: string; quantity: string }> }).items.find(
        (r) => r.itemId === tenant.itemRefs.itemId && r.warehouseId === tenant.purchaseRefs.warehouseId,
      );
      expect(rowAfterFirst?.quantity).toBe("60.000000");

      const { body: secondReceipt } = await createReceipt(app, authHeader, purchaseId, tenant.purchaseRefs.warehouseId, [
        { purchaseItemId: itemId, receivedQuantity: "40" },
      ]);
      if (!secondReceipt.id) throw new Error("expected a receipt id");
      await confirmReceipt(app, authHeader, purchaseId, secondReceipt.id);

      const afterSecond = await request(app).get(`/api/v1/purchases/${purchaseId}`).set("Authorization", authHeader);
      expect((afterSecond.body as { receivedStatus: string }).receivedStatus).toBe("fully_received");

      const balanceAfterSecond = await request(app).get("/api/v1/inventory/balances").set("Authorization", authHeader);
      const rowAfterSecond = (balanceAfterSecond.body as { items: Array<{ itemId: string; warehouseId: string; quantity: string }> }).items.find(
        (r) => r.itemId === tenant.itemRefs.itemId && r.warehouseId === tenant.purchaseRefs.warehouseId,
      );
      expect(rowAfterSecond?.quantity).toBe("100.000000");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "cannot receive 101 of 100 - over-receipt is blocked at receipt create time",
    async () => {
      const tenant = await seedTenant("receipt-over-receipt");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      const itemId = await addItem(app, authHeader, purchaseId, tenant, "100");
      await approvePurchase(app, authHeader, purchaseId);

      const { status } = await createReceipt(app, authHeader, purchaseId, tenant.purchaseRefs.warehouseId, [
        { purchaseItemId: itemId, receivedQuantity: "101" },
      ]);
      expect(status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "cannot receive 101 across two receipts either - a second receipt topping over the remaining balance is blocked",
    async () => {
      const tenant = await seedTenant("receipt-over-receipt-cumulative");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      const itemId = await addItem(app, authHeader, purchaseId, tenant, "100");
      await approvePurchase(app, authHeader, purchaseId);

      const { body: firstReceipt } = await createReceipt(app, authHeader, purchaseId, tenant.purchaseRefs.warehouseId, [
        { purchaseItemId: itemId, receivedQuantity: "60" },
      ]);
      if (!firstReceipt.id) throw new Error("expected a receipt id");
      await confirmReceipt(app, authHeader, purchaseId, firstReceipt.id);

      const { status } = await createReceipt(app, authHeader, purchaseId, tenant.purchaseRefs.warehouseId, [
        { purchaseItemId: itemId, receivedQuantity: "41" },
      ]);
      expect(status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "cannot confirm a receipt with zero items - creating one is already blocked by the validator, so this is exercised at the schema/service boundary",
    async () => {
      const tenant = await seedTenant("receipt-zero-items");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      await addItem(app, authHeader, purchaseId, tenant, "10");
      await approvePurchase(app, authHeader, purchaseId);

      const res = await request(app)
        .post(`/api/v1/purchases/${purchaseId}/receipts`)
        .set("Authorization", authHeader)
        .send({ receiptDate: "2024-06-20", warehouseId: tenant.purchaseRefs.warehouseId, items: [] });
      expect(res.status).toBe(422);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "cannot receive against a purchase that is still Draft - issue/approve it first",
    async () => {
      const tenant = await seedTenant("receipt-needs-po-approved");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      const itemId = await addItem(app, authHeader, purchaseId, tenant, "10");

      const { status } = await createReceipt(app, authHeader, purchaseId, tenant.purchaseRefs.warehouseId, [
        { purchaseItemId: itemId, receivedQuantity: "10" },
      ]);
      expect(status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "balance is SUM(movements) - two receipts against two different warehouses stay separate balance rows",
    async () => {
      const tenant = await seedTenant("receipt-two-warehouses");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      const itemId = await addItem(app, authHeader, purchaseId, tenant, "100");
      await approvePurchase(app, authHeader, purchaseId);

      const { body: r1 } = await createReceipt(app, authHeader, purchaseId, tenant.purchaseRefs.warehouseId, [
        { purchaseItemId: itemId, receivedQuantity: "30" },
      ]);
      if (!r1.id) throw new Error("expected a receipt id");
      await confirmReceipt(app, authHeader, purchaseId, r1.id);

      const { body: r2 } = await createReceipt(app, authHeader, purchaseId, tenant.purchaseRefs.secondWarehouseId, [
        { purchaseItemId: itemId, receivedQuantity: "20" },
      ]);
      if (!r2.id) throw new Error("expected a receipt id");
      await confirmReceipt(app, authHeader, purchaseId, r2.id);

      const balanceRes = await request(app).get("/api/v1/inventory/balances").set("Authorization", authHeader);
      const rows = (balanceRes.body as { items: Array<{ itemId: string; warehouseId: string; quantity: string }> }).items.filter(
        (r) => r.itemId === tenant.itemRefs.itemId,
      );
      const wh1 = rows.find((r) => r.warehouseId === tenant.purchaseRefs.warehouseId);
      const wh2 = rows.find((r) => r.warehouseId === tenant.purchaseRefs.secondWarehouseId);
      expect(wh1?.quantity).toBe("30.000000");
      expect(wh2?.quantity).toBe("20.000000");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "editing a purchase item is blocked once ANY receipt (even draft) exists against the purchase",
    async () => {
      const tenant = await seedTenant("receipt-locks-items");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      const itemId = await addItem(app, authHeader, purchaseId, tenant, "100");
      await approvePurchase(app, authHeader, purchaseId);

      const { body: created } = await createReceipt(app, authHeader, purchaseId, tenant.purchaseRefs.warehouseId, [
        { purchaseItemId: itemId, receivedQuantity: "10" },
      ]);
      expect(created.id).toBeDefined();

      const editRes = await request(app)
        .patch(`/api/v1/purchases/${purchaseId}/items/${itemId}`)
        .set("Authorization", authHeader)
        .send({ quantity: "999" });
      expect(editRes.status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the receipt number is never null and follows the PR-{FY}-{0000} pattern, distinct from the purchase's own number",
    async () => {
      const tenant = await seedTenant("receipt-numbering");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      const itemId = await addItem(app, authHeader, purchaseId, tenant, "10");
      await approvePurchase(app, authHeader, purchaseId);

      const res = await request(app)
        .post(`/api/v1/purchases/${purchaseId}/receipts`)
        .set("Authorization", authHeader)
        .send({ receiptDate: "2024-06-20", warehouseId: tenant.purchaseRefs.warehouseId, items: [{ purchaseItemId: itemId, receivedQuantity: "10" }] });
      expect(res.status).toBe(201);
      const body = res.body as { receiptNumber: string };
      expect(body.receiptNumber).toMatch(/^PR-2024-\d{4}$/);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "receipts are visible on GET /purchases/:id, and gapless numbering holds under concurrent creates",
    async () => {
      const tenant = await seedTenant("receipt-concurrency");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      const itemId = await addItem(app, authHeader, purchaseId, tenant, "100");
      await approvePurchase(app, authHeader, purchaseId);

      const concurrentCreates = await Promise.all(
        Array.from({ length: 5 }, () =>
          createReceipt(app, authHeader, purchaseId, tenant.purchaseRefs.warehouseId, [{ purchaseItemId: itemId, receivedQuantity: "1" }]).catch(
            () => ({ status: 500, body: {} }),
          ),
        ),
      );
      const succeeded = concurrentCreates.filter((r) => r.status === 201);
      const numbers = succeeded.map((r) => (r.body as { receiptNumber?: string }).receiptNumber).filter((n): n is string => !!n);
      expect(new Set(numbers).size).toBe(numbers.length);

      const res = await request(app).get(`/api/v1/purchases/${purchaseId}`).set("Authorization", authHeader);
      expect(res.status).toBe(200);
      const body = res.body as { receipts: Array<{ id: string }> };
      expect(body.receipts.length).toBe(succeeded.length);
    },
    TEST_TIMEOUT_MS,
  );

  /** DrizzleQueryError's own .message is just "Failed query: ...", never the underlying Postgres error text - the real CHECK-violation detail (constraint name, code 23514) lives on .cause, the raw node-postgres error. */
  async function expectCheckViolation(promise: Promise<unknown>): Promise<void> {
    let caught: unknown;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const cause = (caught as { cause?: { message?: string; code?: string } }).cause;
    expect(cause?.code).toBe("23514");
    expect(cause?.message).toMatch(/stock_movements_sign_matches_type/);
  }

  it(
    "sign enforcement: a purchase_receipt row with a negative quantity, or a purchase_reversal row with a positive one, is rejected at the database level",
    async () => {
      const tenant = await seedTenant("sign-enforcement");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      await addItem(app, authHeader, purchaseId, tenant, "10");
      await approvePurchase(app, authHeader, purchaseId);

      await expectCheckViolation(
        withTenantSchema(tenant.schemaName, (tx) =>
          tx.insert(stockMovements).values({
            companyId: tenant.companyId,
            itemId: tenant.itemRefs.itemId,
            warehouseId: tenant.purchaseRefs.warehouseId,
            quantity: "-5.000000",
            uomId: tenant.itemRefs.uomId,
            movementType: "purchase_receipt",
            movementDate: "2024-06-25",
            referenceType: "purchase_item",
            referenceId: randomUUID(),
            createdBy: tenant.userId,
          }),
        ),
      );

      await expectCheckViolation(
        withTenantSchema(tenant.schemaName, (tx) =>
          tx.insert(stockMovements).values({
            companyId: tenant.companyId,
            itemId: tenant.itemRefs.itemId,
            warehouseId: tenant.purchaseRefs.warehouseId,
            quantity: "5.000000",
            uomId: tenant.itemRefs.uomId,
            movementType: "purchase_reversal",
            movementDate: "2024-06-25",
            referenceType: "purchase_item",
            referenceId: randomUUID(),
            createdBy: tenant.userId,
          }),
        ),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a forced failure in the receipt confirm stock write rolls back the whole confirmation - no orphan confirmed receipt, no orphan movement",
    async () => {
      // eventBus has no off(): once registered, this throwing handler stays
      // registered for every remaining "receipt.confirmed" emit in THIS
      // test file's module instance (Vitest isolates modules per file).
      // MUST be the last test in this file - every test after this one
      // would have its own confirmReceipt() call hit this handler too.
      eventBus.on("receipt.confirmed", () => {
        throw new Error("simulated stock-write failure");
      });

      const tenant = await seedTenant("receipt-confirm-rollback");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      const itemId = await addItem(app, authHeader, purchaseId, tenant, "60");
      await approvePurchase(app, authHeader, purchaseId);
      const { body: created } = await createReceipt(app, authHeader, purchaseId, tenant.purchaseRefs.warehouseId, [
        { purchaseItemId: itemId, receivedQuantity: "60" },
      ]);
      const receiptId = created.id;
      if (!receiptId) throw new Error("expected a receipt id");

      const { status } = await confirmReceipt(app, authHeader, purchaseId, receiptId);
      expect(status).toBe(500);

      const [receipt] = await withTenantSchema(tenant.schemaName, (tx) => tx.select().from(purchaseReceipts).where(eq(purchaseReceipts.id, receiptId)));
      expect(receipt?.status).toBe("draft");

      const movements = await movementsForReceipt(tenant.schemaName, tenant.companyId, receiptId);
      expect(movements).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );
});
