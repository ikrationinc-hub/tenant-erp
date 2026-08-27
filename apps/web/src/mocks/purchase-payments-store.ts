/**
 * PL-5 mock: the payments array + paid-amount lookup, split into its OWN
 * module so purchase-handlers.ts (needs paid amounts for paidStatus/the
 * fulfilment strip) and purchase-payments-handlers.ts (owns the actual
 * POST /payments mutation) can both depend on this without either
 * importing the other - purchase-payments-handlers.ts already imports
 * `purchases` FROM purchase-handlers.ts, so the reverse import would be a
 * genuine two-file cycle. Mirrors the real backend's own
 * purchase-lifecycle.ts, built for exactly this reason (PL-3's ADR 0018).
 */

export interface MockPaymentAllocation {
  id: string;
  paymentId: string;
  billId: string;
  appliedAmountUsd: string;
}

export interface MockPayment {
  id: string;
  paymentNumber: string;
  supplierId: string;
  paymentDate: string;
  paymentMode: string;
  referenceNumber?: string;
  notes?: string;
  paymentAmountUsd: string;
  allocations: MockPaymentAllocation[];
}

/** Module-scope, same convention as purchase-handlers.ts's own `purchases` array - reset only by a full page reload, never between tests. */
export const payments: MockPayment[] = [];

/** SUM(applied_amount_usd) per bill, across every payment ever recorded - mirrors the real backend's sumPaidAmountsByBill exactly. */
export function paidAmountByBillId(): Map<string, number> {
  const totals = new Map<string, number>();
  for (const payment of payments) {
    for (const allocation of payment.allocations) {
      totals.set(allocation.billId, (totals.get(allocation.billId) ?? 0) + Number(allocation.appliedAmountUsd));
    }
  }
  return totals;
}
