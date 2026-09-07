import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { parseMoney, roundAmount } from "../../common/money/decimal.js";
import type { TenantTx } from "../../database/get-db.js";
import {
  companies,
  contracts,
  customers,
  purchaseItems,
  purchasePricing,
  purchases,
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
  sales,
  stockLots,
} from "../../database/tenant/schema.js";
import { costAllocation, grossProfit } from "../inventory-lots/cost-allocation.js";
import { computeDeliveredStatus } from "../../modules/sales/sales-lifecycle.js";
import { sumReservedAndConsumedBySalesItem } from "../../modules/sales/deliveries.repository.js";

/** Always the 1st of the month, e.g. "2026-03-01" for March 2026 - matches sales_dashboard_snapshots.periodMonth's own convention. */
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

/**
 * S-6 (docs/SALES-MODULE-PLAN.md): computes and upserts one company's one
 * month's worth of dashboard figures, in one transaction - the sole write
 * path for sales_dashboard_snapshots/*_breakdown. Never called from a
 * request handler (GET /sales/dashboard only ever reads these tables) -
 * only from the BullMQ refresh worker (apps/worker/src/workers/sales-
 * dashboard-refresh.worker.ts), matching the plan's own "not run against
 * OLTP tables under load" rule.
 */
export async function refreshSalesDashboardForCompany(tx: TenantTx, companyId: string, periodMonth: string): Promise<void> {
  const monthStart = periodMonth;
  const monthEnd = nextMonth(periodMonth);
  const inMonth = and(gte(sales.salesDate, monthStart), lt(sales.salesDate, monthEnd));

  // Total/Monthly Sales + Customer-wise + Item-wise + Country-wise: one
  // pass over every non-cancelled sales item in the month, revenue only.
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
    .where(and(eq(sales.companyId, companyId), inMonth, sql`${sales.status} != 'cancelled'`, isNull(sales.deletedAt)));

  let totalSalesUsd = parseMoney("0");
  const byCustomer = new Map<string, ReturnType<typeof parseMoney>>();
  const byCountry = new Map<string, ReturnType<typeof parseMoney>>();
  const byItem = new Map<string, ReturnType<typeof parseMoney>>();
  for (const row of revenueRows) {
    const amount = parseMoney(row.salesAmountUsd);
    totalSalesUsd = totalSalesUsd.plus(amount);
    byCustomer.set(row.customerId, (byCustomer.get(row.customerId) ?? parseMoney("0")).plus(amount));
    byCountry.set(row.countryId, (byCountry.get(row.countryId) ?? parseMoney("0")).plus(amount));
    byItem.set(row.itemId, (byItem.get(row.itemId) ?? parseMoney("0")).plus(amount));
  }

  // Gross/Net Profit: per sales item with picked lots, call costAllocation/
  // grossProfit against that item's own lot picks (each lot's real,
  // already-landed stock_lots.landedRate) plus the sale's own additional
  // costs, summed across the month. First real caller grossProfit() has
  // ever had (docs/adr/0029).
  const salesInMonth = await tx
    .select({ id: sales.id })
    .from(sales)
    .where(and(eq(sales.companyId, companyId), inMonth, sql`${sales.status} != 'cancelled'`, isNull(sales.deletedAt)));
  const salesIdsInMonth = salesInMonth.map((row) => row.id);

  let grossProfitUsd = parseMoney("0");
  let additionalCostsUsd = parseMoney("0");
  if (salesIdsInMonth.length > 0) {
    const lotPickRows = await tx
      .select({
        salesId: salesItems.salesId,
        salesAmountUsd: salesPricing.salesAmountUsd,
        lotId: salesItemLots.stockLotId,
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
      const sharedCharges = costs
        ? { freight: costs.freight, insurance: costs.insurance, customs: costs.customs, other: costs.otherCharges }
        : undefined;
      const allocation = costAllocation(
        lots.map((lot) => ({ lotId: lot.lotId, qty: lot.qty, landedRate: lot.landedRate })),
        sharedCharges,
      );
      const totalCost = allocation.reduce((sum, line) => sum.plus(line.cost), parseMoney("0"));
      const salesValue = lots.reduce((sum, lot) => sum.plus(lot.salesAmountUsd), parseMoney("0"));
      const { grossProfit: profit } = grossProfit({ salesValue: salesValue.toString(), totalCost: totalCost.toString() });
      grossProfitUsd = grossProfitUsd.plus(profit);
      if (costs) {
        additionalCostsUsd = additionalCostsUsd
          .plus(costs.freight)
          .plus(costs.insurance)
          .plus(costs.customs)
          .plus(costs.otherCharges);
      }
    }
  }
  const netProfitUsd = grossProfitUsd.minus(additionalCostsUsd);

  // Outstanding Receivables: company-wide, independent of month (a
  // receivable stays outstanding regardless of which month its invoice
  // was raised in - this KPI is always "as of now", not "as of this
  // period", matching how the credit-exposure warning reads it too).
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
    (sum, row) => sum.plus(parseMoney(row.invoiceAmountUsd).minus(row.paidAmountUsd)),
    parseMoney("0"),
  );

  // Shipment Pending: count of currently-approved sales (any month, same
  // "as of now" reasoning as receivables) whose deliveredStatus isn't
  // fully_delivered yet.
  const approvedSales = await tx
    .select({ id: sales.id })
    .from(sales)
    .where(and(eq(sales.companyId, companyId), eq(sales.status, "approved"), isNull(sales.deletedAt)));
  let shipmentPendingCount = 0;
  for (const row of approvedSales) {
    const reservedAndConsumed = await sumReservedAndConsumedBySalesItem(tx, companyId, row.id);
    const reservedItems = reservedAndConsumed.map((r) => ({ id: r.salesItemId, reservedQty: r.reservedQty }));
    const deliveredByItemId = new Map(reservedAndConsumed.map((r) => [r.salesItemId, r.consumedQty]));
    if (computeDeliveredStatus(reservedItems, deliveredByItemId) !== "fully_delivered") {
      shipmentPendingCount += 1;
    }
  }

  // Open/Completed Contracts: company-wide, no sale-level join (contracts
  // has no customerId, only a nullable/unconstrained sourceType+sourceId
  // pair - not a reliable FK to filter by sale).
  const contractRows = await tx.select({ status: contracts.status }).from(contracts).where(and(eq(contracts.companyId, companyId), isNull(contracts.deletedAt)));
  const completedContractsCount = contractRows.filter((row) => row.status === "closed").length;
  const openContractsCount = contractRows.length - completedContractsCount;

  // Sales vs Purchase Analysis: this month's purchasePricing.purchaseAmountUsd
  // sum - the structural mirror of salesPricing.salesAmountUsd.
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
  const totalPurchasesUsd = purchaseRows.reduce((sum, row) => sum.plus(row.purchaseAmountUsd), parseMoney("0"));

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

/** Sweeps every company within one tenant schema for the given month - the worker's own per-tenant unit of work. */
export async function refreshSalesDashboardForTenant(tx: TenantTx, periodMonth: string): Promise<void> {
  const companyRows = await tx.select({ id: companies.id }).from(companies);
  for (const company of companyRows) {
    await refreshSalesDashboardForCompany(tx, company.id, periodMonth);
  }
}
