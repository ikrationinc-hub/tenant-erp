import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
  customers,
  divisions,
  incoterms,
  paymentTerms,
  permissions,
  ports,
  purchases,
  suppliers,
  supplierTypes,
  transportModes,
  users,
  warehouses,
} from "../../../database/tenant/schema.js";

const TEST_TIMEOUT_MS = 120_000;

const allocationRowSchema = z.object({
  id: z.string(),
  purchaseId: z.string(),
  reservedCustomerId: z.string(),
  allocationPct: z.string(),
});

function asAllocation(res: { body: unknown }) {
  return allocationRowSchema.parse(res.body);
}

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
  customerAId: string;
  customerBId: string;
}

const ALL_PURCHASE_PERMISSIONS = ["purchase.po.create", "purchase.po.read", "purchase.po.update"];

async function seedTenant(label: string): Promise<SeededTenant> {
  const unique = randomUUID().slice(0, 8);
  const tenant = await createTenantSchema({ name: `${label} Co`, slug: `${label}-${unique}` });

  const { companyId, userId, purchaseRefs, customerAId, customerBId } = await withTenantSchema(tenant.schemaName, async (tx) => {
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

    const [customerA] = await tx.insert(customers).values({ companyId: company.id, code: "CUST-A", name: "Customer A", createdBy: user.id }).returning();
    const [customerB] = await tx.insert(customers).values({ companyId: company.id, code: "CUST-B", name: "Customer B", createdBy: user.id }).returning();
    const [division] = await tx.insert(divisions).values({ companyId: company.id, code: "CONTAINER", name: "Container", createdBy: user.id }).returning();
    const [container] = await tx.insert(containers).values({ companyId: company.id, code: "CONT-1", name: "CONT-1", createdBy: user.id }).returning();

    if (!supplier || !transportMode || !portA || !portB || !warehouse || !incoterm || !customerA || !customerB || !division || !container) {
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
      customerAId: customerA.id,
      customerBId: customerB.id,
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

  return { schemaName: tenant.schemaName, companyId, userId, accessToken: token, purchaseRefs, customerAId, customerBId };
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

describe("modules/purchase - Record Purchase, session (c): customer allocation (docs/spec/Purchase-V2.md Sub Tab 2, F)", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "user can split a purchase's allocation across multiple reserved customers, up to 100%",
    async () => {
      const tenant = await seedTenant("split");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);

      const first = asAllocation(
        await request(app)
          .post(`/api/v1/purchases/${purchaseId}/allocations`)
          .set("Authorization", authHeader)
          .send({ reservedCustomerId: tenant.customerAId, allocationPct: "60" }),
      );
      const second = asAllocation(
        await request(app)
          .post(`/api/v1/purchases/${purchaseId}/allocations`)
          .set("Authorization", authHeader)
          .send({ reservedCustomerId: tenant.customerBId, allocationPct: "40" }),
      );

      expect(first.allocationPct).toBe("60.000000");
      expect(second.allocationPct).toBe("40.000000");

      const getRes = await request(app).get(`/api/v1/purchases/${purchaseId}`).set("Authorization", authHeader);
      const allocations = (getRes.body as { allocations: unknown[] }).allocations;
      expect(allocations).toHaveLength(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    // Prompt 21 item 6: allocation is a SOFT reservation - the client
    // confirmed the eventual sale is not bound to it and may go to a
    // different customer entirely, so an earlier hard >100% block was
    // relaxed. docs/adr/0013-allocation-is-soft-reservation.md.
    "an allocation that pushes the purchase's total over 100% is NOT rejected - a non-blocking soft reservation",
    async () => {
      const tenant = await seedTenant("overallocate");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);

      const firstRes = await request(app)
        .post(`/api/v1/purchases/${purchaseId}/allocations`)
        .set("Authorization", authHeader)
        .send({ reservedCustomerId: tenant.customerAId, allocationPct: "60" });
      expect(firstRes.status).toBe(201);

      const secondRes = await request(app)
        .post(`/api/v1/purchases/${purchaseId}/allocations`)
        .set("Authorization", authHeader)
        .send({ reservedCustomerId: tenant.customerBId, allocationPct: "50" });
      expect(secondRes.status).toBe(201);

      const getRes = await request(app).get(`/api/v1/purchases/${purchaseId}`).set("Authorization", authHeader);
      const allocations = (getRes.body as { allocations: { allocationPct: string }[] }).allocations;
      expect(allocations).toHaveLength(2);
      const total = allocations.reduce((sum, row) => sum + Number(row.allocationPct), 0);
      expect(total).toBe(110);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a single allocation still can't exceed 100% or be zero/negative on its own - a basic sanity bound, not the removed cross-row constraint",
    async () => {
      const tenant = await seedTenant("single-bound");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);

      const overRes = await request(app)
        .post(`/api/v1/purchases/${purchaseId}/allocations`)
        .set("Authorization", authHeader)
        .send({ reservedCustomerId: tenant.customerAId, allocationPct: "150" });
      expect(overRes.status).toBe(422);

      const zeroRes = await request(app)
        .post(`/api/v1/purchases/${purchaseId}/allocations`)
        .set("Authorization", authHeader)
        .send({ reservedCustomerId: tenant.customerAId, allocationPct: "0" });
      expect(zeroRes.status).toBe(422);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a non-draft purchase rejects adding an allocation",
    async () => {
      const tenant = await seedTenant("immutable-alloc");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createDraftPurchase(app, authHeader, tenant);

      await withTenantSchema(tenant.schemaName, (tx) => tx.update(purchases).set({ status: "issued" }).where(eq(purchases.id, purchaseId)));

      const res = await request(app)
        .post(`/api/v1/purchases/${purchaseId}/allocations`)
        .set("Authorization", authHeader)
        .send({ reservedCustomerId: tenant.customerAId, allocationPct: "10" });
      expect(res.status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  describe("Prompt 23: edit/remove - Draft only, same guard as add", () => {
    it(
      "a draft purchase's allocation can be edited (partial PATCH) and removed",
      async () => {
        const tenant = await seedTenant("edit-remove-draft");
        const app = createApp();
        const authHeader = `Bearer ${tenant.accessToken}`;
        const purchaseId = await createDraftPurchase(app, authHeader, tenant);
        const allocation = asAllocation(
          await request(app)
            .post(`/api/v1/purchases/${purchaseId}/allocations`)
            .set("Authorization", authHeader)
            .send({ reservedCustomerId: tenant.customerAId, allocationPct: "60" }),
        );

        const editRes = await request(app)
          .patch(`/api/v1/purchases/${purchaseId}/allocations/${allocation.id}`)
          .set("Authorization", authHeader)
          .send({ allocationPct: "75" });
        expect(editRes.status).toBe(200);
        const edited = asAllocation(editRes);
        expect(edited.allocationPct).toBe("75.000000");
        // Only the sent field changed - reservedCustomerId untouched.
        expect(edited.reservedCustomerId).toBe(tenant.customerAId);

        const deleteRes = await request(app).delete(`/api/v1/purchases/${purchaseId}/allocations/${allocation.id}`).set("Authorization", authHeader);
        expect(deleteRes.status).toBe(204);

        const getRes = await request(app).get(`/api/v1/purchases/${purchaseId}`).set("Authorization", authHeader);
        const allocations = (getRes.body as { allocations: unknown[] }).allocations;
        expect(allocations).toHaveLength(0);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "an edited allocation still can't exceed 100% or be zero/negative on its own",
      async () => {
        const tenant = await seedTenant("edit-bound");
        const app = createApp();
        const authHeader = `Bearer ${tenant.accessToken}`;
        const purchaseId = await createDraftPurchase(app, authHeader, tenant);
        const allocation = asAllocation(
          await request(app)
            .post(`/api/v1/purchases/${purchaseId}/allocations`)
            .set("Authorization", authHeader)
            .send({ reservedCustomerId: tenant.customerAId, allocationPct: "60" }),
        );

        const res = await request(app)
          .patch(`/api/v1/purchases/${purchaseId}/allocations/${allocation.id}`)
          .set("Authorization", authHeader)
          .send({ allocationPct: "150" });
        expect(res.status).toBe(422);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "a non-draft purchase rejects editing or removing an existing allocation",
      async () => {
        const tenant = await seedTenant("edit-remove-immutable");
        const app = createApp();
        const authHeader = `Bearer ${tenant.accessToken}`;
        const purchaseId = await createDraftPurchase(app, authHeader, tenant);
        const allocation = asAllocation(
          await request(app)
            .post(`/api/v1/purchases/${purchaseId}/allocations`)
            .set("Authorization", authHeader)
            .send({ reservedCustomerId: tenant.customerAId, allocationPct: "60" }),
        );

        await withTenantSchema(tenant.schemaName, (tx) => tx.update(purchases).set({ status: "issued" }).where(eq(purchases.id, purchaseId)));

        const editRes = await request(app)
          .patch(`/api/v1/purchases/${purchaseId}/allocations/${allocation.id}`)
          .set("Authorization", authHeader)
          .send({ allocationPct: "70" });
        expect(editRes.status).toBe(409);

        const deleteRes = await request(app).delete(`/api/v1/purchases/${purchaseId}/allocations/${allocation.id}`).set("Authorization", authHeader);
        expect(deleteRes.status).toBe(409);
      },
      TEST_TIMEOUT_MS,
    );
  });
});
