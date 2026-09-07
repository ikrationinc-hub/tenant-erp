import { parseMoney } from "../../common/money/decimal.js";

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
