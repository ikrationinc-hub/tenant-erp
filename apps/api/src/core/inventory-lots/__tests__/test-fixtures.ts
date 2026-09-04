import { randomUUID } from "node:crypto";
import { createTenantSchema, type ProvisionedTenant } from "../../tenant/provisioner.js";
import { withTenantSchema } from "../../../database/get-db.js";
import {
  branches,
  companies,
  countries,
  currencies,
  items,
  paymentTerms,
  purchaseItems,
  purchasePricing,
  purchaseReceipts,
  purchases,
  supplierTypes,
  suppliers,
  uom,
  users,
  warehouses,
} from "../../../database/tenant/schema.js";
import { insertStockLot, type StockLotRow } from "../stock-lots.repository.js";

export interface SeededLotFixture {
  schemaName: string;
  companyId: string;
  userId: string;
  itemId: string;
  uomId: string;
  warehouseId: string;
  receiptId: string;
  purchaseItemId: string;
}

/**
 * Seeds exactly the FK chain stock_lots needs (company, user, warehouse,
 * item, uom, a minimal purchase -> purchase_item -> purchase_receipt), then
 * returns the ids core/inventory-lots' own tests need to insert stock_lots
 * rows directly (bypassing the receipt-confirm HTTP flow, which
 * inventory.test.ts already covers end-to-end) - this suite's job is the
 * lock/allocation engine itself, not re-proving the receipt flow.
 */
export async function seedLotFixture(label: string): Promise<SeededLotFixture> {
  const unique = randomUUID().slice(0, 8);
  const tenant: ProvisionedTenant = await createTenantSchema({ name: `${label} Co`, slug: `${label}-${unique}` });

  const result = await withTenantSchema(tenant.schemaName, async (tx) => {
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

    const [warehouse] = await tx.insert(warehouses).values({ companyId: company.id, code: "WH1", name: "Main Warehouse", createdBy: user.id }).returning();
    const [item] = await tx.insert(items).values({ companyId: company.id, code: "CU-CATH", name: "Copper Cathode", itemType: "metals", createdBy: user.id }).returning();
    const [unit] = await tx.insert(uom).values({ companyId: company.id, code: "MT", name: "Metric Ton", createdBy: user.id }).returning();
    const [branch] = await tx.insert(branches).values({ companyId: company.id, name: "Main Branch", code: "MAIN", createdBy: user.id }).returning();
    const [supplierType] = await tx.insert(supplierTypes).values({ companyId: company.id, code: "LOCAL", name: "Local", createdBy: user.id }).returning();
    const [country] = await tx.insert(countries).values({ companyId: company.id, code: "AE", name: "UAE", createdBy: user.id }).returning();
    const [paymentTerm] = await tx.insert(paymentTerms).values({ companyId: company.id, code: "NET30", name: "30 Days", createdBy: user.id }).returning();
    const [currency] = await tx.insert(currencies).values({ companyId: company.id, code: "USD", name: "US Dollar", createdBy: user.id }).returning();
    if (!warehouse || !item || !unit || !branch || !supplierType || !country || !paymentTerm || !currency) throw new Error("failed to insert prerequisite masters");

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
    if (!supplier) throw new Error("failed to insert supplier");

    const [purchase] = await tx
      .insert(purchases)
      .values({
        companyId: company.id,
        purchaseNumber: `PO-TEST-${unique}`,
        purchaseDate: "2024-06-15",
        pricingType: "fixed",
        branchId: branch.id,
        buyerId: company.id,
        supplierId: supplier.id,
        status: "draft",
        createdBy: user.id,
      })
      .returning();
    if (!purchase) throw new Error("failed to insert purchase");

    const [purchaseItem] = await tx
      .insert(purchaseItems)
      .values({ purchaseId: purchase.id, companyId: company.id, itemId: item.id, quantity: "1000", uomId: unit.id, createdBy: user.id })
      .returning();
    if (!purchaseItem) throw new Error("failed to insert purchase item");

    await tx.insert(purchasePricing).values({
      purchaseItemId: purchaseItem.id,
      companyId: company.id,
      purchaseRateUsd: "8000",
      purchaseAmountUsd: "8000000.00",
      exchangeRate: "3.6725",
      purchaseAmountAed: "29380000.00",
      createdBy: user.id,
    });

    const [receipt] = await tx
      .insert(purchaseReceipts)
      .values({
        companyId: company.id,
        purchaseId: purchase.id,
        receiptNumber: `PR-TEST-${unique}`,
        receiptDate: "2024-06-20",
        warehouseId: warehouse.id,
        receivedBy: user.id,
        status: "confirmed",
        createdBy: user.id,
      })
      .returning();
    if (!receipt) throw new Error("failed to insert receipt");

    return {
      companyId: company.id,
      userId: user.id,
      itemId: item.id,
      uomId: unit.id,
      warehouseId: warehouse.id,
      receiptId: receipt.id,
      purchaseItemId: purchaseItem.id,
    };
  });

  return { schemaName: tenant.schemaName, ...result };
}

/** Inserts one stock_lots row for the given fixture with a given receivedQty/landedRate - the concurrency/reservation tests' own starting state. */
export async function seedLot(fixture: SeededLotFixture, receivedQty: string, landedRate = "8000"): Promise<StockLotRow> {
  return withTenantSchema(fixture.schemaName, (tx) =>
    insertStockLot(tx, {
      companyId: fixture.companyId,
      itemId: fixture.itemId,
      warehouseId: fixture.warehouseId,
      receiptId: fixture.receiptId,
      purchaseItemId: fixture.purchaseItemId,
      uomId: fixture.uomId,
      receivedQty,
      landedRate,
      reservedQty: "0",
      deliveredQty: "0",
      createdBy: fixture.userId,
    }),
  );
}
