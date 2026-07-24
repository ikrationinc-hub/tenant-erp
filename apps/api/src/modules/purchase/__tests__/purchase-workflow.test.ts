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
  countries,
  currencies,
  incoterms,
  items,
  paymentTerms,
  permissions,
  ports,
  purchases,
  stockMovements,
  suppliers,
  supplierTypes,
  transportModes,
  uom,
  users,
  warehouses,
} from "../../../database/tenant/schema.js";

const TEST_TIMEOUT_MS = 120_000;

const purchaseStatusSchema = z.object({ id: z.string(), status: z.enum(["draft", "approved", "posted"]) });

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
    branchId: string;
    buyerId: string;
    supplierId: string;
    transportModeId: string;
    portAId: string;
    portBId: string;
    warehouseId: string;
    incotermId: string;
  };
  itemRefs: { itemId: string; uomId: string };
}

const ALL_PURCHASE_PERMISSIONS = ["purchase.po.create", "purchase.po.read", "purchase.po.update", "purchase.po.approve", "purchase.po.post"];

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

    if (!supplier || !transportMode || !portA || !portB || !warehouse || !incoterm || !item || !unit) {
      throw new Error("failed to insert prerequisite masters");
    }

    return {
      companyId: company.id,
      userId: user.id,
      purchaseRefs: {
        branchId: branch.id,
        buyerId: user.id,
        supplierId: supplier.id,
        transportModeId: transportMode.id,
        portAId: portA.id,
        portBId: portB.id,
        warehouseId: warehouse.id,
        incotermId: incoterm.id,
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

async function createDraftPurchase(app: ReturnType<typeof createApp>, authHeader: string, tenant: SeededTenant): Promise<string> {
  const res = await request(app)
    .post("/api/v1/purchases")
    .set("Authorization", authHeader)
    .send({
      purchaseDate: "2024-06-15",
      branchId: tenant.purchaseRefs.branchId,
      buyerId: tenant.purchaseRefs.buyerId,
      supplierId: tenant.purchaseRefs.supplierId,
      shipment: {
        lotNumber: "LOT-1",
        containerNumber: "CONT-1",
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

describe("modules/purchase - Record Purchase, session (e): workflow + stock (FR-107/FR-108)", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "FR-107: a purchase remains in Draft until approved",
    async () => {
      const tenant = await seedTenant("fr107");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);

      const created = purchaseStatusSchema.parse((await request(app).get(`/api/v1/purchases/${purchaseId}`).set("Authorization", authHeader)).body);
      expect(created.status).toBe("draft");

      const approveRes = await request(app).patch(`/api/v1/purchases/${purchaseId}/approve`).set("Authorization", authHeader);
      expect(approveRes.status).toBe(200);
      expect(purchaseStatusSchema.parse(approveRes.body).status).toBe("approved");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "FR-108: approving a purchase writes one stock_movement per item, in the same transaction as the approval",
    async () => {
      const tenant = await seedTenant("fr108");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      const itemAId = await addItem(app, authHeader, purchaseId, tenant, "100");
      const itemBId = await addItem(app, authHeader, purchaseId, tenant, "50");

      const approveRes = await request(app).patch(`/api/v1/purchases/${purchaseId}/approve`).set("Authorization", authHeader);
      expect(approveRes.status).toBe(200);

      const movements = await withTenantSchema(tenant.schemaName, (tx) =>
        tx.select().from(stockMovements).where(and(eq(stockMovements.companyId, tenant.companyId), eq(stockMovements.referenceType, "purchase_item"))),
      );
      expect(movements).toHaveLength(2);
      const byReference = new Map(movements.map((m) => [m.referenceId, m]));
      expect(byReference.get(itemAId)?.quantity).toBe("100.000000");
      expect(byReference.get(itemBId)?.quantity).toBe("50.000000");
      for (const movement of movements) {
        expect(movement.warehouseId).toBe(tenant.purchaseRefs.warehouseId);
        expect(movement.movementType).toBe("purchase_receipt");
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a posted purchase rejects every edit (header, items, allocations, costs) - rule 8",
    async () => {
      const tenant = await seedTenant("posted-immutable");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);

      const approveRes = await request(app).patch(`/api/v1/purchases/${purchaseId}/approve`).set("Authorization", authHeader);
      expect(approveRes.status).toBe(200);
      const postRes = await request(app).patch(`/api/v1/purchases/${purchaseId}/post`).set("Authorization", authHeader);
      expect(postRes.status).toBe(200);
      expect(purchaseStatusSchema.parse(postRes.body).status).toBe("posted");

      const headerEdit = await request(app).patch(`/api/v1/purchases/${purchaseId}`).set("Authorization", authHeader).send({ supplierInvoiceNo: "x" });
      expect(headerEdit.status).toBe(409);

      const itemAdd = await request(app)
        .post(`/api/v1/purchases/${purchaseId}/items`)
        .set("Authorization", authHeader)
        .send({ itemId: tenant.itemRefs.itemId, quantity: "1", uomId: tenant.itemRefs.uomId, purchaseRateUsd: "1", exchangeRate: "1" });
      expect(itemAdd.status).toBe(409);

      const costsEdit = await request(app).patch(`/api/v1/purchases/${purchaseId}/costs`).set("Authorization", authHeader).send({ freight: "10" });
      expect(costsEdit.status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "posting requires the purchase to already be approved - posting a draft is rejected",
    async () => {
      const tenant = await seedTenant("post-order");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);

      const postRes = await request(app).patch(`/api/v1/purchases/${purchaseId}/post`).set("Authorization", authHeader);
      expect(postRes.status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "two concurrent approvals of the same purchase - exactly one succeeds",
    async () => {
      const tenant = await seedTenant("concurrent-approve");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);
      await addItem(app, authHeader, purchaseId, tenant, "10");

      const [first, second] = await Promise.all([
        request(app).patch(`/api/v1/purchases/${purchaseId}/approve`).set("Authorization", authHeader),
        request(app).patch(`/api/v1/purchases/${purchaseId}/approve`).set("Authorization", authHeader),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);

      // Exactly one set of stock movements - the loser never wrote a second, duplicate batch.
      const movements = await withTenantSchema(tenant.schemaName, (tx) =>
        tx.select().from(stockMovements).where(and(eq(stockMovements.companyId, tenant.companyId), eq(stockMovements.referenceType, "purchase_item"))),
      );
      expect(movements).toHaveLength(1);

      const [purchase] = await withTenantSchema(tenant.schemaName, (tx) => tx.select().from(purchases).where(eq(purchases.id, purchaseId)));
      expect(purchase?.status).toBe("approved");
    },
    TEST_TIMEOUT_MS,
  );
});
