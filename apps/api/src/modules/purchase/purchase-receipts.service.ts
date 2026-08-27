import type { RequestContext } from "../../common/context/request-context.js";
import { eventBus } from "../../common/events/bus.js";
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from "../../common/errors/index.js";
import { parseMoney, roundRate } from "../../common/money/decimal.js";
import { insertAuditLog } from "../../core/audit/write.js";
import { nextNumber } from "../../core/numbering/next-number.js";
import { requireAtLeastOneValidLine } from "../../core/workflow/guards.js";
import { findTransition, runGuards, type WorkflowTransition } from "../../core/workflow/transitions.js";
import { withTenantDb } from "../../database/get-db.js";
import type { PaginatedRows } from "../../core/masters/types.js";
import { sumBilledQuantitiesByItem } from "./purchase-bills.repository.js";
import { listItemsWithPricingForPurchase } from "./purchase-items.repository.js";
import { computeBilledStatus, computeReceivedStatus, maybeAutoClosePurchase, type ReceivedStatus } from "./purchase-lifecycle.js";
import {
  findReceiptById,
  insertReceipt,
  insertReceiptItem,
  listAllReceipts,
  listItemsForReceipt,
  listReceiptsForPurchase,
  sumConfirmedReceivedQuantitiesByItem,
  transitionReceiptStatus,
  type PurchaseReceiptItemRow,
  type PurchaseReceiptRow,
  type PurchaseReceiptWithPurchaseNumber,
  type ReceiptsListParams,
} from "./purchase-receipts.repository.js";
import type { CreatePurchaseReceiptInput } from "./purchase-receipts.validator.js";
import { findPurchaseById } from "./purchase.repository.js";

export interface PurchaseReceiptWithItems extends PurchaseReceiptRow {
  items: PurchaseReceiptItemRow[];
}

export type { ReceivedStatus };

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

interface ConfirmGuardContext {
  items: PurchaseReceiptItemRow[];
}

function validateReceiptItemForConfirm(item: PurchaseReceiptItemRow): string | undefined {
  if (parseMoney(item.receivedQuantity).lte(0)) {
    return `Cannot confirm: item ${item.id} has receivedQuantity ${item.receivedQuantity}, must be greater than 0`;
  }
  return undefined;
}

/** Draft -> Confirmed only - a receipt, once confirmed, is immutable (rule 8); there is no re-confirm/edit path (unlike the superseded invoice reconciliation this replaces - PL-1 doesn't build receipt correction, see ADR 0016). */
const PURCHASE_RECEIPT_WORKFLOW: WorkflowTransition<PurchaseReceiptRow["status"], ConfirmGuardContext>[] = [
  {
    name: "confirm",
    from: "draft",
    to: "confirmed",
    permission: "purchase.receipt.confirm",
    guards: [(context) => requireAtLeastOneValidLine(context.items, validateReceiptItemForConfirm, "Cannot confirm: receipt has no items")],
  },
];

/** PL-4: the standalone "Purchase Receipts" list screen's own endpoint - cross-purchase, paginated + filtered server-side (rule 10). Distinct from `list` below, which is scoped to one purchase's own sub-panel. */
export async function listAll(ctx: RequestContext, params: ReceiptsListParams): Promise<PaginatedRows<PurchaseReceiptWithPurchaseNumber>> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, (tx) => listAllReceipts(tx, scope.companyId, params));
}

export async function list(ctx: RequestContext, purchaseId: string): Promise<PurchaseReceiptWithItems[]> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, async (tx) => {
    const receipts = await listReceiptsForPurchase(tx, scope.companyId, purchaseId);
    const withItems: PurchaseReceiptWithItems[] = [];
    for (const receipt of receipts) {
      const items = await listItemsForReceipt(tx, scope.companyId, receipt.id);
      withItems.push({ ...receipt, items });
    }
    return withItems;
  });
}

/**
 * Create is Draft-only output (no confirm here) - a receipt starts life
 * as a real row with real lines, but moves NO stock until a separate
 * confirm call (PATCH .../confirm). Over-receipt is checked at CREATE
 * time too, not only confirm, so a user gets the rejection immediately
 * rather than after filling in a whole draft that can never be confirmed.
 */
