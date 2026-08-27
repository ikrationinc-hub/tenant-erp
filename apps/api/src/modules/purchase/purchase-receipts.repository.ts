import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { PaginatedRows } from "../../core/masters/types.js";
import type { TenantTx } from "../../database/get-db.js";
import { purchaseItems, purchaseReceiptItems, purchaseReceipts, purchases } from "../../database/tenant/schema.js";

export type PurchaseReceiptRow = typeof purchaseReceipts.$inferSelect;
export type PurchaseReceiptInsert = typeof purchaseReceipts.$inferInsert;
export type PurchaseReceiptItemRow = typeof purchaseReceiptItems.$inferSelect;
export type PurchaseReceiptItemInsert = typeof purchaseReceiptItems.$inferInsert;

export interface PurchaseReceiptWithItems extends PurchaseReceiptRow {
  items: PurchaseReceiptItemRow[];
}

/** PL-4: one row of the cross-purchase Purchase Receipts list (Zoho's "Purchase Receives" nav item) - the receipt's own columns plus its parent PO's number, since a flat list spanning every purchase needs that for display/search without a second round trip per row. */
export interface PurchaseReceiptWithPurchaseNumber extends PurchaseReceiptRow {
  purchaseNumber: string;
}

export interface ReceiptsListParams {
  page: number;
  pageSize: number;
  status?: PurchaseReceiptRow["status"] | undefined;
  warehouseId?: string | undefined;
  receiptDateFrom?: string | undefined;
  receiptDateTo?: string | undefined;
}

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. */

/**
 * PL-4: cross-purchase, paginated + filtered server-side (rule 10) -
 * unlike listReceiptsForPurchase below, this is the "Purchase Receipts"
 * standalone list screen's own endpoint, spanning every purchase in the
 * company, not scoped to one. Joined back to `purchases` for
 * purchaseNumber (a flat list needs it for display/search; the dedicated
 * per-purchase list doesn't, since the parent's own number is already on
 * screen there).
 */
export async function listAllReceipts(tx: TenantTx, companyId: string, params: ReceiptsListParams): Promise<PaginatedRows<PurchaseReceiptWithPurchaseNumber>> {
  const conditions = [eq(purchaseReceipts.companyId, companyId), isNull(purchaseReceipts.deletedAt)];
  if (params.status) {
    conditions.push(eq(purchaseReceipts.status, params.status));
  }
  if (params.warehouseId) {
    conditions.push(eq(purchaseReceipts.warehouseId, params.warehouseId));
  }
  if (params.receiptDateFrom) {
    conditions.push(gte(purchaseReceipts.receiptDate, params.receiptDateFrom));
  }
  if (params.receiptDateTo) {
    conditions.push(lte(purchaseReceipts.receiptDate, params.receiptDateTo));
  }

  const where = and(...conditions);
  const offset = (params.page - 1) * params.pageSize;

  const [rows, totalRows] = await Promise.all([
    tx
      .select({
        id: purchaseReceipts.id,
        companyId: purchaseReceipts.companyId,
        branchId: purchaseReceipts.branchId,
        purchaseId: purchaseReceipts.purchaseId,
        receiptNumber: purchaseReceipts.receiptNumber,
        receiptDate: purchaseReceipts.receiptDate,
        warehouseId: purchaseReceipts.warehouseId,
        receivedBy: purchaseReceipts.receivedBy,
        status: purchaseReceipts.status,
        confirmedBy: purchaseReceipts.confirmedBy,
        confirmedAt: purchaseReceipts.confirmedAt,
        createdAt: purchaseReceipts.createdAt,
        updatedAt: purchaseReceipts.updatedAt,
        createdBy: purchaseReceipts.createdBy,
        updatedBy: purchaseReceipts.updatedBy,
        deletedAt: purchaseReceipts.deletedAt,
        version: purchaseReceipts.version,
        purchaseNumber: purchases.purchaseNumber,
      })
      .from(purchaseReceipts)
      .innerJoin(purchases, eq(purchases.id, purchaseReceipts.purchaseId))
      .where(where)
      .orderBy(desc(purchaseReceipts.createdAt))
      .limit(params.pageSize)
      .offset(offset),
    tx.select({ value: sql<number>`count(*)::int` }).from(purchaseReceipts).where(where),
  ]);

  return { items: rows, total: totalRows[0]?.value ?? 0, page: params.page, pageSize: params.pageSize };
}

export async function listReceiptsForPurchase(tx: TenantTx, companyId: string, purchaseId: string): Promise<PurchaseReceiptRow[]> {
  return tx
    .select()
    .from(purchaseReceipts)
    .where(and(eq(purchaseReceipts.purchaseId, purchaseId), eq(purchaseReceipts.companyId, companyId), isNull(purchaseReceipts.deletedAt)))
    .orderBy(asc(purchaseReceipts.createdAt));
}

/** purchase-items.service.ts's assertItemsEditable guard: once ANY receipt (draft or confirmed) exists against a purchase, its items lock - editing an ordered quantity after a receipt has already been recorded against it would silently invalidate the over-receipt invariant those receipts were checked against at their own create time. */
export async function hasAnyReceiptForPurchase(tx: TenantTx, companyId: string, purchaseId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: purchaseReceipts.id })
    .from(purchaseReceipts)
    .where(and(eq(purchaseReceipts.purchaseId, purchaseId), eq(purchaseReceipts.companyId, companyId), isNull(purchaseReceipts.deletedAt)))
    .limit(1);
  return row !== undefined;
}

