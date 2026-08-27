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
  divisions,
  incoterms,
  items,
  paymentTerms,
  permissions,
  ports,
  purchases,
  suppliers,
  supplierTypes,
  transportModes,
  uom,
  users,
  warehouses,
} from "../../../database/tenant/schema.js";

const TEST_TIMEOUT_MS = 120_000;

const shipmentSchema = z.object({
  id: z.string(),
  purchaseId: z.string(),
  shipmentYear: z.number(),
  lotNumber: z.string(),
  containerId: z.string(),
  blNo: z.string(),
  loadingDate: z.string(),
  transportModeId: z.string(),
  portOfLoadingId: z.string(),
  portOfDischargeId: z.string(),
  warehouseId: z.string(),
  incotermId: z.string(),
});

const purchaseRowSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  purchaseNumber: z.string(),
  purchaseDate: z.string(),
  status: z.enum(["draft", "issued", "closed", "cancelled"]),
  divisionId: z.string().nullable().optional(),
  pricingType: z.enum(["lme", "fixed"]).nullable().optional(),
  branchId: z.string(),
  buyerId: z.string(),
  supplierId: z.string(),
  supplierReferenceNo: z.string().nullable().optional(),
  brokerId: z.string().nullable().optional(),
  brokerCommission: z.string().nullable().optional(),
  shipment: shipmentSchema.optional(),
});