export async function create(ctx: RequestContext, purchaseId: string, input: CreatePurchaseReceiptInput): Promise<PurchaseReceiptWithItems> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const purchase = await findPurchaseById(tx, scope.companyId, purchaseId);
    if (!purchase) {
      throw new NotFoundError("Purchase not found");
    }
    if (purchase.status === "draft") {
      throw new ConflictError("Cannot receive against a purchase that is still Draft - issue/approve the purchase order first");
    }

    const orderedItems = await listItemsWithPricingForPurchase(tx, scope.companyId, purchaseId);
    const orderedById = new Map(orderedItems.map((item) => [item.id, item]));
    for (const line of input.items) {
      if (!orderedById.has(line.purchaseItemId)) {
        throw new ValidationError(`Purchase item ${line.purchaseItemId} does not belong to purchase ${purchase.purchaseNumber}`);
      }
    }

    const alreadyReceived = await sumConfirmedReceivedQuantitiesByItem(tx, scope.companyId, purchaseId);
    const alreadyReceivedById = new Map(alreadyReceived.map((row) => [row.purchaseItemId, parseMoney(row.receivedQuantity)]));

    // Guard: cannot receive more than ordered, per item, across ALL
    // (confirmed) receipts - a draft receipt's own quantities don't count
    // toward another draft's over-receipt check, only confirmed ones have
    // actually moved stock.
    for (const line of input.items) {
      const orderedItem = orderedById.get(line.purchaseItemId);
      if (!orderedItem) {
        continue;
      }
      const requestedQuantity = parseMoney(line.receivedQuantity);
      if (requestedQuantity.lte(0)) {
        throw new ValidationError(`receivedQuantity for item ${line.purchaseItemId} must be greater than 0`);
      }
      const alreadyReceivedQuantity = alreadyReceivedById.get(line.purchaseItemId) ?? parseMoney("0");
      const orderedQuantity = parseMoney(orderedItem.quantity);
      if (alreadyReceivedQuantity.plus(requestedQuantity).gt(orderedQuantity)) {
        throw new ConflictError(
          `Cannot receive ${requestedQuantity.toString()} of item ${line.purchaseItemId}: only ${orderedQuantity.minus(alreadyReceivedQuantity).toString()} remains unreceived (ordered ${orderedQuantity.toString()}, already received ${alreadyReceivedQuantity.toString()})`,
        );
      }
    }

    const receiptNumber = await nextNumber(tx, {
      companyId: scope.companyId,
      docType: "PURCHASE_RECEIPT",
      date: new Date(input.receiptDate),
    });

    const receipt = await insertReceipt(tx, {
      companyId: scope.companyId,
      ...(purchase.branchId ? { branchId: purchase.branchId } : {}),
      purchaseId,
      receiptNumber,
      receiptDate: input.receiptDate,
      warehouseId: input.warehouseId,
      receivedBy: scope.userId,
      createdBy: scope.userId,
    });

    const items: PurchaseReceiptItemRow[] = [];
    for (const line of input.items) {
      const item = await insertReceiptItem(tx, {
        receiptId: receipt.id,
        companyId: scope.companyId,
        purchaseItemId: line.purchaseItemId,
        receivedQuantity: roundRate(parseMoney(line.receivedQuantity)),
        createdBy: scope.userId,
      });
      items.push(item);
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "purchase_receipt",
      entityId: receipt.id,
      action: "purchase_receipt.created",
      after: { receiptNumber, purchaseId, receiptDate: receipt.receiptDate, warehouseId: receipt.warehouseId, items: input.items },
    });

    return { ...receipt, items };
  });
}

/**
 * THE stock-writing transition (PL-1/ADR 0016). Emits receipt.confirmed
 * in the SAME transaction as the status change - a handler throw rolls
 * back the confirmation (common/events/bus.ts's synchronous, in-txn
 * dispatch). Net effect: approving a PO moves no stock, approving a bill
 * moves no stock, ONLY this moves stock.
 */
export async function confirm(ctx: RequestContext, purchaseId: string, receiptId: string): Promise<PurchaseReceiptWithItems> {
  const scope = requireTenantScope(ctx);
  const transition = findTransition(PURCHASE_RECEIPT_WORKFLOW, "confirm");

  return withTenantDb(ctx, async (tx) => {
    const purchase = await findPurchaseById(tx, scope.companyId, purchaseId);
    if (!purchase) {
      throw new NotFoundError("Purchase not found");
    }
    const existing = await findReceiptById(tx, scope.companyId, purchaseId, receiptId);
    if (!existing) {
      throw new NotFoundError("Purchase receipt not found");
    }
    const items = await listItemsForReceipt(tx, scope.companyId, receiptId);

    runGuards(transition, { items });

    const row = await transitionReceiptStatus(tx, scope.companyId, receiptId, {
      from: transition.from,
      to: transition.to,
      extra: { confirmedBy: scope.userId, confirmedAt: new Date() },
    });
    if (!row) {
      throw new ConflictError(`Receipt ${existing.receiptNumber} is "${existing.status}", not "${transition.from}" - cannot confirm`);
    }

    const orderedItems = await listItemsWithPricingForPurchase(tx, scope.companyId, purchaseId);
    const orderedById = new Map(orderedItems.map((item) => [item.id, item]));

    await eventBus.emit(tx, "receipt.confirmed", {
      receiptId,
      purchaseId,
      companyId: scope.companyId,
      branchId: row.branchId,
      warehouseId: row.warehouseId,
      confirmedBy: scope.userId,
      items: items.map((item) => {
        const orderedItem = orderedById.get(item.purchaseItemId);
        if (!orderedItem) {
          throw new Error(`Receipt item ${item.id} references purchase item ${item.purchaseItemId} which no longer exists`);
        }
        return {
          purchaseItemId: item.purchaseItemId,
          itemId: orderedItem.itemId,
          gradeId: orderedItem.gradeId,
          quantity: item.receivedQuantity,
          uomId: orderedItem.uomId,
        };
      }),
    });

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "purchase_receipt",
      entityId: receiptId,
      action: "purchase_receipt.confirmed",
      before: { status: existing.status },
      after: { status: row.status },
    });

    // PL-3: this confirm just changed the received axis - check whether
    // the PO is now fully done on BOTH axes and should auto-close, using
    // the freshest possible figures (re-summed after this receipt's own
    // write, in the SAME transaction).
    const receivedSums = await sumConfirmedReceivedQuantitiesByItem(tx, scope.companyId, purchaseId);
    const receivedByItemId = new Map(receivedSums.map((sumRow) => [sumRow.purchaseItemId, sumRow.receivedQuantity]));
    const billedSums = await sumBilledQuantitiesByItem(tx, scope.companyId, purchaseId);
    const billedByItemId = new Map(billedSums.map((sumRow) => [sumRow.purchaseItemId, sumRow.billedQuantity]));
    await maybeAutoClosePurchase(
      tx,
      scope.companyId,
      purchaseId,
      computeReceivedStatus(orderedItems, receivedByItemId),
      computeBilledStatus(orderedItems, billedByItemId),
    );

    return { ...row, items };
  });
}
