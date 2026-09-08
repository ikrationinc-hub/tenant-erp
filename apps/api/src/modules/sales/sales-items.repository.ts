import { and, asc, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "../../database/get-db.js";
import { salesItems, salesPricing } from "../../database/tenant/schema.js";

export type SalesItemRow = typeof salesItems.$inferSelect;
export type SalesItemInsert = typeof salesItems.$inferInsert;
export type SalesPricingRow = typeof salesPricing.$inferSelect;
export type SalesPricingInsert = typeof salesPricing.$inferInsert;

export interface SalesItemWithPricing extends SalesItemRow {
  pricing: SalesPricingRow;
}

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. Mirrors purchase-items.repository.ts. */

export async function listItemsWithPricingForSales(tx: TenantTx, companyId: string, salesId: string): Promise<SalesItemWithPricing[]> {
  const rows = await tx
    .select({ item: salesItems, pricing: salesPricing })
    .from(salesItems)
    .innerJoin(salesPricing, eq(salesPricing.salesItemId, salesItems.id))
    .where(and(eq(salesItems.salesId, salesId), eq(salesItems.companyId, companyId), isNull(salesItems.deletedAt)))
    .orderBy(asc(salesItems.createdAt));

  return rows.map(({ item, pricing }) => ({ ...item, pricing }));
}

export async function findItemById(tx: TenantTx, companyId: string, salesId: string, itemId: string): Promise<SalesItemRow | undefined> {
  const [row] = await tx
    .select()
    .from(salesItems)
    .where(
      and(eq(salesItems.id, itemId), eq(salesItems.salesId, salesId), eq(salesItems.companyId, companyId), isNull(salesItems.deletedAt)),
    )
    .limit(1);
  return row;
}

export async function insertItem(tx: TenantTx, values: SalesItemInsert): Promise<SalesItemRow> {
  const [row] = await tx.insert(salesItems).values(values).returning();
  if (!row) {
    throw new Error("failed to insert sales item");
  }
  return row;
}

export async function updateItem(
  tx: TenantTx,
  companyId: string,
  itemId: string,
  values: Record<string, unknown>,
): Promise<SalesItemRow | undefined> {
  const [row] = await tx
    .update(salesItems)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(salesItems.id, itemId), eq(salesItems.companyId, companyId), isNull(salesItems.deletedAt)))
    .returning();
  return row;
}

export async function findPricingByItemId(tx: TenantTx, companyId: string, salesItemId: string): Promise<SalesPricingRow | undefined> {
  const [row] = await tx
    .select()
    .from(salesPricing)
    .where(and(eq(salesPricing.salesItemId, salesItemId), eq(salesPricing.companyId, companyId), isNull(salesPricing.deletedAt)))
    .limit(1);
  return row;
}

export async function insertPricing(tx: TenantTx, values: SalesPricingInsert): Promise<SalesPricingRow> {
  const [row] = await tx.insert(salesPricing).values(values).returning();
  if (!row) {
    throw new Error("failed to insert sales pricing");
  }
  return row;
}

export async function updatePricing(
  tx: TenantTx,
  companyId: string,
  salesItemId: string,
  values: Record<string, unknown>,
): Promise<SalesPricingRow | undefined> {
  const [row] = await tx
    .update(salesPricing)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(salesPricing.salesItemId, salesItemId), eq(salesPricing.companyId, companyId), isNull(salesPricing.deletedAt)))
    .returning();
  return row;
}
