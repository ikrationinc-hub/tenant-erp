import { eq } from "drizzle-orm";
import { db } from "../src/config/db.js";
import type { RequestContext } from "../src/common/context/request-context.js";
import { runWithRequestContext } from "../src/common/context/request-context.js";
import { withTenantSchema } from "../src/database/get-db.js";
import { tenants } from "../src/database/platform/schema.js";
import {
  branches,
  companies,
  countries,
  currencies,
  customers,
  hedgePlatforms,
  incoterms,
  itemGrades,
  items,
  lmeExchanges,
  paymentTerms,
  ports,
  supplierTypes,
  transportModes,
  uom,
  users,
  warehouses,
} from "../src/database/tenant/schema.js";
import { createMasterRepository } from "../src/core/masters/repository.js";
import { findSupplierByName } from "../src/modules/suppliers/suppliers.repository.js";
import * as suppliersService from "../src/modules/suppliers/suppliers.service.js";
import { findPurchaseBySupplierInvoiceNo } from "../src/modules/purchase/purchase.repository.js";
import * as purchaseService from "../src/modules/purchase/purchase.service.js";
import * as purchaseItemsService from "../src/modules/purchase/purchase-items.service.js";
import * as purchaseCostsService from "../src/modules/purchase/purchase-costs.service.js";
import * as purchaseLmeService from "../src/modules/purchase/purchase-lme.service.js";
import * as purchaseHedgesService from "../src/modules/purchase/purchase-hedges.service.js";

/**
 * The reusable half of `pnpm seed:dev` - separated from scripts/seed-dev.ts
 * (the CLI entrypoint) so a test can call seedDevData(slug) in-process
 * against the same ephemeral test database vitest's global-setup already
 * pointed `db`/get-db.ts at, without also closing the shared connection
 * pools every other test in the process still needs (scripts/seed-dev.ts
 * does that in its own `finally`, appropriate for a one-shot CLI run, fatal
 * for an in-process test).
 *
 * Idempotent: every insert is guarded by a lookup on a stable natural key
 * first (master code, supplier name, purchase supplierInvoiceNo), so a
 * second run updates nothing and creates nothing new.
 */

export interface SeedDevResult {
  supplierIds: string[];
  draftPurchaseId: string;
  approvedPurchaseId: string;
  postedPurchaseId: string;
}

const decimalString = (value: number, decimals: number): string => value.toFixed(decimals);

async function ensureMaster<TExtra extends Record<string, unknown>>(
  schemaName: string,
  table: Parameters<typeof createMasterRepository>[0],
  companyId: string,
  createdBy: string,
  code: string,
  name: string,
  extra?: TExtra,
): Promise<string> {
  const repo = createMasterRepository(table);
  const existing = await withTenantSchema(schemaName, (tx) => repo.findByCode(tx, companyId, code));
  if (existing) {
    return existing.id;
  }
  const row = await withTenantSchema(schemaName, (tx) =>
    repo.insert(tx, { code, name, companyId, createdBy, ...(extra ?? {}) }),
  );
  return row.id;
}

