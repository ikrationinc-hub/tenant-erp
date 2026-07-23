import { and, eq } from "drizzle-orm";
import type { TenantTx } from "../../database/get-db.js";
import { marketPrices } from "../../database/tenant/schema.js";

export type MarketPriceRow = typeof marketPrices.$inferSelect;
export type MarketPriceInsert = typeof marketPrices.$inferInsert;

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. No update/delete: market_prices is an immutable, append-only ledger (this directory's doc comment on schema.ts's market_prices table). */

export async function insertMarketPrice(tx: TenantTx, values: MarketPriceInsert): Promise<MarketPriceRow> {
  const [row] = await tx.insert(marketPrices).values(values).returning();
  if (!row) {
    throw new Error("failed to insert market price");
  }
  return row;
}

export async function findMarketPriceById(tx: TenantTx, companyId: string, id: string): Promise<MarketPriceRow | undefined> {
  const [row] = await tx
    .select()
    .from(marketPrices)
    .where(and(eq(marketPrices.id, id), eq(marketPrices.companyId, companyId)))
    .limit(1);
  return row;
}
