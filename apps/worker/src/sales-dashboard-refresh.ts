import { Decimal } from "decimal.js";
import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import type { TenantTx } from "./database/get-tenant-db.js";
import {
  companies,
  contracts,
  customers,
  purchaseItems,
  purchasePricing,
  purchases,
  sales,
  salesAdditionalCosts,
  salesDashboardCountryBreakdown,
  salesDashboardCustomerBreakdown,
  salesDashboardItemBreakdown,
  salesDashboardSnapshots,
  salesInvoices,
  salesItemLots,
  salesItems,
  salesPaymentAllocations,
  salesPricing,
  stockLotReservations,
  stockLots,
} from "./database/tenant-schema.js";

// The one place this file touches decimal.js's global config - mirrors
// apps/api/src/common/money/decimal.ts's own ROUND_HALF_UP choice (docs/
// adr/0012-money-rounding.md), and apps/worker/src/contract-generation/
// placeholder-resolver.ts's own precedent of setting it inline per-file
// rather than through a shared wrapper module (none exists in this
// package).
Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

function roundAmount(value: Decimal): string {
  return value.toFixed(2);
}

/** Always the 1st of the month, e.g. "2026-03-01" for March 2026 - matches sales_dashboard_snapshots.periodMonth's own convention. Mirrors apps/api/src/core/reporting/sales-dashboard-refresh.ts's periodMonthOf exactly. */
export function periodMonthOf(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

function nextMonth(periodMonth: string): string {
  const [year, month] = periodMonth.split("-").map(Number) as [number, number];
  const next = new Date(Date.UTC(year, month, 1));
  return periodMonthOf(next);
}

interface CostAllocationLine {
  qty: string;
  landedRate: string;
}

interface SharedCharges {
  freight: string;
  insurance: string;
  customs: string;
  other: string;
}

/**
 * Mirrors apps/api/src/core/inventory-lots/cost-allocation.ts's
 * costAllocation exactly - same pure "qty-basis, last-line-absorbs-the-
 * remainder" allocation shape, against the worker's own Decimal import
 * rather than the api-side common/money wrapper. Only the pieces this
 * job needs (qty-basis only, no per-lot lotId round-trip - the caller
 * here only wants each line's total cost, not lotId-keyed lookup).
 */
function totalCostAfterSharedCharges(allocations: CostAllocationLine[], sharedCharges: SharedCharges): Decimal {
  if (allocations.length === 0) {
    return new Decimal(0);
  }
  const totalCharges = new Decimal(sharedCharges.freight).plus(sharedCharges.insurance).plus(sharedCharges.customs).plus(sharedCharges.other);
  const totalQty = allocations.reduce((sum, line) => sum.plus(line.qty), new Decimal(0));
  const baseCost = allocations.reduce((sum, line) => sum.plus(new Decimal(line.qty).times(line.landedRate)), new Decimal(0));
  if (totalQty.eq(0)) {
    return baseCost;
  }
  return baseCost.plus(totalCharges);
}

/** Mirrors apps/api/src/core/inventory-lots/cost-allocation.ts's grossProfit exactly (division-by-zero guarded the same way). */
function computeGrossProfit(salesValue: Decimal, totalCost: Decimal): Decimal {
  return salesValue.minus(totalCost);
}

type DeliveredStatus = "not_delivered" | "partial" | "fully_delivered";

/** Mirrors apps/api/src/modules/sales/sales-lifecycle.ts's computeDeliveredStatus exactly - same denominator (reserved qty, not ordered/delivered) and same not_delivered/partial/fully_delivered tri-state shape. */
function computeDeliveredStatus(reservedItems: { id: string; reservedQty: string }[], deliveredByItemId: Map<string, string>): DeliveredStatus {
  if (reservedItems.length === 0) {
    return "not_delivered";
  }
  let anyDelivered = false;
  let allFullyDelivered = true;
  for (const item of reservedItems) {
    const delivered = new Decimal(deliveredByItemId.get(item.id) ?? "0");
    const reserved = new Decimal(item.reservedQty);
    if (delivered.gt(0)) {
      anyDelivered = true;
    }
    if (delivered.lt(reserved)) {
      allFullyDelivered = false;
    }
  }
  if (!anyDelivered) {
    return "not_delivered";
  }
  return allFullyDelivered ? "fully_delivered" : "partial";
}

/**
 * Mirrors apps/api/src/core/reporting/sales-dashboard-refresh.ts's
 * refreshSalesDashboardForCompany exactly - same five-table write, same
 * KPI derivations, against this package's own worker-local schema mirror
 * (see database/tenant-schema.ts's own doc comment on why this
 * duplication exists: apps/worker has zero dependency on @ikration/api).
 * Keep both files in sync if the KPI logic changes.
 */
export async function refreshSalesDashboardForCompany(tx: TenantTx, companyId: string, periodMonth: string): Promise<void> {
  const monthStart = periodMonth;
  const monthEnd = nextMonth(periodMonth);
  const inMonth = and(gte(sales.salesDate, monthStart), lt(sales.salesDate, monthEnd));

  const revenueRows = await tx
    .select({
      customerId: sales.customerId,
      countryId: customers.countryId,
      itemId: salesItems.itemId,
      salesAmountUsd: salesPricing.salesAmountUsd,
    })
    .from(sales)
    .innerJoin(customers, eq(customers.id, sales.customerId))
    .innerJoin(salesItems, and(eq(salesItems.salesId, sales.id), isNull(salesItems.deletedAt)))
    .innerJoin(salesPricing, and(eq(salesPricing.salesItemId, salesItems.id), isNull(salesPricing.deletedAt)))
    .where(and(eq(sales.companyId, companyId), inMonth, sql`${sales.status} != 'cancelled'`));

  let totalSalesUsd = new Decimal(0);
  const byCustomer = new Map<string, Decimal>();
  const byCountry = new Map<string, Decimal>();
  const byItem = new Map<string, Decimal>();
  for (const row of revenueRows) {
    const amount = new Decimal(row.salesAmountUsd);
    totalSalesUsd = totalSalesUsd.plus(amount);
    byCustomer.set(row.customerId, (byCustomer.get(row.customerId) ?? new Decimal(0)).plus(amount));
    byCountry.set(row.countryId, (byCountry.get(row.countryId) ?? new Decimal(0)).plus(amount));
    byItem.set(row.itemId, (byItem.get(row.itemId) ?? new Decimal(0)).plus(amount));
  }

  const salesInMonth = await tx
    .select({ id: sales.id })
    .from(sales)
    .where(and(eq(sales.companyId, companyId), inMonth, sql`${sales.status} != 'cancelled'`));
  const salesIdsInMonth = salesInMonth.map((row) => row.id);

  let grossProfitUsd = new Decimal(0);
  let additionalCostsUsd = new Decimal(0);
  if (salesIdsInMonth.length > 0) {
    const lotPickRows = await tx
      .select({
        salesId: salesItems.salesId,
        salesAmountUsd: salesPricing.salesAmountUsd,
        qty: salesItemLots.qty,
        landedRate: stockLots.landedRate,
      })
      .from(salesItemLots)
      .innerJoin(salesItems, eq(salesItems.id, salesItemLots.salesItemId))
      .innerJoin(salesPricing, and(eq(salesPricing.salesItemId, salesItems.id), isNull(salesPricing.deletedAt)))
      .innerJoin(stockLots, eq(stockLots.id, salesItemLots.stockLotId))
      .where(and(inArray(salesItems.salesId, salesIdsInMonth), eq(salesItemLots.companyId, companyId), isNull(salesItemLots.deletedAt)));

    const costsRows = await tx
      .select()
      .from(salesAdditionalCosts)
      .where(and(inArray(salesAdditionalCosts.salesId, salesIdsInMonth), eq(salesAdditionalCosts.companyId, companyId)));
    const costsBySalesId = new Map(costsRows.map((row) => [row.salesId, row]));

    const lotsBySalesId = new Map<string, typeof lotPickRows>();
    for (const row of lotPickRows) {
      const bucket = lotsBySalesId.get(row.salesId) ?? [];
      bucket.push(row);
      lotsBySalesId.set(row.salesId, bucket);
    }

    for (const [salesId, lots] of lotsBySalesId) {
      const costs = costsBySalesId.get(salesId);
      const sharedCharges: SharedCharges = costs
        ? { freight: costs.freight, insurance: costs.insurance, customs: costs.customs, other: costs.otherCharges }
        : { freight: "0", insurance: "0", customs: "0", other: "0" };
      const totalCost = totalCostAfterSharedCharges(
        lots.map((lot) => ({ qty: lot.qty, landedRate: lot.landedRate })),
        sharedCharges,
      );
      const salesValue = lots.reduce((sum, lot) => sum.plus(lot.salesAmountUsd), new Decimal(0));
      grossProfitUsd = grossProfitUsd.plus(computeGrossProfit(salesValue, totalCost));
      if (costs) {
        additionalCostsUsd = additionalCostsUsd.plus(costs.freight).plus(costs.insurance).plus(costs.customs).plus(costs.otherCharges);
      }
    }
  }
  const netProfitUsd = grossProfitUsd.minus(additionalCostsUsd);

  const outstandingRows = await tx
    .select({
      invoiceAmountUsd: salesInvoices.invoiceAmountUsd,
      paidAmountUsd: sql<string>`coalesce(sum(${salesPaymentAllocations.appliedAmountUsd}), 0)`.as("paid_amount_usd"),
    })
    .from(salesInvoices)
    .leftJoin(salesPaymentAllocations, and(eq(salesPaymentAllocations.invoiceId, salesInvoices.id), isNull(salesPaymentAllocations.deletedAt)))
    .where(and(eq(salesInvoices.companyId, companyId), eq(salesInvoices.status, "approved"), isNull(salesInvoices.deletedAt)))
    .groupBy(salesInvoices.id)
    .having(sql`${salesInvoices.invoiceAmountUsd} > coalesce(sum(${salesPaymentAllocations.appliedAmountUsd}), 0)`);
  const outstandingReceivablesUsd = outstandingRows.reduce(
    (sum, row) => sum.plus(new Decimal(row.invoiceAmountUsd).minus(row.paidAmountUsd)),
    new Decimal(0),
  );

  const approvedSales = await tx.select({ id: sales.id }).from(sales).where(and(eq(sales.companyId, companyId), eq(sales.status, "approved")));
  let shipmentPendingCount = 0;
  for (const row of approvedSales) {
    const reservedAndConsumed = await tx
      .select({
        salesItemId: salesItemLots.salesItemId,
        reservedQty: sql<string>`sum(${stockLotReservations.qty})`.as("reserved_qty"),
        consumedQty: sql<string>`sum(${stockLotReservations.consumedQty})`.as("consumed_qty"),
      })
      .from(salesItemLots)
      .innerJoin(stockLotReservations, eq(stockLotReservations.id, salesItemLots.reservationId))
      .innerJoin(salesItems, eq(salesItems.id, salesItemLots.salesItemId))
      .where(
        and(
          eq(salesItems.salesId, row.id),
          eq(salesItemLots.companyId, companyId),
          isNull(salesItemLots.deletedAt),
          isNull(salesItems.deletedAt),
          isNull(stockLotReservations.releasedAt),
        ),
      )
      .groupBy(salesItemLots.salesItemId);
    const reservedItems = reservedAndConsumed.map((r) => ({ id: r.salesItemId, reservedQty: r.reservedQty }));
    const deliveredByItemId = new Map(reservedAndConsumed.map((r) => [r.salesItemId, r.consumedQty]));
    if (computeDeliveredStatus(reservedItems, deliveredByItemId) !== "fully_delivered") {
      shipmentPendingCount += 1;
    }
  }

  const contractRows = await tx.select({ status: contracts.status }).from(contracts).where(and(eq(contracts.companyId, companyId), isNull(contracts.deletedAt)));
  const completedContractsCount = contractRows.filter((row) => row.status === "closed").length;
  const openContractsCount = contractRows.length - completedContractsCount;

  const purchaseRows = await tx
    .select({ purchaseAmountUsd: purchasePricing.purchaseAmountUsd })
    .from(purchases)
    .innerJoin(purchaseItems, and(eq(purchaseItems.purchaseId, purchases.id), isNull(purchaseItems.deletedAt)))
    .innerJoin(purchasePricing, and(eq(purchasePricing.purchaseItemId, purchaseItems.id), isNull(purchasePricing.deletedAt)))
    .where(
      and(
        eq(purchases.companyId, companyId),
        gte(purchases.purchaseDate, monthStart),
        lt(purchases.purchaseDate, monthEnd),
        sql`${purchases.status} != 'cancelled'`,
        isNull(purchases.deletedAt),
      ),
    );
  const totalPurchasesUsd = purchaseRows.reduce((sum, row) => sum.plus(row.purchaseAmountUsd), new Decimal(0));

  const refreshedAt = new Date();

  await tx
    .insert(salesDashboardSnapshots)
    .values({
      companyId,
      periodMonth,
      totalSalesUsd: roundAmount(totalSalesUsd),
      grossProfitUsd: roundAmount(grossProfitUsd),
      netProfitUsd: roundAmount(netProfitUsd),
      outstandingReceivablesUsd: roundAmount(outstandingReceivablesUsd),
      shipmentPendingCount,
      openContractsCount,
      completedContractsCount,
      totalPurchasesUsd: roundAmount(totalPurchasesUsd),
      refreshedAt,
    })
    .onConflictDoUpdate({
      target: [salesDashboardSnapshots.companyId, salesDashboardSnapshots.periodMonth],
      set: {
        totalSalesUsd: roundAmount(totalSalesUsd),
        grossProfitUsd: roundAmount(grossProfitUsd),
        netProfitUsd: roundAmount(netProfitUsd),
        outstandingReceivablesUsd: roundAmount(outstandingReceivablesUsd),
        shipmentPendingCount,
        openContractsCount,
        completedContractsCount,
        totalPurchasesUsd: roundAmount(totalPurchasesUsd),
        refreshedAt,
      },
    });

  for (const [customerId, amount] of byCustomer) {
    await tx
      .insert(salesDashboardCustomerBreakdown)
      .values({ companyId, periodMonth, customerId, salesAmountUsd: roundAmount(amount), refreshedAt })
      .onConflictDoUpdate({
        target: [salesDashboardCustomerBreakdown.companyId, salesDashboardCustomerBreakdown.periodMonth, salesDashboardCustomerBreakdown.customerId],
        set: { salesAmountUsd: roundAmount(amount), refreshedAt },
      });
  }
  for (const [itemId, amount] of byItem) {
    await tx
      .insert(salesDashboardItemBreakdown)
      .values({ companyId, periodMonth, itemId, salesAmountUsd: roundAmount(amount), refreshedAt })
      .onConflictDoUpdate({
        target: [salesDashboardItemBreakdown.companyId, salesDashboardItemBreakdown.periodMonth, salesDashboardItemBreakdown.itemId],
        set: { salesAmountUsd: roundAmount(amount), refreshedAt },
      });
  }
  for (const [countryId, amount] of byCountry) {
    await tx
      .insert(salesDashboardCountryBreakdown)
      .values({ companyId, periodMonth, countryId, salesAmountUsd: roundAmount(amount), refreshedAt })
      .onConflictDoUpdate({
        target: [salesDashboardCountryBreakdown.companyId, salesDashboardCountryBreakdown.periodMonth, salesDashboardCountryBreakdown.countryId],
        set: { salesAmountUsd: roundAmount(amount), refreshedAt },
      });
  }
}

/** Sweeps every company within one tenant schema for the given month - the worker's own per-tenant unit of work, mirroring apps/api/src/core/reporting/sales-dashboard-refresh.ts's refreshSalesDashboardForTenant exactly. */
export async function refreshSalesDashboardForTenant(tx: TenantTx, periodMonth: string): Promise<void> {
  const companyRows = await tx.select({ id: companies.id }).from(companies);
  for (const company of companyRows) {
    await refreshSalesDashboardForCompany(tx, company.id, periodMonth);
  }
}