export async function seedDevData(tenantSlug: string): Promise<SeedDevResult> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, tenantSlug)).limit(1);
  if (!tenant || tenant.status !== "active") {
    throw new Error(`No active tenant found for slug "${tenantSlug}"`);
  }

  const [company] = await withTenantSchema(tenant.schemaName, (tx) => tx.select().from(companies).limit(1));
  if (!company) {
    throw new Error(`Tenant "${tenantSlug}" has no company - provision it first`);
  }
  const [adminUser] = await withTenantSchema(tenant.schemaName, (tx) =>
    tx.select().from(users).where(eq(users.companyId, company.id)).limit(1),
  );
  if (!adminUser) {
    throw new Error(`Tenant "${tenantSlug}"'s company has no users - provision it first`);
  }
  const [branch] = await withTenantSchema(tenant.schemaName, (tx) =>
    tx.select().from(branches).where(eq(branches.companyId, company.id)).limit(1),
  );
  if (!branch) {
    throw new Error(`Tenant "${tenantSlug}"'s company has no branch - provision it first`);
  }
  const branchId = branch.id;

  const ctx: RequestContext = {
    requestId: "seed-dev",
    tenantScope: {
      tenantId: tenant.id,
      tenantSchema: tenant.schemaName,
      companyId: company.id,
      userId: adminUser.id,
      scope: "full",
    },
  };

  return runWithRequestContext(ctx, async () => {
    const schemaName = tenant.schemaName;
    const companyId = company.id;
    const createdBy = adminUser.id;

    // --- prerequisite masters (idempotent by code) --------------------------
    // country/currency/incoterm/uom are already seeded by provisioning
    // (core/masters/seed-data.ts) - reused here, never re-inserted.
    const countryId = await ensureMaster(schemaName, countries, companyId, createdBy, "AE", "United Arab Emirates");
    const currencyId = await ensureMaster(schemaName, currencies, companyId, createdBy, "AED", "UAE Dirham");
    const incotermId = await ensureMaster(schemaName, incoterms, companyId, createdBy, "CIF", "Cost, Insurance and Freight");
    const uomId = await ensureMaster(schemaName, uom, companyId, createdBy, "MT", "Metric Ton");

    const supplierTypeId = await ensureMaster(schemaName, supplierTypes, companyId, createdBy, "DEV-INTL", "International");
    const paymentTermId = await ensureMaster(schemaName, paymentTerms, companyId, createdBy, "DEV-NET30", "Net 30 Days");
    const portLoadingId = await ensureMaster(schemaName, ports, companyId, createdBy, "DEV-JEA", "Jebel Ali");
    const portDischargeId = await ensureMaster(schemaName, ports, companyId, createdBy, "DEV-SHA", "Shanghai");
    const warehouseId = await ensureMaster(schemaName, warehouses, companyId, createdBy, "DEV-WH1", "Main Warehouse");
    const transportModeId = await ensureMaster(schemaName, transportModes, companyId, createdBy, "DEV-SEA", "Sea Freight");
    const itemId = await ensureMaster(schemaName, items, companyId, createdBy, "DEV-CU-CATH", "Copper Cathode", {
      itemType: "metals",
    });
    const gradeId = await ensureMaster(schemaName, itemGrades, companyId, createdBy, "DEV-GR-A", "Grade A");
    const lmeExchangeId = await ensureMaster(schemaName, lmeExchanges, companyId, createdBy, "DEV-LME", "London Metal Exchange");
    const hedgePlatformId = await ensureMaster(schemaName, hedgePlatforms, companyId, createdBy, "DEV-CME", "CME Group");
    await ensureMaster(schemaName, customers, companyId, createdBy, "DEV-CUST-1", "Copperline Industries");
    await ensureMaster(schemaName, customers, companyId, createdBy, "DEV-CUST-2", "Northgate Metals");

    // --- suppliers (idempotent by name - FR-005's own uniqueness rule) -----
    const supplierNames = ["Gulf Metal Traders LLC", "Shanghai Nonferrous Metals Co.", "Rotterdam Commodities BV"];
    const supplierIds: string[] = [];
    for (const name of supplierNames) {
      const existing = await withTenantSchema(schemaName, (tx) => findSupplierByName(tx, companyId, name));
      if (existing) {
        supplierIds.push(existing.id);
        continue;
      }
      const created = await suppliersService.create(ctx, {
        name,
        supplierTypeId,
        countryId,
        paymentTermId,
        currencyId,
      });
      supplierIds.push(created.id);
    }

    // --- purchases: one draft, one approved, one posted-with-everything ----
    const [supplierA, supplierB, supplierC] = supplierIds;
    if (!supplierA || !supplierB || !supplierC) {
      throw new Error("expected 3 suppliers to exist by this point");
    }

    async function ensurePurchase(supplierInvoiceNo: string, supplierId: string) {
      const existing = await withTenantSchema(schemaName, (tx) => findPurchaseBySupplierInvoiceNo(tx, companyId, supplierInvoiceNo));
      if (existing) {
        return { purchase: existing, alreadyExisted: true as const };
      }
      const purchase = await purchaseService.create(ctx, {
        purchaseDate: "2025-01-15",
        branchId,
        buyerId: createdBy,
        supplierId,
        supplierInvoiceNo,
        shipment: {
          lotNumber: `LOT-${supplierInvoiceNo}`,
          containerNumber: `CONT-${supplierInvoiceNo}`,
          blNo: `BL-${supplierInvoiceNo}`,
          loadingDate: "2025-01-10",
          transportModeId,
          portOfLoadingId: portLoadingId,
          portOfDischargeId: portDischargeId,
          warehouseId,
          incotermId,
        },
      });
      return { purchase, alreadyExisted: false as const };
    }

    const draft = await ensurePurchase("DEV-SEED-DRAFT-1", supplierA);

    const approved = await ensurePurchase("DEV-SEED-APPROVED-1", supplierB);
    if (!approved.alreadyExisted) {
      await purchaseItemsService.addItem(ctx, approved.purchase.id, {
        itemId,
        gradeId,
        quantity: decimalString(200, 6),
        uomId,
        purchaseRateUsd: decimalString(8500, 6),
        exchangeRate: decimalString(3.6725, 6),
      });
      await purchaseService.approve(ctx, approved.purchase.id);
    }

    const posted = await ensurePurchase("DEV-SEED-POSTED-1", supplierC);
    if (!posted.alreadyExisted) {
      await purchaseItemsService.addItem(ctx, posted.purchase.id, {
        itemId,
        gradeId,
        quantity: decimalString(500, 6),
        uomId,
        purchaseRateUsd: decimalString(8432.75, 6),
        exchangeRate: decimalString(3.6725, 6),
      });
      await purchaseCostsService.setAdditionalCosts(ctx, posted.purchase.id, {
        freight: decimalString(1500, 2),
        insurance: decimalString(400, 2),
        customs: decimalString(600, 2),
        otherCharges: decimalString(150, 2),
      });
      await purchaseLmeService.addLmeRecord(ctx, posted.purchase.id, {
        lmeExchangeId,
        metal: "Copper",
        lmePriceUsd: decimalString(8200, 6),
        fixingDate: "2025-01-14",
        agreedPremiumPct: decimalString(2.35, 6),
      });
      await purchaseHedgesService.addHedge(ctx, posted.purchase.id, {
        hedgePlatformId,
        contractNumber: "DEV-HEDGE-1",
        position: "buy",
        quantity: decimalString(500, 6),
        rate: decimalString(8432.75, 6),
        hedgeDate: "2025-01-14",
      });
      await purchaseService.approve(ctx, posted.purchase.id);
      await purchaseService.post(ctx, posted.purchase.id);
    }

    return {
      supplierIds,
      draftPurchaseId: draft.purchase.id,
      approvedPurchaseId: approved.purchase.id,
      postedPurchaseId: posted.purchase.id,
    };
  });
}
