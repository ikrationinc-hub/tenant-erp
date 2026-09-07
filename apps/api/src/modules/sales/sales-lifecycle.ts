import { parseMoney } from "../../common/money/decimal.js";
import { insertAuditLog } from "../../core/audit/write.js";
import type { TenantTx } from "../../database/get-db.js";
import { findSalesById, transitionSalesStatus } from "./sales.repository.js";

/**
 * S-4 (docs/SALES-MODULE-PLAN.md): the Delivered fulfilment axis - deferred
 * from S-3 specifically because there was nothing to compute it FROM until
 * Delivery existed (see ADR 0026's own note on this). Mirrors purchase-
 * lifecycle.ts's computeReceivedStatus shape exactly, with one deliberate
 * divergence: the denominator here is RESERVED qty (sum of
 * stock_lot_reservations.qty for that sales item's reservations), not the
 * sales item's raw ordered `quantity` - a sale can only ever deliver what
 * got reserved at Approve time, so comparing against the raw order
 * quantity would be the wrong invariant (Purchase's own denominator,
 * ordered quantity, is correct there because nothing gates how much of an
 * order CAN be received the way reservation gates how much of a sale CAN
 * be delivered). No auto-close mechanism lives here (unlike purchase-
 * lifecycle.ts's maybeAutoClosePurchase) - Closed requires BOTH Delivered
 * AND Invoiced (S-5, not built yet), per sales.ts's own schema comment;
 * S-4 alone only ever computes this one axis.
 */
export type DeliveredStatus = "not_delivered" | "partial" | "fully_delivered";

/** Both compute functions only need `id` + a reserved qty - this minimal shape lets sales.service.ts's list() (a future batched, per-page version) reuse the same function getById does, mirroring purchase-lifecycle.ts's own OrderedQuantityLike precedent. */
export interface ReservedQuantityLike {
  id: string;
  reservedQty: string;
}

/** Not stored, computed on read by summing stock_lot_reservations.consumedQty (via sales_item_lots) against each item's own RESERVED quantity - never mutable truth on the sales row itself. */
export function computeDeliveredStatus(reservedItems: ReservedQuantityLike[], deliveredByItemId: Map<string, string>): DeliveredStatus {
  if (reservedItems.length === 0) {
    return "not_delivered";
  }
  let anyDelivered = false;
  let allFullyDelivered = true;
  for (const item of reservedItems) {
    const delivered = parseMoney(deliveredByItemId.get(item.id) ?? "0");
    const reserved = parseMoney(item.reservedQty);
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

/** realized = true once ANY delivery has occurred (docs/SALES-MODULE-PLAN.md's literal "Realized profit flips true on delivery") - a derived boolean, never stored, computed from the same deliveredStatus this file already produces. */
export function computeRealized(deliveredStatus: DeliveredStatus): boolean {
  return deliveredStatus !== "not_delivered";
}

/**
 * S-5 (docs/SALES-MODULE-PLAN.md): the Invoiced fulfilment axis - mirrors
 * computeDeliveredStatus's own shape, denominator is DELIVERED quantity
 * (not reserved, not ordered) per docs/adr/0028 - an invoice should only
 * ever bill what actually shipped. A sales item with nothing delivered yet
 * contributes nothing to either "any invoiced" or "all fully invoiced" -
 * it is simply absent from `deliveredItems`, matching "invoice independent
 * of delivery" (a sale can be invoiced before anything ships, in which
 * case this axis is vacuously "not_invoiced" until delivery data exists to
 * compare against, exactly like computeDeliveredStatus is "not_delivered"
 * for a sale with zero reserved items).
 */
export type InvoicedStatus = "not_invoiced" | "partial" | "fully_invoiced";

export interface DeliveredQuantityLike {
  id: string;
  deliveredQty: string;
}

export function computeInvoicedStatus(deliveredItems: DeliveredQuantityLike[], invoicedByItemId: Map<string, string>): InvoicedStatus {
  if (deliveredItems.length === 0) {
    return "not_invoiced";
  }
  let anyInvoiced = false;
  let allFullyInvoiced = true;
  for (const item of deliveredItems) {
    const invoiced = parseMoney(invoicedByItemId.get(item.id) ?? "0");
    const delivered = parseMoney(item.deliveredQty);
    if (invoiced.gt(0)) {
      anyInvoiced = true;
    }
    if (invoiced.lt(delivered)) {
      allFullyInvoiced = false;
    }
  }
  if (!anyInvoiced) {
    return "not_invoiced";
  }
  return allFullyInvoiced ? "fully_invoiced" : "partial";
}

/** Mirrors purchase-lifecycle.ts's computePaidStatus exactly - keyed by INVOICE amount, not by item, since payment settles invoices not items. Zero invoices (or all reversed) is "not_paid" - there's nothing to pay yet. */
export type PaidStatus = "not_paid" | "partial" | "fully_paid";

export interface InvoiceAmountLike {
  id: string;
  invoiceAmountUsd: string;
}

export function computePaidStatus(invoices: InvoiceAmountLike[], paidByInvoiceId: Map<string, string>): PaidStatus {
  if (invoices.length === 0) {
    return "not_paid";
  }
  let anyPaid = false;
  let allFullyPaid = true;
  for (const invoice of invoices) {
    const paid = parseMoney(paidByInvoiceId.get(invoice.id) ?? "0");
    const amount = parseMoney(invoice.invoiceAmountUsd);
    if (paid.gt(0)) {
      anyPaid = true;
    }
    if (paid.lt(amount)) {
      allFullyPaid = false;
    }
  }
  if (!anyPaid) {
    return "not_paid";
  }
  return allFullyPaid ? "fully_paid" : "partial";
}

/**
 * S-5: THE auto-close mechanism, finally reachable now that both axes
 * exist - Closed is derived and automatic (no route, no permission of its
 * own), mirroring purchase-lifecycle.ts's maybeAutoClosePurchase exactly.
 * A no-op unless the sale is currently Approved and BOTH Delivered AND
 * Invoiced are fully done (sales.ts's own schema comment's own
 * requirement, unchanged since S-3/S-4) - never fires from Draft (an
 * unapproved sale was never fulfilled, so "done" has no meaning), never
 * re-fires once already Closed (transitionSalesStatus's CAS `WHERE status
 * = 'approved'` makes a second call from either caller in the same
 * request cycle a safe no-op).
 */
export async function maybeAutoCloseSalesOrder(
  tx: TenantTx,
  companyId: string,
  salesId: string,
  deliveredStatus: DeliveredStatus,
  invoicedStatus: InvoicedStatus,
): Promise<void> {
  if (deliveredStatus !== "fully_delivered" || invoicedStatus !== "fully_invoiced") {
    return;
  }
  const existing = await findSalesById(tx, companyId, salesId);
  if (!existing || existing.status !== "approved") {
    return;
  }
  const row = await transitionSalesStatus(tx, companyId, salesId, { from: "approved", to: "closed" });
  if (!row) {
    return;
  }
  await insertAuditLog(tx, {
    companyId,
    changedBy: existing.approvedBy ?? existing.createdBy,
    entity: "sales",
    entityId: salesId,
    action: "sales.closed",
    before: { status: existing.status },
    after: { status: row.status },
  });
}
