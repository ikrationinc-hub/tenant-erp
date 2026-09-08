import type { RequestContext } from "../../common/context/request-context.js";
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from "../../common/errors/index.js";
import { parseMoney } from "../../common/money/decimal.js";
import { insertAuditLog } from "../../core/audit/write.js";
import { withTenantDb } from "../../database/get-db.js";
import {
  findSalesItemLotById,
  findStockLotById,
  insertSalesItemLot,
  listAvailableStockLotsForItem,
  listLotsForSalesItem,
  softDeleteSalesItemLot,
  type SalesItemLotRow,
  type StockLotRow,
} from "./sales-item-lots.repository.js";
import { findItemById } from "./sales-items.repository.js";
import type { AddSalesItemLotInput, AvailableStockLotsQuery } from "./sales-item-lots.validator.js";
import { findSalesById } from "./sales.repository.js";
import { assertItemsEditable } from "./sales.service.js";

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

/**
 * FR-104's "block qty > available" at DRAFT time - a live, UNLOCKED read of
 * receivedQty - reservedQty - deliveredQty (no FOR UPDATE here; that only
 * happens for real at Approve, via core/inventory-lots' reserveFromLot in
 * the same transaction as the status change). This is purely a UX/data-
 * integrity nicety at pick time - it does NOT guarantee the qty is still
 * available by the time Approve actually runs (another sale could reserve
 * the same lot in between); Approve's own reserveFromLot call is what
 * actually enforces this under concurrency, exactly as S-2's own
 * concurrency test proves. A picker that races past this check and then
 * fails at Approve gets a clear ConflictError there, not a silent
 * overselling bug.
 */
function computeAvailable(lot: { receivedQty: string; reservedQty: string; deliveredQty: string }) {
  return parseMoney(lot.receivedQty).minus(lot.reservedQty).minus(lot.deliveredQty);
}

export interface StockLotWithAvailability extends StockLotRow {
  /** receivedQty - reservedQty - deliveredQty, computed here (decimal.js) rather than left to the frontend - frontend rule 3: the frontend never calculates money/quantity, not even for display. */
  availableQty: string;
}

/**
 * The lot-picker's own read - every stock_lots row matching the given
 * item/grade, for the frontend to offer as pick candidates. No lock
 * (that's Approve's job via reserveFromLot) - just a live snapshot, with
 * availableQty already computed server-side.
 *
 * When `salesItemId` is given, availableQty ALSO subtracts what that
 * SAME sales item has already picked from each lot - mirrors addLot's
 * own alreadyPickedFromThisLot check exactly. Without this, a lot this
 * item already picked (say, all of it) still reported its full raw
 * availableQty here, since reservedQty on stock_lots itself doesn't move
 * until Approve - the dropdown would offer the same lot as pickable
 * again, only to have addLot correctly reject it moments later with a
 * "0 available" the read side never showed. Caught in manual testing.
 */
export async function listAvailableLots(ctx: RequestContext, query: AvailableStockLotsQuery): Promise<StockLotWithAvailability[]> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, async (tx) => {
    const lots = await listAvailableStockLotsForItem(tx, scope.companyId, query.itemId, query.gradeId ?? null);

    const alreadyPickedByLotId = new Map<string, ReturnType<typeof parseMoney>>();
    if (query.salesItemId) {
      const existingLotsForItem = await listLotsForSalesItem(tx, scope.companyId, query.salesItemId);
      for (const pick of existingLotsForItem) {
        alreadyPickedByLotId.set(pick.stockLotId, (alreadyPickedByLotId.get(pick.stockLotId) ?? parseMoney("0")).plus(pick.qty));
      }
    }

    return lots.map((lot) => {
      const alreadyPicked = alreadyPickedByLotId.get(lot.id) ?? parseMoney("0");
      return { ...lot, availableQty: computeAvailable(lot).minus(alreadyPicked).toString() };
    });
  });
}

/** FR-104: pick a lot for a sales item. Draft or Approved (assertItemsEditable, same gate as items themselves) - not yet reserved (reservationId stays null until Approve). */
export async function addLot(ctx: RequestContext, salesId: string, itemId: string, input: AddSalesItemLotInput): Promise<SalesItemLotRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const salesOrder = await findSalesById(tx, scope.companyId, salesId);
    if (!salesOrder) {
      throw new NotFoundError("Sales order not found");
    }
    assertItemsEditable(tx, scope.companyId, salesOrder);

    const item = await findItemById(tx, scope.companyId, salesId, itemId);
    if (!item) {
      throw new NotFoundError("Sales item not found");
    }

    const lot = await findStockLotById(tx, scope.companyId, input.stockLotId);
    if (!lot) {
      throw new NotFoundError("Stock lot not found");
    }
    if (lot.itemId !== item.itemId || lot.gradeId !== item.gradeId) {
      throw new ValidationError("The selected lot's item/grade does not match this sales item");
    }

    const qty = parseMoney(input.qty);
    if (qty.lte(0)) {
      throw new ValidationError("qty must be a positive number");
    }
    const existingLotsForItem = await listLotsForSalesItem(tx, scope.companyId, itemId);
    const alreadyPickedFromThisLot = existingLotsForItem
      .filter((row) => row.stockLotId === input.stockLotId)
      .reduce((sum, row) => sum.plus(row.qty), parseMoney("0"));
    const available = computeAvailable(lot).minus(alreadyPickedFromThisLot);
    if (qty.gt(available)) {
      throw new ConflictError(`Only ${available.toString()} available in this lot - requested ${qty.toString()}`);
    }

    const row = await insertSalesItemLot(tx, {
      salesItemId: itemId,
      companyId: scope.companyId,
      stockLotId: input.stockLotId,
      qty: qty.toString(),
      createdBy: scope.userId,
    });

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "sales_item_lot",
      entityId: row.id,
      action: "sales_item_lot.created",
      after: { salesItemId: itemId, stockLotId: input.stockLotId, qty: row.qty },
    });

    return row;
  });
}

/** Removing a Draft-time pick before it's ever been reserved. Once reservationId is set (Approved), removal must go through Cancel's release path instead - a reserved lot pick can't just be soft-deleted, since a real hold on stock_lots.reservedQty needs releaseReservation to unwind it correctly. */
export async function removeLot(ctx: RequestContext, salesId: string, itemId: string, lotId: string): Promise<void> {
  const scope = requireTenantScope(ctx);

  await withTenantDb(ctx, async (tx) => {
    const salesOrder = await findSalesById(tx, scope.companyId, salesId);
    if (!salesOrder) {
      throw new NotFoundError("Sales order not found");
    }
    assertItemsEditable(tx, scope.companyId, salesOrder);

    const existing = await findSalesItemLotById(tx, scope.companyId, lotId);
    if (!existing || existing.salesItemId !== itemId) {
      throw new NotFoundError("Sales item lot not found");
    }
    if (existing.reservationId) {
      throw new ConflictError("This lot pick is already reserved - cancel the sales order to release it, rather than removing the pick directly");
    }

    const row = await softDeleteSalesItemLot(tx, scope.companyId, lotId, scope.userId);
    if (!row) {
      throw new NotFoundError("Sales item lot not found");
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "sales_item_lot",
      entityId: lotId,
      action: "sales_item_lot.deleted",
      before: { deletedAt: null },
      after: { deletedAt: row.deletedAt },
    });
  });
}
