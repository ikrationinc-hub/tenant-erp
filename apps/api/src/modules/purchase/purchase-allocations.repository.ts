import { and, asc, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "../../database/get-db.js";
import { purchaseAllocations } from "../../database/tenant/schema.js";

export type PurchaseAllocationRow = typeof purchaseAllocations.$inferSelect;
export type PurchaseAllocationInsert = typeof purchaseAllocations.$inferInsert;

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. */

export async function listAllocationsForPurchase(
  tx: TenantTx,
  companyId: string,
  purchaseId: string,
): Promise<PurchaseAllocationRow[]> {
  return tx
    .select()
    .from(purchaseAllocations)
    .where(and(eq(purchaseAllocations.purchaseId, purchaseId), eq(purchaseAllocations.companyId, companyId), isNull(purchaseAllocations.deletedAt)))
    .orderBy(asc(purchaseAllocations.createdAt));
}

export async function insertAllocation(tx: TenantTx, values: PurchaseAllocationInsert): Promise<PurchaseAllocationRow> {
  const [row] = await tx.insert(purchaseAllocations).values(values).returning();
  if (!row) {
    throw new Error("failed to insert purchase allocation");
  }
  return row;
}
