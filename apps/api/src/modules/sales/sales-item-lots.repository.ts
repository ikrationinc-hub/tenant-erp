import { and, eq, inArray, isNull } from "drizzle-orm";
import type { TenantTx } from "../../database/get-db.js";
import { salesItemLots, stockLots } from "../../database/tenant/schema.js";

export type SalesItemLotRow = typeof salesItemLots.$inferSelect;
export type SalesItemLotInsert = typeof salesItemLots.$inferInsert;
export type StockLotRow = typeof stockLots.$inferSelect;

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. */

export async function listLotsForSalesItem(tx: TenantTx, companyId: string, salesItemId: string): Promise<SalesItemLotRow[]> {
  return tx
    .select()
    .from(salesItemLots)
    .where(and(eq(salesItemLots.salesItemId, salesItemId), eq(salesItemLots.companyId, companyId), isNull(salesItemLots.deletedAt)));
}

/** Every lot pick across every item of one sale - what approve() loops to reserve. */
export async function listLotsForSales(tx: TenantTx, companyId: string, salesItemIds: string[]): Promise<SalesItemLotRow[]> {
  if (salesItemIds.length === 0) {
    return [];
  }
  return tx
    .select()
    .from(salesItemLots)
    .where(
      and(inArray(salesItemLots.salesItemId, salesItemIds), eq(salesItemLots.companyId, companyId), isNull(salesItemLots.deletedAt)),
    );
}

export async function findSalesItemLotById(tx: TenantTx, companyId: string, id: string): Promise<SalesItemLotRow | undefined> {
  const [row] = await tx
    .select()
    .from(salesItemLots)
    .where(and(eq(salesItemLots.id, id), eq(salesItemLots.companyId, companyId), isNull(salesItemLots.deletedAt)))
    .limit(1);
  return row;
}

export async function insertSalesItemLot(tx: TenantTx, values: SalesItemLotInsert): Promise<SalesItemLotRow> {
  const [row] = await tx.insert(salesItemLots).values(values).returning();
  if (!row) {
    throw new Error("failed to insert sales item lot");
  }
  return row;
}

export async function updateSalesItemLot(
  tx: TenantTx,
  companyId: string,
  id: string,
  values: Record<string, unknown>,
): Promise<SalesItemLotRow | undefined> {
  const [row] = await tx
    .update(salesItemLots)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(salesItemLots.id, id), eq(salesItemLots.companyId, companyId), isNull(salesItemLots.deletedAt)))
    .returning();
  return row;
}

/** Soft delete (rule 8) - removing a Draft-time lot pick before it's ever been reserved (reservationId still null). */
export async function softDeleteSalesItemLot(tx: TenantTx, companyId: string, id: string, deletedBy: string): Promise<SalesItemLotRow | undefined> {
  const [row] = await tx
    .update(salesItemLots)
    .set({ deletedAt: new Date(), updatedBy: deletedBy, updatedAt: new Date() })
    .where(and(eq(salesItemLots.id, id), eq(salesItemLots.companyId, companyId), isNull(salesItemLots.deletedAt)))
    .returning();
  return row;
}

/** FR-104's read-only availability check at Draft time (no lock - the real lock only happens at Approve via core/inventory-lots' reserveFromLot). Filters candidate lots to the sales item's own item/grade, so the lot-picker only ever shows lots that could actually satisfy this line. */
export async function findStockLotById(tx: TenantTx, companyId: string, id: string): Promise<StockLotRow | undefined> {
  const [row] = await tx
    .select()
    .from(stockLots)
    .where(and(eq(stockLots.id, id), eq(stockLots.companyId, companyId), isNull(stockLots.deletedAt)))
    .limit(1);
  return row;
}

export async function listAvailableStockLotsForItem(
  tx: TenantTx,
  companyId: string,
  itemId: string,
  gradeId: string | null,
): Promise<StockLotRow[]> {
  const conditions = [eq(stockLots.companyId, companyId), eq(stockLots.itemId, itemId), isNull(stockLots.deletedAt)];
  if (gradeId) {
    conditions.push(eq(stockLots.gradeId, gradeId));
  } else {
    conditions.push(isNull(stockLots.gradeId));
  }
  return tx.select().from(stockLots).where(and(...conditions));
}
