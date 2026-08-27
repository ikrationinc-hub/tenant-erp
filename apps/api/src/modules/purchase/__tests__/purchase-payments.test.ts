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
    supplierBId: string;
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
  "purchase.payment.record",
];

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
    // A second supplier - proves a payment picker/filter scoped to supplier A never sees supplier B's own outstanding bills.
    const [supplierB] = await tx
      .insert(suppliers)
      .values({
        companyId: company.id,
        code: "SUP-0002",
        name: "Beta Metals Trading",
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

    if (!supplier || !supplierB || !transportMode || !portA || !portB || !warehouse || !incoterm || !item || !unit || !division || !container) {
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
        supplierBId: supplierB.id,
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

async function createApprovedBill(
  app: ReturnType<typeof createApp>,
  authHeader: string,
  tenant: SeededTenant,
  billAmountUsd: string,
  supplierId: string = tenant.purchaseRefs.supplierId,
): Promise<{ billId: string; billNumber: string }> {
  const createRes = await request(app)
    .post("/api/v1/purchases")
    .set("Authorization", authHeader)
    .send({
      purchaseDate: "2024-06-15",
      divisionId: tenant.purchaseRefs.divisionId,
      pricingType: "fixed",
      branchId: tenant.purchaseRefs.branchId,
      buyerId: tenant.purchaseRefs.buyerId,
      supplierId,
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
    .send({ itemId: tenant.itemRefs.itemId, quantity: "100", uomId: tenant.itemRefs.uomId, purchaseRateUsd: "8000", exchangeRate: "3.6725" });
  expect(itemRes.status).toBe(201);

  const issueRes = await request(app).patch(`/api/v1/purchases/${purchaseId}/issue`).set("Authorization", authHeader);
  expect(issueRes.status).toBe(200);

  const billRes = await request(app)
    .post(`/api/v1/purchases/${purchaseId}/invoices`)
    .set("Authorization", authHeader)
    .send({ invoiceDate: "2024-06-20", invoiceAmountUsd: billAmountUsd });
  expect(billRes.status).toBe(201);
  const billId = (billRes.body as { id: string }).id;
  const billNumber = (billRes.body as { invoiceNumber: string }).invoiceNumber;

  const approveRes = await request(app).patch(`/api/v1/purchases/${purchaseId}/invoices/${billId}/approve`).set("Authorization", authHeader);
  expect(approveRes.status).toBe(200);

  return { billId, billNumber };
}

interface PaymentResponse {
  id: string;
  paymentNumber: string;
  paymentAmountUsd: string;
  allocations: { billId: string; appliedAmountUsd: string }[];
}

describe("modules/purchase - Payment (PL-5: the 4th and final lifecycle document)", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "one payment settles two bills for the same supplier in one transaction - both fully paid",
    async () => {
      const tenant = await seedTenant("payment-multi-bill");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const billA = await createApprovedBill(app, authHeader, tenant, "1000.00");
      const billB = await createApprovedBill(app, authHeader, tenant, "500.00");

      const paymentRes = await request(app)
        .post("/api/v1/payments")
        .set("Authorization", authHeader)
        .send({
          supplierId: tenant.purchaseRefs.supplierId,
          paymentDate: "2024-06-25",
          paymentMode: "bank_transfer",
          referenceNumber: "WIRE-001",
          allocations: [
            { billId: billA.billId, appliedAmountUsd: "1000.00" },
            { billId: billB.billId, appliedAmountUsd: "500.00" },
          ],
        });
      expect(paymentRes.status).toBe(201);
      const payment = paymentRes.body as PaymentResponse;
      expect(payment.paymentNumber).toMatch(/^PAY-/);
      expect(payment.paymentAmountUsd).toBe("1500.00");
      expect(payment.allocations).toHaveLength(2);

      // Fetch the bills via the standalone Bills list endpoint to confirm "paid".
      const billsRes = await request(app).get(`/api/v1/purchase-bills`).set("Authorization", authHeader);
      expect(billsRes.status).toBe(200);
      const billRows = (billsRes.body as { items: { id: string; status: string }[] }).items;
      const statusById = new Map(billRows.map((row) => [row.id, row.status]));
      expect(statusById.get(billA.billId)).toBe("paid");
      expect(statusById.get(billB.billId)).toBe("paid");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a bill can be partially paid across two separate payments - stays 'approved' until the second payment completes it",
    async () => {
      const tenant = await seedTenant("payment-partial");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const bill = await createApprovedBill(app, authHeader, tenant, "1000.00");

      const firstPayment = await request(app)
        .post("/api/v1/payments")
        .set("Authorization", authHeader)
        .send({
          supplierId: tenant.purchaseRefs.supplierId,
          paymentDate: "2024-06-25",
          paymentMode: "cheque",
          allocations: [{ billId: bill.billId, appliedAmountUsd: "600.00" }],
        });
      expect(firstPayment.status).toBe(201);

      let billsRes = await request(app).get(`/api/v1/purchase-bills`).set("Authorization", authHeader);
      let billRow = (billsRes.body as { items: { id: string; status: string }[] }).items.find((row) => row.id === bill.billId);
      expect(billRow?.status).toBe("approved");

      const secondPayment = await request(app)
        .post("/api/v1/payments")
        .set("Authorization", authHeader)
        .send({
          supplierId: tenant.purchaseRefs.supplierId,
          paymentDate: "2024-06-30",
          paymentMode: "cheque",
          allocations: [{ billId: bill.billId, appliedAmountUsd: "400.00" }],
        });
      expect(secondPayment.status).toBe(201);

      billsRes = await request(app).get(`/api/v1/purchase-bills`).set("Authorization", authHeader);
      billRow = (billsRes.body as { items: { id: string; status: string }[] }).items.find((row) => row.id === bill.billId);
      expect(billRow?.status).toBe("paid");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "over-paying a bill's remaining outstanding balance is rejected",
    async () => {
      const tenant = await seedTenant("payment-overpay");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const bill = await createApprovedBill(app, authHeader, tenant, "1000.00");

      const overpayRes = await request(app)
        .post("/api/v1/payments")
        .set("Authorization", authHeader)
        .send({
          supplierId: tenant.purchaseRefs.supplierId,
          paymentDate: "2024-06-25",
          paymentMode: "cash",
          allocations: [{ billId: bill.billId, appliedAmountUsd: "1000.01" }],
        });
      expect(overpayRes.status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "paying against a draft (not yet approved) bill is rejected",
    async () => {
      const tenant = await seedTenant("payment-draft-bill");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

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
            lotNumber: "LOT-2",
            containerId: tenant.purchaseRefs.containerId,
            blNo: "BL-2",
            loadingDate: "2024-06-10",
            transportModeId: tenant.purchaseRefs.transportModeId,
            portOfLoadingId: tenant.purchaseRefs.portAId,
            portOfDischargeId: tenant.purchaseRefs.portBId,
            warehouseId: tenant.purchaseRefs.warehouseId,
            incotermId: tenant.purchaseRefs.incotermId,
          },
        });
      const purchaseId = (createRes.body as { id: string }).id;
      await request(app)
        .post(`/api/v1/purchases/${purchaseId}/items`)
        .set("Authorization", authHeader)
        .send({ itemId: tenant.itemRefs.itemId, quantity: "100", uomId: tenant.itemRefs.uomId, purchaseRateUsd: "8000", exchangeRate: "3.6725" });
      await request(app).patch(`/api/v1/purchases/${purchaseId}/issue`).set("Authorization", authHeader);

      const draftBillRes = await request(app)
        .post(`/api/v1/purchases/${purchaseId}/invoices`)
        .set("Authorization", authHeader)
        .send({ invoiceDate: "2024-06-20", invoiceAmountUsd: "1000.00" });
      const draftBillId = (draftBillRes.body as { id: string }).id;

      const paymentRes = await request(app)
        .post("/api/v1/payments")
        .set("Authorization", authHeader)
        .send({
          supplierId: tenant.purchaseRefs.supplierId,
          paymentDate: "2024-06-25",
          paymentMode: "cash",
          allocations: [{ billId: draftBillId, appliedAmountUsd: "500.00" }],
        });
      expect(paymentRes.status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the outstanding-bills picker for a supplier excludes another supplier's bills and excludes already-fully-paid bills",
    async () => {
      const tenant = await seedTenant("payment-picker");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const supplierABill = await createApprovedBill(app, authHeader, tenant, "1000.00");
      const supplierBBill = await createApprovedBill(app, authHeader, tenant, "1000.00", tenant.purchaseRefs.supplierBId);

      // Fully pay supplier A's bill - it should drop out of the picker.
      await request(app)
        .post("/api/v1/payments")
        .set("Authorization", authHeader)
        .send({
          supplierId: tenant.purchaseRefs.supplierId,
          paymentDate: "2024-06-25",
          paymentMode: "cash",
          allocations: [{ billId: supplierABill.billId, appliedAmountUsd: "1000.00" }],
        });

      const pickerRes = await request(app)
        .get(`/api/v1/payments/outstanding-bills/${tenant.purchaseRefs.supplierId}`)
        .set("Authorization", authHeader);
      expect(pickerRes.status).toBe(200);
      const pickerRows = (pickerRes.body as { items: { id: string }[] }).items;
      expect(pickerRows.map((row) => row.id)).not.toContain(supplierABill.billId);
      expect(pickerRows.map((row) => row.id)).not.toContain(supplierBBill.billId);

      const supplierBPickerRes = await request(app)
        .get(`/api/v1/payments/outstanding-bills/${tenant.purchaseRefs.supplierBId}`)
        .set("Authorization", authHeader);
      const supplierBPickerRows = (supplierBPickerRes.body as { items: { id: string; outstandingAmountUsd: string }[] }).items;
      expect(supplierBPickerRows.map((row) => row.id)).toContain(supplierBBill.billId);
      expect(supplierBPickerRows.find((row) => row.id === supplierBBill.billId)?.outstandingAmountUsd).toBe("1000.00");
    },
    TEST_TIMEOUT_MS,
  );
});
