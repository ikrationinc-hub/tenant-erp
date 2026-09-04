import { eq } from "drizzle-orm";
import type { TenantTx } from "../../database/get-db.js";
import { stockLotReservations, stockLots } from "../../database/tenant/schema.js";
import { NotFoundError } from "../../common/errors/index.js";

export type StockLotRow = typeof stockLots.$inferSelect;
export type StockLotInsert = typeof stockLots.$inferInsert;
export type StockLotReservationRow = typeof stockLotReservations.$inferSelect;
export type StockLotReservationInsert = typeof stockLotReservations.$inferInsert;

/** Only the repository layer touches SQL (rule 5) - the engine (reserve-allocate.ts) never imports `db`/drizzle directly. */

export async function insertStockLot(tx: TenantTx, values: StockLotInsert): Promise<StockLotRow> {
  const [row] = await tx.insert(stockLots).values(values).returning();
  if (!row) {
    throw new Error("failed to insert stock lot");
  }
  return row;
}

export async function findStockLotById(tx: TenantTx, lotId: string): Promise<StockLotRow | undefined> {
  const [row] = await tx.select().from(stockLots).where(eq(stockLots.id, lotId)).limit(1);
  return row;
}

/**
 * `SELECT ... FOR UPDATE` on exactly one stock_lots row - the entire
 * concurrency control for reservation/consumption (next-number.ts's exact
 * contract: "the row lock IS the concurrency control"). MUST be called
 * with a `tx` already open on the caller's transaction; locks FIRST,
 * before any availability check - never check-then-lock, which would let
 * two concurrent callers both read a stale "available" figure before
 * either writes.
 */
export async function findLotForUpdate(tx: TenantTx, lotId: string): Promise<StockLotRow> {
  const [row] = await tx.select().from(stockLots).where(eq(stockLots.id, lotId)).for("update");
  if (!row) {
    throw new NotFoundError(`Stock lot ${lotId} not found`);
  }
  return row;
}

/**
 * Plain UPDATE of the two cached counters - safe to call ONLY from inside
 * a section that already holds the FOR UPDATE lock on this row (i.e.
 * immediately after findLotForUpdate, within the same transaction). Does
 * not re-lock or re-check anything itself; it trusts the caller's lock.
 */
export async function updateLotCounters(
  tx: TenantTx,
  lotId: string,
  counters: { reservedQty: string; deliveredQty: string },
): Promise<StockLotRow> {
  const [row] = await tx
    .update(stockLots)
    .set({ reservedQty: counters.reservedQty, deliveredQty: counters.deliveredQty, updatedAt: new Date() })
    .where(eq(stockLots.id, lotId))
    .returning();
  if (!row) {
    throw new NotFoundError(`Stock lot ${lotId} not found`);
  }
  return row;
}

export async function insertReservation(tx: TenantTx, values: StockLotReservationInsert): Promise<StockLotReservationRow> {
  const [row] = await tx.insert(stockLotReservations).values(values).returning();
  if (!row) {
    throw new Error("failed to insert stock lot reservation");
  }
  return row;
}

export async function findReservationById(tx: TenantTx, reservationId: string): Promise<StockLotReservationRow> {
  const [row] = await tx.select().from(stockLotReservations).where(eq(stockLotReservations.id, reservationId)).limit(1);
  if (!row) {
    throw new NotFoundError(`Stock lot reservation ${reservationId} not found`);
  }
  return row;
}

export async function updateReservation(
  tx: TenantTx,
  reservationId: string,
  values: Partial<Pick<StockLotReservationInsert, "consumedQty" | "releasedAt" | "consumedAt">>,
): Promise<StockLotReservationRow> {
  const [row] = await tx
    .update(stockLotReservations)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(stockLotReservations.id, reservationId))
    .returning();
  if (!row) {
    throw new NotFoundError(`Stock lot reservation ${reservationId} not found`);
  }
  return row;
}
