import { and, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "../../database/get-db.js";
import { salesAdditionalCosts } from "../../database/tenant/schema.js";

export type SalesAdditionalCostsRow = typeof salesAdditionalCosts.$inferSelect;
export type SalesAdditionalCostsInsert = typeof salesAdditionalCosts.$inferInsert;

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. Mirrors purchase-costs.repository.ts. */

export async function findCostsBySalesId(tx: TenantTx, companyId: string, salesId: string): Promise<SalesAdditionalCostsRow | undefined> {
  const [row] = await tx
    .select()
    .from(salesAdditionalCosts)
    .where(and(eq(salesAdditionalCosts.salesId, salesId), eq(salesAdditionalCosts.companyId, companyId), isNull(salesAdditionalCosts.deletedAt)))
    .limit(1);
  return row;
}

export async function insertCosts(tx: TenantTx, values: SalesAdditionalCostsInsert): Promise<SalesAdditionalCostsRow> {
  const [row] = await tx.insert(salesAdditionalCosts).values(values).returning();
  if (!row) {
    throw new Error("failed to insert sales additional costs");
  }
  return row;
}

export async function updateCosts(
  tx: TenantTx,
  companyId: string,
  salesId: string,
  values: Record<string, unknown>,
): Promise<SalesAdditionalCostsRow | undefined> {
  const [row] = await tx
    .update(salesAdditionalCosts)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(salesAdditionalCosts.salesId, salesId), eq(salesAdditionalCosts.companyId, companyId), isNull(salesAdditionalCosts.deletedAt)))
    .returning();
  return row;
}
