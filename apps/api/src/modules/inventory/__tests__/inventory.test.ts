import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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

async function seedTenant(label: string, permissionKeys: string[]): Promise<SeededTenant> {
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
    };
  });

  await seedDefaultNumberSeries({ schemaName: tenant.schemaName, companyId, createdBy: userId });

  const role = await createRole({ schemaName: tenant.schemaName, companyId, name: `${label}-role`, createdBy: userId });
  await assignRoleToUser(tenant.schemaName, companyId, userId, role.id, userId);
  for (const key of permissionKeys) {
    const permissionId = await findPermissionId(tenant.schemaName, key);
    await grantPermissionToRole(tenant.schemaName, companyId, role.id, permissionId, userId);
  }

  const { token } = await signAccessToken({ sub: userId, tenant: tenant.id, company_id: companyId, roles: [], scope: "full" });

  return { schemaName: tenant.schemaName, companyId, userId, accessToken: token, purchaseRefs, itemRefs };
}

/** Prompt 22: stock now moves on supplier INVOICE approval, not purchase approval - approving the purchase here is still needed (an invoice can't be approved against a still-draft purchase), but it's the invoice create+approve that actually writes the movements this test suite reads back. */
async function createPurchaseWithApprovedInvoice(
  app: ReturnType<typeof createApp>,
  authHeader: string,
  tenant: SeededTenant,
  quantity: string,
): Promise<{ purchaseId: string; itemId: string }> {
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
    .send({ itemId: tenant.itemRefs.itemId, quantity, uomId: tenant.itemRefs.uomId, purchaseRateUsd: "8000", exchangeRate: "3.6725" });
  expect(itemRes.status).toBe(201);
  const itemId = (itemRes.body as { id: string }).id;

  const approveRes = await request(app).patch(`/api/v1/purchases/${purchaseId}/approve`).set("Authorization", authHeader);
  expect(approveRes.status).toBe(200);

  const invoiceRes = await request(app)
    .post(`/api/v1/purchases/${purchaseId}/invoices`)
    .set("Authorization", authHeader)
    .send({ invoiceDate: "2024-06-20", invoiceAmountUsd: "50000" });
  expect(invoiceRes.status).toBe(201);
  const invoiceId = (invoiceRes.body as { id: string }).id;

  const invoiceApproveRes = await request(app)
    .patch(`/api/v1/purchases/${purchaseId}/invoices/${invoiceId}/approve`)
    .set("Authorization", authHeader);
  expect(invoiceApproveRes.status).toBe(200);

  return { purchaseId, itemId };
}

const ALL_PURCHASE_PERMISSIONS = [
  "purchase.po.create",
  "purchase.po.read",
  "purchase.po.update",
  "purchase.po.approve",
  "purchase.po.post",
  "purchase.invoice.create",
  "purchase.invoice.approve",
];

describe("modules/inventory - Stock Ledger (FR-108 read surface)", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "GET /inventory/balances derives the balance as the sum of every movement for that item+warehouse",
    async () => {
      const tenant = await seedTenant("bal-sum", [...ALL_PURCHASE_PERMISSIONS, "inventory.stock.read"]);
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      await createPurchaseWithApprovedInvoice(app, authHeader, tenant, "100");
      await createPurchaseWithApprovedInvoice(app, authHeader, tenant, "50");

      const res = await request(app).get("/api/v1/inventory/balances").set("Authorization", authHeader);
      expect(res.status).toBe(200);

      const body = res.body as { items: Array<{ itemId: string; warehouseId: string; quantity: string }>; total: number };
      const row = body.items.find((r) => r.itemId === tenant.itemRefs.itemId && r.warehouseId === tenant.purchaseRefs.warehouseId);
      expect(row).toBeDefined();
      expect(row?.quantity).toBe("150.000000");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "GET /inventory/movements returns the raw ledger, newest first, with the source purchase resolved; GET .../movements/:itemId/:warehouseId returns the same history behind one balance",
    async () => {
      const tenant = await seedTenant("movements", [...ALL_PURCHASE_PERMISSIONS, "inventory.stock.read"]);
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const first = await createPurchaseWithApprovedInvoice(app, authHeader, tenant, "10");
      const second = await createPurchaseWithApprovedInvoice(app, authHeader, tenant, "20");

      const listRes = await request(app).get("/api/v1/inventory/movements").set("Authorization", authHeader);
      expect(listRes.status).toBe(200);
      const listBody = listRes.body as {
        items: Array<{ referenceId: string; sourcePurchaseId: string | null; sourcePurchaseNumber: string | null }>;
        total: number;
      };
      expect(listBody.total).toBe(2);
      const bySourcePurchase = new Map(listBody.items.map((m) => [m.referenceId, m]));
      expect(bySourcePurchase.get(first.itemId)?.sourcePurchaseId).toBe(first.purchaseId);
      expect(bySourcePurchase.get(second.itemId)?.sourcePurchaseId).toBe(second.purchaseId);

      const byBalanceRes = await request(app)
        .get(`/api/v1/inventory/movements/${tenant.itemRefs.itemId}/${tenant.purchaseRefs.warehouseId}`)
        .set("Authorization", authHeader);
      expect(byBalanceRes.status).toBe(200);
      const byBalanceBody = byBalanceRes.body as { items: unknown[]; total: number };
      expect(byBalanceBody.total).toBe(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "all three inventory endpoints 403 for a user without inventory.stock.read",
    async () => {
      const tenant = await seedTenant("no-perm", ALL_PURCHASE_PERMISSIONS);
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const balancesRes = await request(app).get("/api/v1/inventory/balances").set("Authorization", authHeader);
      expect(balancesRes.status).toBe(403);

      const movementsRes = await request(app).get("/api/v1/inventory/movements").set("Authorization", authHeader);
      expect(movementsRes.status).toBe(403);

      const byBalanceRes = await request(app)
        .get(`/api/v1/inventory/movements/${tenant.itemRefs.itemId}/${tenant.purchaseRefs.warehouseId}`)
        .set("Authorization", authHeader);
      expect(byBalanceRes.status).toBe(403);
    },
    TEST_TIMEOUT_MS,
  );
});
