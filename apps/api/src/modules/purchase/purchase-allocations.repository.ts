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

export async function findAllocationById(
  tx: TenantTx,
  companyId: string,
  purchaseId: string,
  id: string,
): Promise<PurchaseAllocationRow | undefined> {
  const [row] = await tx
    .select()
    .from(purchaseAllocations)
    .where(
      and(
        eq(purchaseAllocations.id, id),
        eq(purchaseAllocations.purchaseId, purchaseId),
        eq(purchaseAllocations.companyId, companyId),
        isNull(purchaseAllocations.deletedAt),
      ),
    )
    .limit(1);
  return row;
}

export async function insertAllocation(tx: TenantTx, values: PurchaseAllocationInsert): Promise<PurchaseAllocationRow> {
  const [row] = await tx.insert(purchaseAllocations).values(values).returning();
  if (!row) {
    throw new Error("failed to insert purchase allocation");
  }
  return row;
}

export async function updateAllocation(
  tx: TenantTx,
  companyId: string,
  id: string,
  values: Partial<PurchaseAllocationInsert>,
): Promise<PurchaseAllocationRow | undefined> {
  const [row] = await tx
    .update(purchaseAllocations)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(purchaseAllocations.id, id), eq(purchaseAllocations.companyId, companyId), isNull(purchaseAllocations.deletedAt)))
    .returning();
  return row;
}

export async function softDeleteAllocation(tx: TenantTx, companyId: string, id: string, deletedBy: string): Promise<PurchaseAllocationRow | undefined> {
  const [row] = await tx
    .update(purchaseAllocations)
    .set({ deletedAt: new Date(), updatedBy: deletedBy, updatedAt: new Date() })
    .where(and(eq(purchaseAllocations.id, id), eq(purchaseAllocations.companyId, companyId), isNull(purchaseAllocations.deletedAt)))
    .returning();
  return row;
}
