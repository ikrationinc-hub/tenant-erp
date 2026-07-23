import { and, asc, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "../../database/get-db.js";
import { hedges } from "../../database/tenant/schema.js";

export type HedgeRow = typeof hedges.$inferSelect;
export type HedgeInsert = typeof hedges.$inferInsert;

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. */

export async function listHedgesForPurchase(tx: TenantTx, companyId: string, purchaseId: string): Promise<HedgeRow[]> {
  return tx
    .select()
    .from(hedges)
    .where(and(eq(hedges.purchaseId, purchaseId), eq(hedges.companyId, companyId), isNull(hedges.deletedAt)))
    .orderBy(asc(hedges.createdAt));
}

export async function findHedgeById(tx: TenantTx, companyId: string, purchaseId: string, hedgeId: string): Promise<HedgeRow | undefined> {
  const [row] = await tx
    .select()
    .from(hedges)
    .where(and(eq(hedges.id, hedgeId), eq(hedges.purchaseId, purchaseId), eq(hedges.companyId, companyId), isNull(hedges.deletedAt)))
    .limit(1);
  return row;
}

export async function insertHedge(tx: TenantTx, values: HedgeInsert): Promise<HedgeRow> {
  const [row] = await tx.insert(hedges).values(values).returning();
  if (!row) {
    throw new Error("failed to insert hedge");
  }
  return row;
}

/** The only mutation this table gets - `status` only (contract terms are immutable once entered). */
export async function updateHedgeStatus(
  tx: TenantTx,
  companyId: string,
  hedgeId: string,
  values: { status: "open" | "closed"; updatedBy: string },
): Promise<HedgeRow | undefined> {
  const [row] = await tx
    .update(hedges)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(hedges.id, hedgeId), eq(hedges.companyId, companyId), isNull(hedges.deletedAt)))
    .returning();
  return row;
}
