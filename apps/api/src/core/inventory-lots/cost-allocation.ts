import { parseMoney, roundAmount, roundRate, type Decimal } from "../../common/money/decimal.js";

export interface CostAllocationLine {
  lotId: string;
  qty: string;
  /** The lot's own already-blended per-unit rate. At receipt-confirm time (before a stock_lots row exists yet) this is the raw purchaseRateUsd with no shared charges folded in yet - the shared charges passed in THIS call are exactly what folds them in. At sale-cost time it is the lot's real, already-landed `stock_lots.landedRate` - the base cost already includes the purchase's own shared charges, so passing the purchase's charges again here would double-count them. */
  landedRate: string;
}

export interface SharedCharges {
  freight: string;
  insurance: string;
  customs: string;
  other: string;
}

export type AllocationBasis = "qty" | "value";

export interface CostAllocationResult {
  lotId: string;
  /** Total cost for this lot's own `qty`: base (qty x landedRate) plus this lot's allocated share of `sharedCharges`, rounded to 2dp (a `numeric(18,2)` amount). */
  cost: string;
}

const ZERO_CHARGES: SharedCharges = { freight: "0", insurance: "0", customs: "0", other: "0" };

function sumCharges(charges: SharedCharges): Decimal {
  return parseMoney(charges.freight).plus(charges.insurance).plus(charges.customs).plus(charges.other);
}

/**
 * PURE function, no DB access, property-testable (S-2's own instruction:
 * "one allocation implementation, not two"). Reused for two distinct
 * callers:
 *
 *  1. Receipt-confirm time (purchase-receipts.service.ts's confirm()):
 *     called with the purchase's OWN shared charges (freight/insurance/
 *     customs/other from purchase_additional_costs) and each line's raw
 *     purchaseRateUsd as `landedRate` (no shared charges folded in yet,
 *     since a stock_lots row doesn't exist at this point) - the result's
 *     per-lot `cost` divided by that line's own qty IS the landedRate the
 *     caller then stamps onto the new stock_lots row.
 *
 *  2. A sale's own cost computation (S-3, future): called with the sale's
 *     own additional charges (if any) and each allocated lot's REAL
 *     `stock_lots.landedRate` - the base cost per lot already reflects the
 *     purchase's shared charges (folded in at receipt time), so this call
 *     only spreads the SALE's own additional charges on top, never
 *     re-allocating the purchase's.
 *
 * Default basis is "qty" (S-2's own explicit default) - each lot's share
 * of `sharedCharges` is proportional to its own qty among all allocated
 * lots' qty. Under "value" basis, share is proportional to (qty x
 * landedRate) instead. Both bases use the full-precision Decimal running
 * total minus already-allocated shares for the LAST line, so the rounded
 * per-line shares sum EXACTLY to the rounded total shared-charge pool
 * (the standard "largest remainder to the last row" rounding-safe
 * allocation pattern) - never independently-rounded shares that can drift
 * from the total by a cent.
 */
export function costAllocation(
  allocations: CostAllocationLine[],
  sharedCharges: SharedCharges = ZERO_CHARGES,
  basis: AllocationBasis = "qty",
): CostAllocationResult[] {
  if (allocations.length === 0) {
    return [];
  }

  const totalCharges = sumCharges(sharedCharges);

  const weights = allocations.map((line) => {
    const qty = parseMoney(line.qty);
    if (basis === "value") {
      return qty.times(parseMoney(line.landedRate));
    }
    return qty;
  });
  const totalWeight = weights.reduce((sum, w) => sum.plus(w), parseMoney("0"));

  let allocatedSoFar = parseMoney("0");
  const results: CostAllocationResult[] = allocations.map((line, index) => {
    const qty = parseMoney(line.qty);
    const baseCost = qty.times(parseMoney(line.landedRate));

    let shareOfCharges: Decimal;
    if (totalWeight.eq(0) || totalCharges.eq(0)) {
      shareOfCharges = parseMoney("0");
    } else if (index === allocations.length - 1) {
      // Last line absorbs whatever remains, so the sum of shares equals
      // totalCharges exactly regardless of rounding on earlier lines.
      shareOfCharges = totalCharges.minus(allocatedSoFar);
    } else {
      const weight = weights[index] ?? parseMoney("0");
      shareOfCharges = totalCharges.times(weight).dividedBy(totalWeight);
    }
    allocatedSoFar = allocatedSoFar.plus(shareOfCharges);

    return { lotId: line.lotId, cost: roundAmount(baseCost.plus(shareOfCharges)) };
  });

  return results;
}

/**
 * Per-unit landed rate for ONE line, given its share of the shared-charge
 * pool from `costAllocation` above. Used by purchase-receipts.service.ts's
 * confirm() to turn costAllocation's per-lot `cost` (qty x rate + share)
 * back into a per-unit rate to stamp onto stock_lots.landedRate. Rounds to
 * 6dp (a `numeric(18,6)` rate column), matching roundRate's existing
 * convention for unit rates.
 */
export function landedRatePerUnit(cost: string, qty: string): string {
  const qtyDecimal = parseMoney(qty);
  if (qtyDecimal.eq(0)) {
    throw new Error("Cannot compute a per-unit landed rate for a zero-quantity line");
  }
  return roundRate(parseMoney(cost).dividedBy(qtyDecimal));
}

export interface GrossProfitInput {
  salesValue: string;
  totalCost: string;
}

export interface GrossProfitResult {
  grossProfit: string;
  profitPercent: string;
}

/**
 * PURE function, decimal.js throughout (never native arithmetic - CLAUDE.md
 * rule 1). `grossProfit` rounds to 2dp via roundAmount (a numeric(18,2)
 * amount, matching purchase_pricing's own amount columns). `profitPercent`
 * follows the same 2dp convention purchase_pricing's percent-shaped fields
 * use elsewhere in this codebase (no existing percent column rounds to
 * more or fewer places) - profit / sales x 100, guarded against
 * division-by-zero (an all-zero sale has an undefined percent, reported as
 * "0.00" rather than throwing, since a $0 sale is a legitimate, if odd,
 * input this pure function must not crash on).
 */
export function grossProfit(input: GrossProfitInput): GrossProfitResult {
  const salesValue = parseMoney(input.salesValue);
  const totalCost = parseMoney(input.totalCost);
  const profit = salesValue.minus(totalCost);

  const profitPercent = salesValue.eq(0) ? parseMoney("0") : profit.dividedBy(salesValue).times(100);

  return {
    grossProfit: roundAmount(profit),
    profitPercent: roundAmount(profitPercent),
  };
}
