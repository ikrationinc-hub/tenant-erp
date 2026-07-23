import { and, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "../../database/get-db.js";
import { purchaseAdditionalCosts } from "../../database/tenant/schema.js";

export type PurchaseAdditionalCostsRow = typeof purchaseAdditionalCosts.$inferSelect;
export type PurchaseAdditionalCostsInsert = typeof purchaseAdditionalCosts.$inferInsert;

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. */

export async function findCostsByPurchaseId(
  tx: TenantTx,
  companyId: string,
  purchaseId: string,
): Promise<PurchaseAdditionalCostsRow | undefined> {
  const [row] = await tx
    .select()
    .from(purchaseAdditionalCosts)
    .where(and(eq(purchaseAdditionalCosts.purchaseId, purchaseId), eq(purchaseAdditionalCosts.companyId, companyId), isNull(purchaseAdditionalCosts.deletedAt)))
    .limit(1);
  return row;
}

export async function insertCosts(tx: TenantTx, values: PurchaseAdditionalCostsInsert): Promise<PurchaseAdditionalCostsRow> {
  const [row] = await tx.insert(purchaseAdditionalCosts).values(values).returning();
  if (!row) {
    throw new Error("failed to insert purchase additional costs");
  }
  return row;
}

export async function updateCosts(
  tx: TenantTx,
  companyId: string,
  purchaseId: string,
  values: Record<string, unknown>,
): Promise<PurchaseAdditionalCostsRow | undefined> {
  const [row] = await tx
    .update(purchaseAdditionalCosts)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(purchaseAdditionalCosts.purchaseId, purchaseId), eq(purchaseAdditionalCosts.companyId, companyId), isNull(purchaseAdditionalCosts.deletedAt)))
    .returning();
  return row;
}
