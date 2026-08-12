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
  purchaseInvoices,
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
  "purchase.po.approve",
  "purchase.po.post",
  "purchase.invoice.create",
  "purchase.invoice.update",
  "purchase.invoice.approve",
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
  const res = await request(app).patch(`/api/v1/purchases/${purchaseId}/approve`).set("Authorization", authHeader);
  expect(res.status).toBe(200);
}

async function createInvoice(
  app: ReturnType<typeof createApp>,
  authHeader: string,
  purchaseId: string,
  invoiceAmountUsd = "50000",
): Promise<string> {
  const res = await request(app)
    .post(`/api/v1/purchases/${purchaseId}/invoices`)
    .set("Authorization", authHeader)
    .send({ invoiceDate: "2024-06-20", invoiceAmountUsd });
  expect(res.status).toBe(201);
  return (res.body as { id: string }).id;
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

async function movementsFor(schemaName: string, companyId: string, invoiceId: string) {
  return withTenantSchema(schemaName, (tx) =>
    tx
      .select()
      .from(stockMovements)
      .where(and(eq(stockMovements.companyId, companyId), eq(stockMovements.purchaseInvoiceId, invoiceId))),
  );
}

const invoiceStatusSchema = z.object({ id: z.string(), status: z.enum(["draft", "approved", "reversed"]) });

describe("modules/purchase - Prompt 22: supplier invoice moves stock, not purchase approval", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "approving a supplier invoice writes one signed purchase_receipt row per item, in the same transaction as the approval",
    async () => {
      const tenant = await seedTenant("sinv-approve");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      const itemAId = await addItem(app, authHeader, purchaseId, tenant, "100");
      const itemBId = await addItem(app, authHeader, purchaseId, tenant, "50");
      await approvePurchase(app, authHeader, purchaseId);
      const invoiceId = await createInvoice(app, authHeader, purchaseId);

      const { status, body } = await approveInvoice(app, authHeader, purchaseId, invoiceId);
      expect(status).toBe(200);
      expect(invoiceStatusSchema.parse(body).status).toBe("approved");

      const movements = await movementsFor(tenant.schemaName, tenant.companyId, invoiceId);
      expect(movements).toHaveLength(2);
      const byReference = new Map(movements.map((m) => [m.referenceId, m]));
      expect(byReference.get(itemAId)?.quantity).toBe("100.000000");
      expect(byReference.get(itemBId)?.quantity).toBe("50.000000");
      for (const movement of movements) {
        expect(movement.movementType).toBe("purchase_receipt");
        expect(movement.warehouseId).toBe(tenant.purchaseRefs.warehouseId);
        expect(movement.referenceType).toBe("purchase_item");
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "GET /inventory/balances reflects the invoice receipt correctly - balance is SUM(movements)",
    async () => {
      const tenant = await seedTenant("sinv-balance");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      await addItem(app, authHeader, purchaseId, tenant, "75");
      await approvePurchase(app, authHeader, purchaseId);
      const invoiceId = await createInvoice(app, authHeader, purchaseId);
      await approveInvoice(app, authHeader, purchaseId, invoiceId);

      const res = await request(app).get("/api/v1/inventory/balances").set("Authorization", authHeader);
      expect(res.status).toBe(200);
      const body = res.body as { items: Array<{ itemId: string; warehouseId: string; quantity: string }> };
      const row = body.items.find((r) => r.itemId === tenant.itemRefs.itemId && r.warehouseId === tenant.purchaseRefs.warehouseId);
      expect(row?.quantity).toBe("75.000000");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "invoice approval is rejected while the underlying purchase is still Draft",
    async () => {
      const tenant = await seedTenant("sinv-needs-po-approved");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      await addItem(app, authHeader, purchaseId, tenant, "10");
      const invoiceId = await createInvoice(app, authHeader, purchaseId);

      const { status } = await approveInvoice(app, authHeader, purchaseId, invoiceId);
      expect(status).toBe(409);

      const movements = await movementsFor(tenant.schemaName, tenant.companyId, invoiceId);
      expect(movements).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a purchase already has an invoice - a second one is rejected (ALLOW_PARTIAL_INVOICING is off by default)",
    async () => {
      const tenant = await seedTenant("sinv-single-default");
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
      expect(secondRes.status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  describe("edit-after-invoice-approval: re-approval + reconciliation", () => {
    it(
      "a quantity change on an approved purchase's item flips its approved invoice back to draft, without touching stock yet",
      async () => {
        const tenant = await seedTenant("reapproval-trigger");
        const app = createApp();
        const authHeader = `Bearer ${tenant.accessToken}`;
        const purchaseId = await createDraftPurchase(app, authHeader, tenant);
        const itemId = await addItem(app, authHeader, purchaseId, tenant, "100");
        await approvePurchase(app, authHeader, purchaseId);
        const invoiceId = await createInvoice(app, authHeader, purchaseId);
        await approveInvoice(app, authHeader, purchaseId, invoiceId);

        const movementsBeforeEdit = await movementsFor(tenant.schemaName, tenant.companyId, invoiceId);
        expect(movementsBeforeEdit).toHaveLength(1);

        const editRes = await request(app)
          .patch(`/api/v1/purchases/${purchaseId}/items/${itemId}`)
          .set("Authorization", authHeader)
          .send({ quantity: "130" });
        expect(editRes.status).toBe(200);

        const [invoice] = await withTenantSchema(tenant.schemaName, (tx) => tx.select().from(purchaseInvoices).where(eq(purchaseInvoices.id, invoiceId)));
        expect(invoice?.status).toBe("draft");

        // Stock hasn't moved yet - reconciliation only happens on re-approval, not on the edit itself.
        const movementsAfterEdit = await movementsFor(tenant.schemaName, tenant.companyId, invoiceId);
        expect(movementsAfterEdit).toHaveLength(1);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "re-approval reconciles stock: reverses the previously-moved quantity and writes the corrected one, existing movements untouched, final balance correct",
      async () => {
        const tenant = await seedTenant("reapproval-reconcile");
        const app = createApp();
        const authHeader = `Bearer ${tenant.accessToken}`;
        const purchaseId = await createDraftPurchase(app, authHeader, tenant);
        const itemId = await addItem(app, authHeader, purchaseId, tenant, "100");
        await approvePurchase(app, authHeader, purchaseId);
        const invoiceId = await createInvoice(app, authHeader, purchaseId);
        await approveInvoice(app, authHeader, purchaseId, invoiceId);

        const [originalReceipt] = await movementsFor(tenant.schemaName, tenant.companyId, invoiceId);
        if (!originalReceipt) {
          throw new Error("expected the first approval to have written a receipt");
        }
        expect(originalReceipt.quantity).toBe("100.000000");

        await request(app).patch(`/api/v1/purchases/${purchaseId}/items/${itemId}`).set("Authorization", authHeader).send({ quantity: "130" });

        const { status, body } = await approveInvoice(app, authHeader, purchaseId, invoiceId);
        expect(status).toBe(200);
        expect(invoiceStatusSchema.parse(body).status).toBe("approved");

        const allMovements = await movementsFor(tenant.schemaName, tenant.companyId, invoiceId);
        expect(allMovements).toHaveLength(3);

        // The ORIGINAL row is untouched - same id, same quantity, same everything.
        const stillOriginal = allMovements.find((m) => m.id === originalReceipt.id);
        expect(stillOriginal).toEqual(originalReceipt);

        const reversal = allMovements.find((m) => m.movementType === "purchase_reversal");
        expect(reversal?.quantity).toBe("-100.000000");
        expect(reversal?.reversalOfMovementId).toBe(originalReceipt.id);

        const newReceipt = allMovements.find((m) => m.movementType === "purchase_receipt" && m.id !== originalReceipt.id);
        expect(newReceipt?.quantity).toBe("130.000000");

        // Net effect: 100 (original, still on the ledger) - 100 (reversal) + 130 (corrected) = 130.
        const balanceRes = await request(app).get("/api/v1/inventory/balances").set("Authorization", authHeader);
        const balanceBody = balanceRes.body as { items: Array<{ itemId: string; warehouseId: string; quantity: string }> };
        const row = balanceBody.items.find((r) => r.itemId === tenant.itemRefs.itemId && r.warehouseId === tenant.purchaseRefs.warehouseId);
        expect(row?.quantity).toBe("130.000000");
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "reconciliation never UPDATEs or DELETEs a stock_movement row - a second re-approval cycle still leaves every prior row byte-identical",
      async () => {
        const tenant = await seedTenant("reapproval-append-only");
        const app = createApp();
        const authHeader = `Bearer ${tenant.accessToken}`;
        const purchaseId = await createDraftPurchase(app, authHeader, tenant);
        const itemId = await addItem(app, authHeader, purchaseId, tenant, "50");
        await approvePurchase(app, authHeader, purchaseId);
        const invoiceId = await createInvoice(app, authHeader, purchaseId);
        await approveInvoice(app, authHeader, purchaseId, invoiceId);

        await request(app).patch(`/api/v1/purchases/${purchaseId}/items/${itemId}`).set("Authorization", authHeader).send({ quantity: "80" });
        await approveInvoice(app, authHeader, purchaseId, invoiceId);
        const afterFirstReapproval = await movementsFor(tenant.schemaName, tenant.companyId, invoiceId);
        expect(afterFirstReapproval).toHaveLength(3);

        await request(app).patch(`/api/v1/purchases/${purchaseId}/items/${itemId}`).set("Authorization", authHeader).send({ quantity: "20" });
        const { status } = await approveInvoice(app, authHeader, purchaseId, invoiceId);
        expect(status).toBe(200);

        const afterSecondReapproval = await movementsFor(tenant.schemaName, tenant.companyId, invoiceId);
        expect(afterSecondReapproval).toHaveLength(5);

        // Every row from the first reapproval cycle survives, completely unchanged.
        const byId = new Map(afterSecondReapproval.map((m) => [m.id, m]));
        for (const row of afterFirstReapproval) {
          expect(byId.get(row.id)).toEqual(row);
        }

        const balanceRes = await request(app).get("/api/v1/inventory/balances").set("Authorization", authHeader);
        const balanceBody = balanceRes.body as { items: Array<{ itemId: string; warehouseId: string; quantity: string }> };
        const row = balanceBody.items.find((r) => r.itemId === tenant.itemRefs.itemId && r.warehouseId === tenant.purchaseRefs.warehouseId);
        expect(row?.quantity).toBe("20.000000");
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "a non-quantity item update (no add, no quantity change) does NOT force the approved invoice back to draft",
      async () => {
        const tenant = await seedTenant("reapproval-not-triggered");
        const app = createApp();
        const authHeader = `Bearer ${tenant.accessToken}`;
        const purchaseId = await createDraftPurchase(app, authHeader, tenant);
        const itemId = await addItem(app, authHeader, purchaseId, tenant, "40");
        await approvePurchase(app, authHeader, purchaseId);
        const invoiceId = await createInvoice(app, authHeader, purchaseId);
        await approveInvoice(app, authHeader, purchaseId, invoiceId);

        // Resubmitting the SAME quantity is not a real change.
        const sameQtyRes = await request(app)
          .patch(`/api/v1/purchases/${purchaseId}/items/${itemId}`)
          .set("Authorization", authHeader)
          .send({ quantity: "40" });
        expect(sameQtyRes.status).toBe(200);

        const [invoice] = await withTenantSchema(tenant.schemaName, (tx) => tx.select().from(purchaseInvoices).where(eq(purchaseInvoices.id, invoiceId)));
        expect(invoice?.status).toBe("approved");

        const movements = await movementsFor(tenant.schemaName, tenant.companyId, invoiceId);
        expect(movements).toHaveLength(1);
      },
      TEST_TIMEOUT_MS,
    );
  });

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
    "sign enforcement: a purchase_reversal row with a positive quantity is rejected at the database level",
    async () => {
      const tenant = await seedTenant("sign-enforcement");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      await addItem(app, authHeader, purchaseId, tenant, "10");
      await approvePurchase(app, authHeader, purchaseId);
      const invoiceId = await createInvoice(app, authHeader, purchaseId);
      await approveInvoice(app, authHeader, purchaseId, invoiceId);

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
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the invoice's own fields lock once approved - an edit is rejected, matching the purchase header's own Draft-only lock",
    async () => {
      const tenant = await seedTenant("sinv-fields-lock");
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
    "a posted purchase's items are still fully immutable - even with an approved invoice",
    async () => {
      const tenant = await seedTenant("posted-still-immutable");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      const itemId = await addItem(app, authHeader, purchaseId, tenant, "10");
      await approvePurchase(app, authHeader, purchaseId);
      const invoiceId = await createInvoice(app, authHeader, purchaseId);
      await approveInvoice(app, authHeader, purchaseId, invoiceId);

      const postRes = await request(app).patch(`/api/v1/purchases/${purchaseId}/post`).set("Authorization", authHeader);
      expect(postRes.status).toBe(200);

      const editRes = await request(app)
        .patch(`/api/v1/purchases/${purchaseId}/items/${itemId}`)
        .set("Authorization", authHeader)
        .send({ quantity: "999" });
      expect(editRes.status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "adding a whole new item to an approved purchase forces re-approval too, not just a quantity edit",
    async () => {
      const tenant = await seedTenant("reapproval-on-add");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      await addItem(app, authHeader, purchaseId, tenant, "10");
      await approvePurchase(app, authHeader, purchaseId);
      const invoiceId = await createInvoice(app, authHeader, purchaseId);
      await approveInvoice(app, authHeader, purchaseId, invoiceId);

      await addItem(app, authHeader, purchaseId, tenant, "5");

      const [invoice] = await withTenantSchema(tenant.schemaName, (tx) => tx.select().from(purchaseInvoices).where(eq(purchaseInvoices.id, invoiceId)));
      expect(invoice?.status).toBe("draft");

      const { status } = await approveInvoice(app, authHeader, purchaseId, invoiceId);
      expect(status).toBe(200);

      const balanceRes = await request(app).get("/api/v1/inventory/balances").set("Authorization", authHeader);
      const balanceBody = balanceRes.body as { items: Array<{ itemId: string; warehouseId: string; quantity: string }> };
      const row = balanceBody.items.find((r) => r.itemId === tenant.itemRefs.itemId && r.warehouseId === tenant.purchaseRefs.warehouseId);
      // 10 (first item, unaffected - no prior receipt for it, so no reversal) + 5 (second item, added after approval).
      expect(row?.quantity).toBe("15.000000");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the invoice number is never null and follows the SINV-{FY}-{0000} pattern, distinct from the purchase's own number",
    async () => {
      const tenant = await seedTenant("sinv-numbering");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      await addItem(app, authHeader, purchaseId, tenant, "10");
      await approvePurchase(app, authHeader, purchaseId);

      const res = await request(app)
        .post(`/api/v1/purchases/${purchaseId}/invoices`)
        .set("Authorization", authHeader)
        .send({ invoiceDate: "2024-06-20", invoiceAmountUsd: "50000" });
      expect(res.status).toBe(201);
      const body = res.body as { invoiceNumber: string };
      expect(body.invoiceNumber).toMatch(/^SINV-2024-\d{4}$/);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the invoice is visible on GET /purchases/:id alongside its other sub-resources",
    async () => {
      const tenant = await seedTenant("sinv-in-getById");
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
    "invoiceAmountUsd is mandatory - creating an invoice without one is rejected",
    async () => {
      const tenant = await seedTenant("sinv-amount-mandatory");
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
    "GET /purchases/:id computes the invoice's variance against the purchase's own computed items total - informational, never blocking",
    async () => {
      const tenant = await seedTenant("sinv-variance");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      // quantity 10 x purchaseRateUsd 8000 (addItem's fixed rate) = 80000.00 purchase items total.
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
    "a forced failure in the invoice-approval stock write rolls back the whole approval - no orphan approved invoice, no orphan movement",
    async () => {
      // eventBus has no off(): once registered, this throwing handler stays
      // registered for every remaining "invoice.approved" emit in THIS test
      // file's module instance (Vitest isolates modules per file). MUST be
      // the last test in this file - every test after this one would have
      // its own approveInvoice() call hit this handler too.
      eventBus.on("invoice.approved", () => {
        throw new Error("simulated stock-write failure");
      });

      const tenant = await seedTenant("sinv-rollback");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      await addItem(app, authHeader, purchaseId, tenant, "60");
      await approvePurchase(app, authHeader, purchaseId);
      const invoiceId = await createInvoice(app, authHeader, purchaseId);

      const { status } = await approveInvoice(app, authHeader, purchaseId, invoiceId);
      expect(status).toBe(500);

      const [invoice] = await withTenantSchema(tenant.schemaName, (tx) => tx.select().from(purchaseInvoices).where(eq(purchaseInvoices.id, invoiceId)));
      expect(invoice?.status).toBe("draft");

      const movements = await movementsFor(tenant.schemaName, tenant.companyId, invoiceId);
      expect(movements).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );
});
