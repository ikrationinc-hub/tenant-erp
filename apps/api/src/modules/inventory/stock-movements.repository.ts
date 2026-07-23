import { and, eq } from "drizzle-orm";
import type { TenantTx } from "../../database/get-db.js";
import { stockMovements } from "../../database/tenant/schema.js";

export type StockMovementRow = typeof stockMovements.$inferSelect;
export type StockMovementInsert = typeof stockMovements.$inferInsert;

/** Only the repository layer touches SQL (rule 5) - service/subscriber never import `db`. No update/delete: append-only ledger (schema.ts's doc comment) - a correction is a new, offsetting row, never an edit. */

export async function insertStockMovement(tx: TenantTx, values: StockMovementInsert): Promise<StockMovementRow> {
  const [row] = await tx.insert(stockMovements).values(values).returning();
  if (!row) {
    throw new Error("failed to insert stock movement");
  }
  return row;
}

export async function listStockMovementsByReference(
  tx: TenantTx,
  companyId: string,
  referenceType: string,
  referenceId: string,
): Promise<StockMovementRow[]> {
  return tx
    .select()
    .from(stockMovements)
    .where(and(eq(stockMovements.companyId, companyId), eq(stockMovements.referenceType, referenceType), eq(stockMovements.referenceId, referenceId)));
}
