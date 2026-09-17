import type { RequestContext } from "../../common/context/request-context.js";
import { ConflictError, NotFoundError, UnauthorizedError } from "../../common/errors/index.js";
import { parseMoney } from "../../common/money/decimal.js";
import { insertAuditLog } from "../../core/audit/write.js";
import { withTenantDb, type TenantTx } from "../../database/get-db.js";
import { computeBilledStatus, computeLineStatus, computeReceivedStatus, maybeAutoClosePurchase, type PurchaseLineStatus } from "./purchase-lifecycle.js";
import { findItemById, listItemsWithPricingForPurchase, updateItem, type PurchaseItemRow } from "./purchase-items.repository.js";
import { sumBilledQuantitiesByItem } from "./purchase-bills.repository.js";
import { sumConfirmedReceivedQuantitiesByItem } from "./purchase-receipts.repository.js";
import { findPurchaseById } from "./purchase.repository.js";

/**
 * docs/PO-SHORT-CLOSE.md, user-confirmed: short-closing a line can itself
 * be the action that finishes both axes (e.g. everything billable was
 * already billed, and this short-close is the last genuinely-pending
 * line) - re-check auto-close here too, using the freshest figures AFTER
 * this short-close's own write, same pattern as purchase-receipts.
 * service.ts's confirm() / purchase-bills.service.ts's approve().
 */
async function maybeAutoCloseAfterShortClose(tx: TenantTx, companyId: string, purchaseId: string): Promise<void> {
  const orderedItems = await listItemsWithPricingForPurchase(tx, companyId, purchaseId);
  const receivedSums = await sumConfirmedReceivedQuantitiesByItem(tx, companyId, purchaseId);
  const receivedByItemId = new Map(receivedSums.map((row) => [row.purchaseItemId, row.receivedQuantity]));
  const billedSums = await sumBilledQuantitiesByItem(tx, companyId, purchaseId);
  const billedByItemId = new Map(billedSums.map((row) => [row.purchaseItemId, row.billedQuantity]));
  await maybeAutoClosePurchase(
    tx,
    companyId,
    purchaseId,
    computeReceivedStatus(orderedItems, receivedByItemId),
    computeBilledStatus(orderedItems, billedByItemId, receivedByItemId),
  );
}

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

interface ShortCloseGuardContext {
  orderedQty: string;
  receivedQty: string;
}

/**
 * docs/PO-SHORT-CLOSE.md: short-close is for a line that genuinely has SOME
 * receipt against it and won't get the rest - "short-closing an order with
 * zero receipts is a cancellation, not a short-close, a different, existing
 * action" (purchase.service.ts's own cancel()). Named guard functions, not
 * inline `if`s (CLAUDE.md: don't scatter status checks) - mirrors
 * requireNothingFulfilledForCancel's own shape in purchase.service.ts.
 */
function requireReceiptExistsForShortClose(context: ShortCloseGuardContext): void {
  if (parseMoney(context.receivedQty).lte(0)) {
    throw new ConflictError("Cannot short-close: no receipt exists against this line yet - cancel the purchase instead if nothing is coming");
  }
}

function requireNotFullyReceivedForShortClose(context: ShortCloseGuardContext): void {
  if (parseMoney(context.receivedQty).gte(parseMoney(context.orderedQty))) {
    throw new ConflictError("Cannot short-close: this line is already fully received - nothing left to write off");
  }
}

async function loadLineFulfilment(tx: TenantTx, companyId: string, purchaseId: string, itemId: string): Promise<{ item: PurchaseItemRow; receivedQty: string }> {
  const item = await findItemById(tx, companyId, purchaseId, itemId);
  if (!item) {
    throw new NotFoundError("Purchase item not found");
  }
  const receivedSums = await sumConfirmedReceivedQuantitiesByItem(tx, companyId, purchaseId);
  const receivedQty = receivedSums.find((row) => row.purchaseItemId === itemId)?.receivedQuantity ?? "0";
  return { item, receivedQty };
}

async function writeShortClose(
  tx: TenantTx,
  companyId: string,
  changedBy: string,
  item: PurchaseItemRow,
  receivedQty: string,
  reason: string,
): Promise<PurchaseItemRow> {
  requireReceiptExistsForShortClose({ orderedQty: item.quantity, receivedQty });
  requireNotFullyReceivedForShortClose({ orderedQty: item.quantity, receivedQty });

  const shortClosedQty = parseMoney(item.quantity).minus(parseMoney(receivedQty)).toString();
  const lineStatus: PurchaseLineStatus = "short_closed";

  const updated = await updateItem(tx, companyId, item.id, {
    shortClosedQty,
    lineStatus,
    updatedBy: changedBy,
  });
  if (!updated) {
    throw new NotFoundError("Purchase item not found");
  }

  await insertAuditLog(tx, {
    companyId,
    changedBy,
    entity: "purchase_item",
    entityId: item.id,
    action: "purchase_item.short_closed",
    before: { shortClosedQty: item.shortClosedQty, lineStatus: item.lineStatus },
    after: { shortClosedQty: updated.shortClosedQty, lineStatus: updated.lineStatus, reason },
  });

  return updated;
}