export async function findReceiptById(tx: TenantTx, companyId: string, purchaseId: string, id: string): Promise<PurchaseReceiptRow | undefined> {
  const [row] = await tx
    .select()
    .from(purchaseReceipts)
    .where(
      and(
        eq(purchaseReceipts.id, id),
        eq(purchaseReceipts.purchaseId, purchaseId),
        eq(purchaseReceipts.companyId, companyId),
        isNull(purchaseReceipts.deletedAt),
      ),
    )
    .limit(1);
  return row;
}

export async function listItemsForReceipt(tx: TenantTx, companyId: string, receiptId: string): Promise<PurchaseReceiptItemRow[]> {
  return tx
    .select()
    .from(purchaseReceiptItems)
    .where(and(eq(purchaseReceiptItems.receiptId, receiptId), eq(purchaseReceiptItems.companyId, companyId)))
    .orderBy(asc(purchaseReceiptItems.createdAt));
}

export async function insertReceipt(tx: TenantTx, values: PurchaseReceiptInsert): Promise<PurchaseReceiptRow> {
  const [row] = await tx.insert(purchaseReceipts).values(values).returning();
  if (!row) {
    throw new Error("failed to insert purchase receipt");
  }
  return row;
}

export async function insertReceiptItem(tx: TenantTx, values: PurchaseReceiptItemInsert): Promise<PurchaseReceiptItemRow> {
  const [row] = await tx.insert(purchaseReceiptItems).values(values).returning();
  if (!row) {
    throw new Error("failed to insert purchase receipt item");
  }
  return row;
}

/**
 * CAS transition, same shape as purchase.repository.ts's
 * transitionPurchaseStatus - a concurrent double-confirm loses the race
 * cleanly (zero rows matched) rather than double-writing stock.
 */
export async function transitionReceiptStatus(
  tx: TenantTx,
  companyId: string,
  id: string,
  input: { from: PurchaseReceiptRow["status"]; to: PurchaseReceiptRow["status"]; extra?: Record<string, unknown> },
): Promise<PurchaseReceiptRow | undefined> {
  const [row] = await tx
    .update(purchaseReceipts)
    .set({ status: input.to, ...(input.extra ?? {}), updatedAt: new Date() })
    .where(
      and(
        eq(purchaseReceipts.id, id),
        eq(purchaseReceipts.companyId, companyId),
        eq(purchaseReceipts.status, input.from),
        isNull(purchaseReceipts.deletedAt),
      ),
    )
    .returning();
  return row;
}

export interface ReceivedQuantityRow {
  purchaseItemId: string;
  receivedQuantity: string;
}

export interface ReceivedQuantityRowForPurchase extends ReceivedQuantityRow {
  purchaseId: string;
}

/**
 * PL-4: the batched, list-screen version of sumConfirmedReceivedQuantitiesByItem
 * below - ONE query for every purchase on the current page, not one query
 * per row (an N+1 the PO list's Received/Billed columns would otherwise
 * cost). Same "only confirmed receipts count" filter; grouped by BOTH
 * purchaseId and purchaseItemId so purchase.service.ts's list() can split
 * the flat result back into one Map per purchase and run the exact same
 * computeReceivedStatus it already uses for getById.
 */
export async function sumConfirmedReceivedQuantitiesByItemForPurchases(
  tx: TenantTx,
  companyId: string,
  purchaseIds: string[],
): Promise<ReceivedQuantityRowForPurchase[]> {
  if (purchaseIds.length === 0) {
    return [];
  }
  const rows = await tx
    .select({
      purchaseId: purchaseReceipts.purchaseId,
      purchaseItemId: purchaseReceiptItems.purchaseItemId,
      receivedQuantity: sql<string>`sum(${purchaseReceiptItems.receivedQuantity})`.as("received_quantity"),
    })
    .from(purchaseReceiptItems)
    .innerJoin(purchaseReceipts, eq(purchaseReceipts.id, purchaseReceiptItems.receiptId))
    .innerJoin(purchaseItems, eq(purchaseItems.id, purchaseReceiptItems.purchaseItemId))
    .where(
      and(
        inArray(purchaseReceipts.purchaseId, purchaseIds),
        eq(purchaseReceipts.companyId, companyId),
        eq(purchaseReceipts.status, "confirmed"),
        isNull(purchaseReceipts.deletedAt),
        isNull(purchaseItems.deletedAt),
      ),
    )
    .groupBy(purchaseReceipts.purchaseId, purchaseReceiptItems.purchaseItemId);
  return rows;
}

/**
 * SUM(received_quantity) per purchase_item, across every CONFIRMED
 * receipt for the given purchase - the over-receipt guard
 * (purchase-receipts.service.ts) and the PO's derived received_status
 * both read this rather than trusting any single receipt in isolation.
 * A draft receipt's items don't count yet - only a confirmed receipt has
 * actually moved stock.
 */
export async function sumConfirmedReceivedQuantitiesByItem(tx: TenantTx, companyId: string, purchaseId: string): Promise<ReceivedQuantityRow[]> {
  const rows = await tx
    .select({
      purchaseItemId: purchaseReceiptItems.purchaseItemId,
      receivedQuantity: sql<string>`sum(${purchaseReceiptItems.receivedQuantity})`.as("received_quantity"),
    })
    .from(purchaseReceiptItems)
    .innerJoin(purchaseReceipts, eq(purchaseReceipts.id, purchaseReceiptItems.receiptId))
    .innerJoin(purchaseItems, eq(purchaseItems.id, purchaseReceiptItems.purchaseItemId))
    .where(
      and(
        eq(purchaseReceipts.purchaseId, purchaseId),
        eq(purchaseReceipts.companyId, companyId),
        eq(purchaseReceipts.status, "confirmed"),
        isNull(purchaseReceipts.deletedAt),
        isNull(purchaseItems.deletedAt),
      ),
    )
    .groupBy(purchaseReceiptItems.purchaseItemId);
  return rows;
}
