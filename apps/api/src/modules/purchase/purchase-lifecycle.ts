import { parseMoney } from "../../common/money/decimal.js";
import { insertAuditLog } from "../../core/audit/write.js";
import type { TenantTx } from "../../database/get-db.js";
import { findPurchaseById, transitionPurchaseStatus } from "./purchase.repository.js";

/** Both compute functions below only ever read `id`/`quantity` off an ordered item - this minimal shape lets purchase.service.ts's list() (PL-4) pass its own batched, pricing-free OrderedQuantityRow[] through the SAME functions getById already uses on the full PurchaseItemWithPricing[], with no duplicate implementation. */
export interface OrderedQuantityLike {
  id: string;
  quantity: string;
}

/**
 * PL-1 §4 / PL-2 §4 / PL-3: the two derived fulfilment axes, plus the
 * auto-close mechanism that reads them - deliberately their own module,
 * NOT living inside purchase-receipts.service.ts or
 * purchase-bills.service.ts. purchase-receipts.service.ts's confirm() and
 * purchase-bills.service.ts's approve() BOTH need to re-check the OTHER
 * axis after their own write (a receipt confirm needs billedStatus too,
 * to know whether to auto-close; a bill approve needs receivedStatus the
 * same way) - if computeReceivedStatus lived in purchase-receipts.
 * service.ts and purchase-bills.service.ts imported it (or vice versa),
 * that would be a genuine two-file circular import (each already needs
 * something from the other for this exact check). Putting both pure
 * functions and the shared auto-close call here, with no dependency on
 * either sibling service file, breaks that cycle for good.
 */
export type ReceivedStatus = "not_received" | "partial" | "fully_received";
export type BilledStatus = "not_billed" | "partial" | "fully_billed";
export type PaidStatus = "not_paid" | "partial" | "fully_paid";

/** computePaidStatus's own minimal shape - a bill's amount and how much of it has been paid so far, both strings. Unlike received/billed (computed against each ITEM's ordered quantity), paid is computed against each BILL's own amount - a purchase item has no direct "paid" concept, only its bill does (Payment settles bills, not items). */
export interface BillAmountLike {
  id: string;
  billAmountUsd: string;
}

/** Not stored, computed on read by summing CONFIRMED receipt quantities against each item's ordered quantity - never mutable truth on the purchase row itself. */
export function computeReceivedStatus(orderedItems: OrderedQuantityLike[], receivedByItemId: Map<string, string>): ReceivedStatus {
  if (orderedItems.length === 0) {
    return "not_received";
  }
  let anyReceived = false;
  let allFullyReceived = true;
  for (const item of orderedItems) {
    const received = parseMoney(receivedByItemId.get(item.id) ?? "0");
    const ordered = parseMoney(item.quantity);
    if (received.gt(0)) {
      anyReceived = true;
    }
    if (received.lt(ordered)) {
      allFullyReceived = false;
    }
  }
  if (!anyReceived) {
    return "not_received";
  }
  return allFullyReceived ? "fully_received" : "partial";
}

/** Not stored, computed on read by summing EVERY bill's (draft and approved both count - billing itself is the financial fact, unlike receiving where only "confirmed" counts) billed quantities against each item's ordered quantity. Mirrors computeReceivedStatus exactly. */
export function computeBilledStatus(orderedItems: OrderedQuantityLike[], billedByItemId: Map<string, string>): BilledStatus {
  if (orderedItems.length === 0) {
    return "not_billed";
  }
  let anyBilled = false;
  let allFullyBilled = true;
  for (const item of orderedItems) {
    const billed = parseMoney(billedByItemId.get(item.id) ?? "0");
    const ordered = parseMoney(item.quantity);
    if (billed.gt(0)) {
      anyBilled = true;
    }
    if (billed.lt(ordered)) {
      allFullyBilled = false;
    }
  }
  if (!anyBilled) {
    return "not_billed";
  }
  return allFullyBilled ? "fully_billed" : "partial";
}

/**
 * PL-5: not stored, computed on read by summing every PAYMENT ALLOCATION
 * against each of the purchase's own bills' amounts - mirrors computeReceivedStatus/
 * computeBilledStatus's own "not any / all fully / else partial" shape,
 * but keyed by bill rather than by item (a reversed bill contributes
 * nothing further once removed from `bills`, same as how only CONFIRMED
 * receipts count for computeReceivedStatus). A purchase with zero bills
 * (or only reversed ones) is "not_paid" - there's nothing to pay yet,
 * same treatment as a purchase with zero items being "not_received".
 */
export function computePaidStatus(bills: BillAmountLike[], paidByBillId: Map<string, string>): PaidStatus {
  if (bills.length === 0) {
    return "not_paid";
  }
  let anyPaid = false;
  let allFullyPaid = true;
  for (const bill of bills) {
    const paid = parseMoney(paidByBillId.get(bill.id) ?? "0");
    const amount = parseMoney(bill.billAmountUsd);
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
 * PL-3 (docs/PURCHASE-LIFECYCLE-4DOC.md, ADR 0018): THE auto-close
 * mechanism - Closed is derived and automatic, never a user-invoked
 * endpoint (no route, no permission of its own). Called from inside the
 * SAME transaction as whatever last changed the fulfilment picture -
 * purchase-receipts.service.ts's confirm and purchase-bills.service.ts's
 * approve - AFTER their own write, using the freshest possible received/
 * billed figures. A no-op unless the purchase is currently Issued and
 * both axes are fully done; never fires from Draft (an unissued PO was
 * never sent to the supplier, so "done" has no meaning yet) and never
 * re-fires once already Closed (transitionPurchaseStatus's CAS `WHERE
 * status = 'issued'` makes a second call from either caller in the same
 * request cycle a safe no-op, not a duplicate audit entry).
 */
export async function maybeAutoClosePurchase(
  tx: TenantTx,
  companyId: string,
  purchaseId: string,
  receivedStatus: ReceivedStatus,
  billedStatus: BilledStatus,
): Promise<void> {
  if (receivedStatus !== "fully_received" || billedStatus !== "fully_billed") {
    return;
  }
  const existing = await findPurchaseById(tx, companyId, purchaseId);
  if (!existing || existing.status !== "issued") {
    return;
  }
  const row = await transitionPurchaseStatus(tx, companyId, purchaseId, { from: "issued", to: "closed" });
  if (!row) {
    return;
  }
  await insertAuditLog(tx, {
    companyId,
    changedBy: existing.issuedBy ?? existing.createdBy,
    entity: "purchase",
    entityId: purchaseId,
    action: "purchase.closed",
    before: { status: existing.status },
    after: { status: row.status },
  });
}