/**
 * docs/PO-SHORT-CLOSE.md: finalizes ONE line at less than ordered quantity
 * when the supplier under-delivered and won't send the rest. Does NOT
 * touch stock_movements or purchase_receipt_items - nothing about what
 * already happened is reversed, only the line's own expected-remainder is
 * written off going forward.
 */
export async function shortCloseLine(ctx: RequestContext, purchaseId: string, itemId: string, reason: string): Promise<PurchaseItemRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const purchase = await findPurchaseById(tx, scope.companyId, purchaseId);
    if (!purchase) {
      throw new NotFoundError("Purchase not found");
    }
    const { item, receivedQty } = await loadLineFulfilment(tx, scope.companyId, purchaseId, itemId);
    const result = await writeShortClose(tx, scope.companyId, scope.userId, item, receivedQty, reason);
    await maybeAutoCloseAfterShortClose(tx, scope.companyId, purchaseId);
    return result;
  });
}

/**
 * docs/PO-SHORT-CLOSE.md: the PO-level convenience - applies short-close to
 * every line still genuinely partial (received < ordered, not already
 * short-closed, at least one receipt against it). Lines that are open
 * (zero receipts), fully received, or already short-closed are silently
 * skipped, not errored - "short-close everything that's actually
 * short-closable", not "fail the whole batch because one line isn't".
 */
export async function shortCloseAllRemaining(ctx: RequestContext, purchaseId: string, reason: string): Promise<PurchaseItemRow[]> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const purchase = await findPurchaseById(tx, scope.companyId, purchaseId);
    if (!purchase) {
      throw new NotFoundError("Purchase not found");
    }

    const receivedSums = await sumConfirmedReceivedQuantitiesByItem(tx, scope.companyId, purchaseId);
    const receivedByItemId = new Map(receivedSums.map((row) => [row.purchaseItemId, row.receivedQuantity]));

    const items = await listItemsWithPricingForPurchase(tx, scope.companyId, purchaseId);

    const results: PurchaseItemRow[] = [];
    for (const item of items) {
      const receivedQty = receivedByItemId.get(item.id) ?? "0";
      const currentLineStatus = computeLineStatus(item.quantity, receivedQty, item.shortClosedQty);
      if (currentLineStatus !== "partial") {
        continue;
      }
      results.push(await writeShortClose(tx, scope.companyId, scope.userId, item, receivedQty, reason));
    }
    if (results.length > 0) {
      await maybeAutoCloseAfterShortClose(tx, scope.companyId, purchaseId);
    }
    return results;
  });
}

/**
 * docs/PO-SHORT-CLOSE.md §5 / user-confirmed: short-close is reversible
 * with a dedicated permission (purchase.line.reopen), not permanent -
 * clears shortClosedQty and lets receiving/billing resume normally. Only
 * valid on a line that's currently short-closed; re-deriving lineStatus
 * (rather than hardcoding "partial") correctly lands on "fully_received"
 * in the edge case where received quantity moved past ordered while the
 * line sat short-closed (shouldn't normally happen since a short-closed
 * line's ceiling blocks further receiving - purchase-receipts.service.ts -
 * but this stays correct even if that ceiling is ever loosened later).
 */
export async function reopenLine(ctx: RequestContext, purchaseId: string, itemId: string): Promise<PurchaseItemRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const purchase = await findPurchaseById(tx, scope.companyId, purchaseId);
    if (!purchase) {
      throw new NotFoundError("Purchase not found");
    }
    // rule 8: a Closed/Cancelled purchase is immutable - reopening a line
    // on one (now reachable since a short-close can itself trigger
    // auto-close) would silently un-finalize a posted document.
    // Corrections to a closed PO are reversal + re-entry, not this action.
    // Deliberately NOT purchase.service.ts's own assertItemsEditable - its
    // second check (no receipt may exist at all) would always reject the
    // exact case reopen needs to allow, since a short-closed line by
    // definition already has one.
    if (purchase.status === "closed" || purchase.status === "cancelled") {
      throw new ConflictError(`Purchase ${purchase.purchaseNumber} is ${purchase.status} and can no longer be edited`);
    }
    const { item, receivedQty } = await loadLineFulfilment(tx, scope.companyId, purchaseId, itemId);
    if (item.lineStatus !== "short_closed") {
      throw new ConflictError("Cannot reopen: this line is not short-closed");
    }

    const lineStatus = computeLineStatus(item.quantity, receivedQty, "0");
    const updated = await updateItem(tx, scope.companyId, item.id, {
      shortClosedQty: "0",
      lineStatus,
      updatedBy: scope.userId,
    });
    if (!updated) {
      throw new NotFoundError("Purchase item not found");
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "purchase_item",
      entityId: item.id,
      action: "purchase_item.reopened",
      before: { shortClosedQty: item.shortClosedQty, lineStatus: item.lineStatus },
      after: { shortClosedQty: updated.shortClosedQty, lineStatus: updated.lineStatus },
    });

    return updated;
  });
}
