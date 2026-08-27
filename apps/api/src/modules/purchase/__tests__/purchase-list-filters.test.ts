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
    divisionBId: string;
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
];

/** Mirrors purchase-bills.test.ts's own seedTenant, plus a SECOND division - divisionId filtering (PL-4) needs at least two divisions to distinguish "filtered" from "everything happens to match". */
async function seedTenant(label: string): Promise<SeededTenant> {
  const unique = randomUUID().slice(0, 8);
  const tenant = await createTenantSchema({ name: `${label} Co`, slug: `${label}-${unique}` });

  const { companyId, userId, purchaseRefs, itemRefs } = await withTenantSchema(tenant.schemaName, async (tx) => {
    const [company] = await tx
      .insert(companies)
      .values({ name: `${label} Co`, fiscalYearStartMonth: 1, timezone: "America/New_York", createdBy: randomUUID() })
      .returning();
    if (!company) throw new Error("failed to insert company");
    const [user] = await tx
      .insert(users)
      .values({ companyId: company.id, email: `${label}-${unique}@example.com`, name: `${label} Admin`, status: "active", createdBy: randomUUID() })
      .returning();
    if (!user) throw new Error("failed to insert user");

    const [branch] = await tx.insert(branches).values({ companyId: company.id, name: "Main Branch", code: "MAIN", createdBy: user.id }).returning();
    const [supplierType] = await tx.insert(supplierTypes).values({ companyId: company.id, code: "LOCAL", name: "Local", createdBy: user.id }).returning();
    const [country] = await tx.insert(countries).values({ companyId: company.id, code: "AE", name: "UAE", createdBy: user.id }).returning();
    const [paymentTerm] = await tx.insert(paymentTerms).values({ companyId: company.id, code: "NET30", name: "30 Days", createdBy: user.id }).returning();
    const [currency] = await tx.insert(currencies).values({ companyId: company.id, code: "USD", name: "US Dollar", createdBy: user.id }).returning();
    if (!branch || !supplierType || !country || !paymentTerm || !currency) throw new Error("failed to insert prerequisite masters");

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
    const [divisionB] = await tx.insert(divisions).values({ companyId: company.id, code: "BULK", name: "Bulk", createdBy: user.id }).returning();
    const [container] = await tx.insert(containers).values({ companyId: company.id, code: "CONT-1", name: "CONT-1", createdBy: user.id }).returning();

    if (!supplier || !transportMode || !portA || !portB || !warehouse || !incoterm || !item || !unit || !division || !divisionB || !container) {
      throw new Error("failed to insert prerequisite masters");
    }

    return {
      companyId: company.id,
      userId: user.id,
      purchaseRefs: {
        divisionId: division.id,
        divisionBId: divisionB.id,
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

async function createIssuedPurchase(
  app: ReturnType<typeof createApp>,
  authHeader: string,
  tenant: SeededTenant,
  quantity: string,
  divisionId: string,
): Promise<{ purchaseId: string; purchaseItemId: string }> {
  const createRes = await request(app)
    .post("/api/v1/purchases")
    .set("Authorization", authHeader)
    .send({
      purchaseDate: "2024-06-15",
      divisionId,
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
  const purchaseItemId = (itemRes.body as { id: string }).id;

  const issueRes = await request(app).patch(`/api/v1/purchases/${purchaseId}/issue`).set("Authorization", authHeader);
  expect(issueRes.status).toBe(200);

  return { purchaseId, purchaseItemId };
}

async function receive(
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

async function billAndApprove(
  app: ReturnType<typeof createApp>,
  authHeader: string,
  purchaseId: string,
  purchaseItemId: string,
  billedQuantity: string,
): Promise<void> {
  const res = await request(app)
    .post(`/api/v1/purchases/${purchaseId}/invoices`)
    .set("Authorization", authHeader)
    .send({ invoiceDate: "2024-06-20", invoiceAmountUsd: "50000", items: [{ purchaseItemId, billedQuantity, billedAmountUsd: "50000" }] });
  expect(res.status).toBe(201);
  const invoiceId = (res.body as { id: string }).id;
  const approveRes = await request(app).patch(`/api/v1/purchases/${purchaseId}/invoices/${invoiceId}/approve`).set("Authorization", authHeader);
  expect(approveRes.status).toBe(200);
}

interface ListRow {
  id: string;
  receivedStatus: string;
  billedStatus: string;
  divisionId: string | null;
}
interface ListResponse {
  items: ListRow[];
  total: number;
}

describe("modules/purchase - list() fulfilment filters (PL-4: receivedStatus/billedStatus/divisionId)", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "receivedStatus/billedStatus classify correctly at the SQL level (not_received/partial/fully_received, not_billed/partial/fully_billed) and pagination totals reflect the filtered set, not the whole page",
    async () => {
      const tenant = await seedTenant("list-filters");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const { warehouseId, divisionId, divisionBId } = tenant.purchaseRefs;

      // Purchase A (division A): nothing received, nothing billed.
      const a = await createIssuedPurchase(app, authHeader, tenant, "100", divisionId);
      // Purchase B (division A): partially received, not billed.
      const b = await createIssuedPurchase(app, authHeader, tenant, "100", divisionId);
      await receive(app, authHeader, b.purchaseId, warehouseId, b.purchaseItemId, "40");
      // Purchase C (division B): fully received, partially billed.
      const c = await createIssuedPurchase(app, authHeader, tenant, "100", divisionBId);
      await receive(app, authHeader, c.purchaseId, warehouseId, c.purchaseItemId, "100");
      await billAndApprove(app, authHeader, c.purchaseId, c.purchaseItemId, "30");
      // Purchase D (division B): fully received, fully billed.
      const d = await createIssuedPurchase(app, authHeader, tenant, "100", divisionBId);
      await receive(app, authHeader, d.purchaseId, warehouseId, d.purchaseItemId, "100");
      await billAndApprove(app, authHeader, d.purchaseId, d.purchaseItemId, "100");

      const listWith = async (query: string): Promise<ListResponse> => {
        const res = await request(app).get(`/api/v1/purchases?${query}`).set("Authorization", authHeader);
        expect(res.status).toBe(200);
        return res.body as ListResponse;
      };

      const notReceived = await listWith("receivedStatus=not_received&pageSize=50");
      expect(notReceived.items.map((row) => row.id)).toEqual([a.purchaseId]);
      expect(notReceived.total).toBe(1);

      const partialReceived = await listWith("receivedStatus=partial&pageSize=50");
      expect(partialReceived.items.map((row) => row.id)).toEqual([b.purchaseId]);

      const fullyReceived = await listWith("receivedStatus=fully_received&pageSize=50");
      expect(fullyReceived.items.map((row) => row.id).sort()).toEqual([c.purchaseId, d.purchaseId].sort());

      const notBilled = await listWith("billedStatus=not_billed&pageSize=50");
      expect(notBilled.items.map((row) => row.id).sort()).toEqual([a.purchaseId, b.purchaseId].sort());

      const partialBilled = await listWith("billedStatus=partial&pageSize=50");
      expect(partialBilled.items.map((row) => row.id)).toEqual([c.purchaseId]);

      const fullyBilled = await listWith("billedStatus=fully_billed&pageSize=50");
      expect(fullyBilled.items.map((row) => row.id)).toEqual([d.purchaseId]);

      // divisionId narrows independently of the fulfilment axes.
      const divisionARows = await listWith(`divisionId=${divisionId}&pageSize=50`);
      expect(divisionARows.items.map((row) => row.id).sort()).toEqual([a.purchaseId, b.purchaseId].sort());

      // Combining both: division B AND fully received AND NOT fully billed -> only C.
      const combined = await listWith(`divisionId=${divisionBId}&receivedStatus=fully_received&billedStatus=partial&pageSize=50`);
      expect(combined.items.map((row) => row.id)).toEqual([c.purchaseId]);

      // Every row on the unfiltered list also carries its own receivedStatus/billedStatus (the list's own derived columns), not just the filtered subsets above.
      const all = await listWith("pageSize=50");
      const byId = new Map(all.items.map((row) => [row.id, row]));
      expect(byId.get(a.purchaseId)?.receivedStatus).toBe("not_received");
      expect(byId.get(b.purchaseId)?.receivedStatus).toBe("partial");
      expect(byId.get(c.purchaseId)?.billedStatus).toBe("partial");
      expect(byId.get(d.purchaseId)?.billedStatus).toBe("fully_billed");
    },
    TEST_TIMEOUT_MS,
  );
});
