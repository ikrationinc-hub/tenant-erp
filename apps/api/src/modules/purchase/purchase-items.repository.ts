import { and, asc, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "../../database/get-db.js";
import { purchaseItems, purchasePricing } from "../../database/tenant/schema.js";

export type PurchaseItemRow = typeof purchaseItems.$inferSelect;
export type PurchaseItemInsert = typeof purchaseItems.$inferInsert;
export type PurchasePricingRow = typeof purchasePricing.$inferSelect;
export type PurchasePricingInsert = typeof purchasePricing.$inferInsert;

export interface PurchaseItemWithPricing extends PurchaseItemRow {
  pricing: PurchasePricingRow;
}

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. */

export async function listItemsWithPricingForPurchase(
  tx: TenantTx,
  companyId: string,
  purchaseId: string,
): Promise<PurchaseItemWithPricing[]> {
  const rows = await tx
    .select({ item: purchaseItems, pricing: purchasePricing })
    .from(purchaseItems)
    .innerJoin(purchasePricing, eq(purchasePricing.purchaseItemId, purchaseItems.id))
    .where(and(eq(purchaseItems.purchaseId, purchaseId), eq(purchaseItems.companyId, companyId), isNull(purchaseItems.deletedAt)))
    .orderBy(asc(purchaseItems.createdAt));

  return rows.map(({ item, pricing }) => ({ ...item, pricing }));
}

export async function findItemById(
  tx: TenantTx,
  companyId: string,
  purchaseId: string,
  itemId: string,
): Promise<PurchaseItemRow | undefined> {
  const [row] = await tx
    .select()
    .from(purchaseItems)
    .where(
      and(
        eq(purchaseItems.id, itemId),
        eq(purchaseItems.purchaseId, purchaseId),
        eq(purchaseItems.companyId, companyId),
        isNull(purchaseItems.deletedAt),
      ),
    )
    .limit(1);
  return row;
}

export async function insertItem(tx: TenantTx, values: PurchaseItemInsert): Promise<PurchaseItemRow> {
  const [row] = await tx.insert(purchaseItems).values(values).returning();
  if (!row) {
    throw new Error("failed to insert purchase item");
  }
  return row;
}

export async function updateItem(
  tx: TenantTx,
  companyId: string,
  itemId: string,
  values: Record<string, unknown>,
): Promise<PurchaseItemRow | undefined> {
  const [row] = await tx
    .update(purchaseItems)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(purchaseItems.id, itemId), eq(purchaseItems.companyId, companyId), isNull(purchaseItems.deletedAt)))
    .returning();
  return row;
}

export async function findPricingByItemId(
  tx: TenantTx,
  companyId: string,
  purchaseItemId: string,
): Promise<PurchasePricingRow | undefined> {
  const [row] = await tx
    .select()
    .from(purchasePricing)
    .where(and(eq(purchasePricing.purchaseItemId, purchaseItemId), eq(purchasePricing.companyId, companyId), isNull(purchasePricing.deletedAt)))
    .limit(1);
  return row;
}

export async function insertPricing(tx: TenantTx, values: PurchasePricingInsert): Promise<PurchasePricingRow> {
  const [row] = await tx.insert(purchasePricing).values(values).returning();
  if (!row) {
    throw new Error("failed to insert purchase pricing");
  }
  return row;
}

export async function updatePricing(
  tx: TenantTx,
  companyId: string,
  purchaseItemId: string,
  values: Record<string, unknown>,
): Promise<PurchasePricingRow | undefined> {
  const [row] = await tx
    .update(purchasePricing)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(purchasePricing.purchaseItemId, purchaseItemId), eq(purchasePricing.companyId, companyId), isNull(purchasePricing.deletedAt)))
    .returning();
  return row;
}