const paginatedResponseSchema = z.object({
  items: z.array(purchaseRowSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

function asPurchase(res: { body: unknown }) {
  return purchaseRowSchema.parse(res.body);
}
function asPaginated(res: { body: unknown }) {
  return paginatedResponseSchema.parse(res.body);
}

async function findPermissionId(schemaName: string, key: string): Promise<string> {
  const [row] = await withTenantSchema(schemaName, (tx) => tx.select().from(permissions).where(eq(permissions.key, key)).limit(1));
  if (!row) {
    throw new Error(`expected permission ${key} to exist in the seeded catalogue`);
  }
  return row.id;
}

interface SeededPurchaseTenant {
  schemaName: string;
  companyId: string;
  userId: string;
  roleId: string;
  accessToken: string;
  refs: {
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
    containerId2: string;
  };
}

const ALL_PURCHASE_PERMISSIONS = ["purchase.po.create", "purchase.po.read", "purchase.po.update"];

async function seedPurchaseTenant(label: string): Promise<SeededPurchaseTenant> {
  const unique = randomUUID().slice(0, 8);
  const tenant = await createTenantSchema({ name: `${label} Co`, slug: `${label}-${unique}` });

  const { companyId, userId, refs } = await withTenantSchema(tenant.schemaName, async (tx) => {
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
    if (!supplierType || !country || !paymentTerm || !currency) {
      throw new Error("failed to insert supplier prerequisite masters");
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
    const [division] = await tx.insert(divisions).values({ companyId: company.id, code: "CONTAINER", name: "Container", createdBy: user.id }).returning();
    const [container] = await tx.insert(containers).values({ companyId: company.id, code: "CONT-1", name: "CONT-1", createdBy: user.id }).returning();
    const [container2] = await tx.insert(containers).values({ companyId: company.id, code: "CONT-9", name: "CONT-9", createdBy: user.id }).returning();
    if (!branch || !supplier || !transportMode || !portA || !portB || !warehouse || !incoterm || !division || !container || !container2) {
      throw new Error("failed to insert shipment prerequisite masters");
    }

    return {
      companyId: company.id,
      userId: user.id,
      refs: {
        divisionId: division.id,
        branchId: branch.id,
        // buyerId names a tenant company, not a user (client correction) -
        // reusing the seeded company itself is a valid, always-satisfiable
        // FK target for these tests, same as any other purchase.
        buyerId: company.id,
        supplierId: supplier.id,
        transportModeId: transportMode.id,
        portAId: portA.id,
        portBId: portB.id,
        warehouseId: warehouse.id,
        incotermId: incoterm.id,
        containerId: container.id,
        containerId2: container2.id,
      },
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

  return { schemaName: tenant.schemaName, companyId, userId, roleId: role.id, accessToken: token, refs };
}

function basePayload(refs: SeededPurchaseTenant["refs"], overrides: Record<string, unknown> = {}) {
  return {
    purchaseDate: "2024-06-15",
    divisionId: refs.divisionId,
    pricingType: "fixed",
    branchId: refs.branchId,
    buyerId: refs.buyerId,
    supplierId: refs.supplierId,
    shipment: {
      lotNumber: "LOT-1",
      containerId: refs.containerId,
      blNo: "BL-1",
      loadingDate: "2024-06-10",
      transportModeId: refs.transportModeId,
      portOfLoadingId: refs.portAId,
      portOfDischargeId: refs.portBId,
      warehouseId: refs.warehouseId,
      incotermId: refs.incotermId,
    },
    ...overrides,
  };
}

describe("modules/purchase - Record Purchase, session (a): header + shipment (docs/spec/Purchase-V2.md Sub Tab 2, A-C)", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "FR-101/FR-102/FR-103: creates a purchase with an auto-generated Purchase Number, the selected supplier, and its shipment details",
    async () => {
      const tenant = await seedPurchaseTenant("fr101");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const res = await request(app).post("/api/v1/purchases").set("Authorization", authHeader).send(basePayload(tenant.refs));

      expect(res.status).toBe(201);
      const created = asPurchase(res);
      expect(created.purchaseNumber).toMatch(/^PO-\d{4}-\d{4}$/);
      expect(created.status).toBe("draft");
      expect(created.supplierId).toBe(tenant.refs.supplierId);
      expect(created.shipment?.lotNumber).toBe("LOT-1");
      // Open question #7, resolved: shipment_year derives from Loading Date, never user input.
      expect(created.shipment?.shipmentYear).toBe(2024);

      const second = asPurchase(
        await request(app).post("/api/v1/purchases").set("Authorization", authHeader).send(basePayload(tenant.refs)),
      );
      expect(second.purchaseNumber).not.toBe(created.purchaseNumber);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "FR-103: user can edit a draft purchase's header and shipment information",
    async () => {
      const tenant = await seedPurchaseTenant("fr103");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const created = asPurchase(
        await request(app).post("/api/v1/purchases").set("Authorization", authHeader).send(basePayload(tenant.refs)),
      );

      const updateRes = await request(app)
        .patch(`/api/v1/purchases/${created.id}`)
        .set("Authorization", authHeader)
        .send({ supplierReferenceNo: "REF-99", shipment: { containerId: tenant.refs.containerId2, loadingDate: "2023-01-05" } });

      expect(updateRes.status).toBe(200);
      const updated = asPurchase(updateRes);
      expect(updated.supplierReferenceNo).toBe("REF-99");
      expect(updated.shipment?.containerId).toBe(tenant.refs.containerId2);
      // Changing Loading Date recomputes Shipment Year - it's derived, never stale.
      expect(updated.shipment?.shipmentYear).toBe(2023);
      // Purchase Number is read-only - never touched by an edit.
      expect(updated.purchaseNumber).toBe(created.purchaseNumber);

      const getRes = await request(app).get(`/api/v1/purchases/${created.id}`).set("Authorization", authHeader);
      expect(asPurchase(getRes).shipment?.containerId).toBe(tenant.refs.containerId2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a non-draft purchase rejects every edit (rule 8, enforced ahead of the workflow engine landing in a later session)",
    async () => {
      const tenant = await seedPurchaseTenant("immutable");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const created = asPurchase(
        await request(app).post("/api/v1/purchases").set("Authorization", authHeader).send(basePayload(tenant.refs)),
      );

      await withTenantSchema(tenant.schemaName, (tx) => tx.update(purchases).set({ status: "issued" }).where(eq(purchases.id, created.id)));

      const updateRes = await request(app)
        .patch(`/api/v1/purchases/${created.id}`)
        .set("Authorization", authHeader)
        .send({ supplierReferenceNo: "should-not-apply" });
      expect(updateRes.status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "list is paginated server-side",
    async () => {
      const tenant = await seedPurchaseTenant("pagination");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      for (let i = 0; i < 5; i += 1) {
        await request(app)
          .post("/api/v1/purchases")
          .set("Authorization", authHeader)
          .send(basePayload(tenant.refs, { supplierReferenceNo: `REF-${i}` }));
      }

      const page1 = asPaginated(
        await request(app).get("/api/v1/purchases").query({ page: 1, pageSize: 2 }).set("Authorization", authHeader),
      );
      expect(page1.items).toHaveLength(2);
      expect(page1.total).toBe(5);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Purchase Number is gapless and unique under 100 concurrent creates",
    async () => {
      const tenant = await seedPurchaseTenant("concurrency");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const CONCURRENCY = 100;

      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, () =>
          request(app).post("/api/v1/purchases").set("Authorization", authHeader).send(basePayload(tenant.refs)),
        ),
      );

      for (const res of results) {
        expect(res.status).toBe(201);
      }

      const numbers = results.map((res) => asPurchase(res).purchaseNumber);
      expect(new Set(numbers).size).toBe(CONCURRENCY);

      const sequenceNumbers = numbers
        .map((n) => {
          const match = /^PO-2024-(\d{4})$/.exec(n);
          if (!match?.[1]) {
            throw new Error(`unexpected purchase number shape: ${n}`);
          }
          return Number(match[1]);
        })
        .sort((a, b) => a - b);
      expect(sequenceNumbers).toEqual(Array.from({ length: CONCURRENCY }, (_, i) => i + 1));
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "list filters by status, supplierId, branchId, and purchaseDateFrom/To - individually and combined (task item 6)",
    async () => {
      const tenant = await seedPurchaseTenant("list-filters");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const issuePermissionId = await findPermissionId(tenant.schemaName, "purchase.po.issue");
      await grantPermissionToRole(tenant.schemaName, tenant.companyId, tenant.roleId, issuePermissionId, tenant.userId);

      const { otherBranchId, otherSupplierId, itemId, uomId } = await withTenantSchema(tenant.schemaName, async (tx) => {
        const [supplierType] = await tx.select().from(supplierTypes).where(eq(supplierTypes.companyId, tenant.companyId)).limit(1);
        const [country] = await tx.select().from(countries).where(eq(countries.companyId, tenant.companyId)).limit(1);
        const [paymentTerm] = await tx.select().from(paymentTerms).where(eq(paymentTerms.companyId, tenant.companyId)).limit(1);
        const [currency] = await tx.select().from(currencies).where(eq(currencies.companyId, tenant.companyId)).limit(1);
        if (!supplierType || !country || !paymentTerm || !currency) {
          throw new Error("expected seedPurchaseTenant's prerequisite masters to already exist");
        }

        const [otherBranch] = await tx
          .insert(branches)
          .values({ companyId: tenant.companyId, name: "Other Branch", code: "OTHER", createdBy: tenant.userId })
          .returning();
        const [otherSupplier] = await tx
          .insert(suppliers)
          .values({
            companyId: tenant.companyId,
            code: "SUP-0002",
            name: "Second Supplier Co",
            supplierTypeId: supplierType.id,
            countryId: country.id,
            paymentTermId: paymentTerm.id,
            currencyId: currency.id,
            createdBy: tenant.userId,
          })
          .returning();
        const [item] = await tx.insert(items).values({ companyId: tenant.companyId, code: "CU-CATH", name: "Copper Cathode", itemType: "metals", createdBy: tenant.userId }).returning();
        const [unit] = await tx.insert(uom).values({ companyId: tenant.companyId, code: "MT", name: "Metric Ton", createdBy: tenant.userId }).returning();
        if (!otherBranch || !otherSupplier || !item || !unit) {
          throw new Error("failed to seed a second branch/supplier for filter testing");
        }
        return { otherBranchId: otherBranch.id, otherSupplierId: otherSupplier.id, itemId: item.id, uomId: unit.id };
      });

      // A: original branch/supplier, early date, stays draft.
      const purchaseA = asPurchase(
        await request(app)
          .post("/api/v1/purchases")
          .set("Authorization", authHeader)
          .send(basePayload(tenant.refs, { purchaseDate: "2024-01-10" })),
      );

      // B: other branch/supplier, later date, gets issued.
      const purchaseB = asPurchase(
        await request(app)
          .post("/api/v1/purchases")
          .set("Authorization", authHeader)
          .send(
            basePayload(tenant.refs, {
              purchaseDate: "2024-06-20",
              branchId: otherBranchId,
              supplierId: otherSupplierId,
            }),
          ),
      );
      // Issue now requires at least one valid item (core/workflow/guards.ts's requireAtLeastOneValidLine).
      const itemRes = await request(app)
        .post(`/api/v1/purchases/${purchaseB.id}/items`)
        .set("Authorization", authHeader)
        .send({ itemId, quantity: "10", uomId, purchaseRateUsd: "8000", exchangeRate: "3.6725" });
      expect(itemRes.status).toBe(201);

      const issueRes = await request(app).patch(`/api/v1/purchases/${purchaseB.id}/issue`).set("Authorization", authHeader);
      expect(issueRes.status).toBe(200);

      async function idsFor(query: Record<string, string>): Promise<Set<string>> {
        const res = asPaginated(await request(app).get("/api/v1/purchases").query(query).set("Authorization", authHeader));
        return new Set(res.items.map((row) => row.id));
      }

      expect(await idsFor({ status: "issued" })).toEqual(new Set([purchaseB.id]));
      expect(await idsFor({ status: "draft" })).toEqual(new Set([purchaseA.id]));
      expect(await idsFor({ supplierId: otherSupplierId })).toEqual(new Set([purchaseB.id]));
      expect(await idsFor({ branchId: otherBranchId })).toEqual(new Set([purchaseB.id]));
      expect(await idsFor({ purchaseDateFrom: "2024-03-01" })).toEqual(new Set([purchaseB.id]));
      expect(await idsFor({ purchaseDateTo: "2024-03-01" })).toEqual(new Set([purchaseA.id]));
      expect(await idsFor({ purchaseDateFrom: "2024-01-01", purchaseDateTo: "2024-12-31" })).toEqual(
        new Set([purchaseA.id, purchaseB.id]),
      );

      // Combined: branchId + status together narrow to the intersection, not either alone.
      expect(await idsFor({ branchId: otherBranchId, status: "issued" })).toEqual(new Set([purchaseB.id]));
      expect(await idsFor({ branchId: otherBranchId, status: "draft" })).toEqual(new Set());
    },
    TEST_TIMEOUT_MS,
  );
});
