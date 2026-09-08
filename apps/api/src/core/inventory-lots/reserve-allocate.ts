import { ConflictError, ValidationError } from "../../common/errors/index.js";
import { parseMoney, roundRate } from "../../common/money/decimal.js";
import type { TenantTx } from "../../database/get-db.js";
import { insertStockMovement, type StockMovementRow } from "../../modules/inventory/stock-movements.repository.js";
import {
  findLotForUpdate,
  findReservationById,
  insertReservation,
  updateLotCounters,
  updateReservation,
  type StockLotReservationRow,
} from "./stock-lots.repository.js";

export { costAllocation, grossProfit, landedRatePerUnit } from "./cost-allocation.js";
export type {
  AllocationBasis,
  CostAllocationLine,
  CostAllocationResult,
  GrossProfitInput,
  GrossProfitResult,
  SharedCharges,
} from "./cost-allocation.js";

export interface ReserveFromLotInput {
  lotId: string;
  qty: string;
  referenceType: string;
  referenceId: string;
  createdBy: string;
  branchId?: string;
}

/**
 * THE lock-then-write critical section (S-2's own highest-risk code).
 * Identical locking contract to core/numbering's nextNumber: `tx` MUST
 * already be open on the caller's transaction - this function never opens
 * its own, so the reservation and the lot's counter update commit or roll
 * back together. Locks the lot row FIRST, then reads its available
 * capacity from the JUST-LOCKED row - never check-then-lock, which would
 * let two concurrent callers both read a stale "available" figure before
 * either writes back. Two concurrent callers against the SAME lot
 * serialize on this lock: the second blocks until the first's transaction
 * commits or rolls back, then re-reads the now-updated counters - exactly
 * the guarantee FR-104 (do not oversell a specific lot) needs.
 */
export async function reserveFromLot(tx: TenantTx, input: ReserveFromLotInput): Promise<StockLotReservationRow> {
  const qty = parseMoney(input.qty);
  if (qty.lte(0)) {
    throw new ValidationError(`Reservation qty must be greater than 0, got ${input.qty}`);
  }

  const lot = await findLotForUpdate(tx, input.lotId);

  const available = parseMoney(lot.receivedQty).minus(lot.reservedQty).minus(lot.deliveredQty);
  if (available.lt(qty)) {
    throw new ConflictError(`Only ${available.toString()} available in lot ${input.lotId}, requested ${qty.toString()}`, {
      lotId: input.lotId,
      available: available.toString(),
      requested: qty.toString(),
    });
  }

  await updateLotCounters(tx, input.lotId, {
    reservedQty: roundRate(parseMoney(lot.reservedQty).plus(qty)),
    deliveredQty: lot.deliveredQty,
  });

  return insertReservation(tx, {
    companyId: lot.companyId,
    ...(input.branchId ? { branchId: input.branchId } : {}),
    stockLotId: input.lotId,
    qty: roundRate(qty),
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    createdBy: input.createdBy,
  });
}

/**
 * Releases whatever portion of a reservation was never consumed
 * (qty - consumedQty), giving that capacity back to the lot. Locks the
 * reservation's lot first (same contract as reserveFromLot), then
 * decrements reservedQty by the un-consumed remainder.
 *
 * Idempotent-guarded, not idempotent-silent: calling release twice, or
 * releasing an already-fully-consumed reservation, throws a clear
 * ConflictError rather than silently no-op-ing - a caller that thinks it
 * just released capacity that was actually already released has a bug
 * worth surfacing, not hiding.
 */
export async function releaseReservation(tx: TenantTx, reservationId: string): Promise<void> {
  const reservation = await findReservationById(tx, reservationId);
  if (reservation.releasedAt) {
    throw new ConflictError(`Reservation ${reservationId} was already released at ${reservation.releasedAt.toISOString()}`);
  }
  if (reservation.consumedAt) {
    throw new ConflictError(`Reservation ${reservationId} is already fully consumed and cannot be released`);
  }

  const lot = await findLotForUpdate(tx, reservation.stockLotId);

  const remaining = parseMoney(reservation.qty).minus(reservation.consumedQty);

  await updateLotCounters(tx, reservation.stockLotId, {
    reservedQty: roundRate(parseMoney(lot.reservedQty).minus(remaining)),
    deliveredQty: lot.deliveredQty,
  });

  await updateReservation(tx, reservationId, { releasedAt: new Date() });
}

export interface ConsumeReservationInput {
  qty: string;
  movementDate: string;
  createdBy: string;
}

export interface ConsumeReservationResult {
  movement: StockMovementRow;
}

/**
 * Converts (all or part of) a reservation into an actual outbound
 * stock_movements row - the moment a sale's reserved stock genuinely
 * leaves the warehouse. Locks the lot first (same contract as
 * reserveFromLot/releaseReservation), verifies the requested qty does not
 * exceed the reservation's own un-consumed remainder (cannot over-consume
 * a reservation), moves `qty` from reservedQty to deliveredQty on the lot,
 * updates the reservation's consumedQty and - only once it reaches the
 * reservation's full qty - stamps consumedAt. Supports partial
 * consumption: a caller may call this more than once against the same
 * reservation as long as the cumulative qty never exceeds it.
 */
export async function consumeReservation(
  tx: TenantTx,
  reservationId: string,
  input: ConsumeReservationInput,
): Promise<ConsumeReservationResult> {
  const qty = parseMoney(input.qty);
  if (qty.lte(0)) {
    throw new ValidationError(`Consume qty must be greater than 0, got ${input.qty}`);
  }

  const reservation = await findReservationById(tx, reservationId);
  if (reservation.releasedAt) {
    throw new ConflictError(`Reservation ${reservationId} was released and cannot be consumed`);
  }

  const remaining = parseMoney(reservation.qty).minus(reservation.consumedQty);
  if (qty.gt(remaining)) {
    throw new ConflictError(`Cannot consume ${qty.toString()}: reservation ${reservationId} has only ${remaining.toString()} remaining unconsumed`, {
      reservationId,
      remaining: remaining.toString(),
      requested: qty.toString(),
    });
  }

  const lot = await findLotForUpdate(tx, reservation.stockLotId);

  await updateLotCounters(tx, reservation.stockLotId, {
    reservedQty: roundRate(parseMoney(lot.reservedQty).minus(qty)),
    deliveredQty: roundRate(parseMoney(lot.deliveredQty).plus(qty)),
  });

  const newConsumedQty = parseMoney(reservation.consumedQty).plus(qty);
  await updateReservation(tx, reservationId, {
    consumedQty: roundRate(newConsumedQty),
    ...(newConsumedQty.gte(reservation.qty) ? { consumedAt: new Date() } : {}),
  });

  const movement = await insertStockMovement(tx, {
    companyId: lot.companyId,
    ...(lot.branchId ? { branchId: lot.branchId } : {}),
    itemId: lot.itemId,
    ...(lot.gradeId ? { gradeId: lot.gradeId } : {}),
    warehouseId: lot.warehouseId,
    quantity: `-${roundRate(qty)}`,
    uomId: lot.uomId,
    movementType: "sale_delivery",
    movementDate: input.movementDate,
    referenceType: reservation.referenceType,
    referenceId: reservation.referenceId,
    createdBy: input.createdBy,
  });

  return { movement };
}
