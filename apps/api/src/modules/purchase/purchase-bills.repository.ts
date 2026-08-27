import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { PaginatedRows } from "../../core/masters/types.js";
import type { TenantTx } from "../../database/get-db.js";
import { purchaseBillItems, purchaseBills, purchaseItems, purchases } from "../../database/tenant/schema.js";

export type PurchaseBillRow = typeof purchaseBills.$inferSelect;
export type PurchaseBillInsert = typeof purchaseBills.$inferInsert;
export type PurchaseBillItemRow = typeof purchaseBillItems.$inferSelect;
export type PurchaseBillItemInsert = typeof purchaseBillItems.$inferInsert;

/** PL-4: one row of the cross-purchase Purchase Bills list (Zoho's "Bills" nav item) - the bill's own columns plus its parent PO's number, same reasoning as purchase-receipts.repository.ts's PurchaseReceiptWithPurchaseNumber. */
export interface PurchaseBillWithPurchaseNumber extends PurchaseBillRow {
  purchaseNumber: string;
}

export interface BillsListParams {
  page: number;
  pageSize: number;
  status?: PurchaseBillRow["status"] | undefined;
  billDateFrom?: string | undefined;
  billDateTo?: string | undefined;
}

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. */

/** PL-4: cross-purchase, paginated + filtered server-side (rule 10) - the "Purchase Bills" standalone list screen's own endpoint, mirroring listAllReceipts. */
export async function listAllBills(tx: TenantTx, companyId: string, params: BillsListParams): Promise<PaginatedRows<PurchaseBillWithPurchaseNumber>> {
  const conditions = [eq(purchaseBills.companyId, companyId), isNull(purchaseBills.deletedAt)];
  if (params.status) {
    conditions.push(eq(purchaseBills.status, params.status));
  }
  if (params.billDateFrom) {
    conditions.push(gte(purchaseBills.billDate, params.billDateFrom));
  }
  if (params.billDateTo) {
    conditions.push(lte(purchaseBills.billDate, params.billDateTo));
  }

  const where = and(...conditions);
  const offset = (params.page - 1) * params.pageSize;

  const [rows, totalRows] = await Promise.all([
    tx
      .select({
        id: purchaseBills.id,
        companyId: purchaseBills.companyId,
        branchId: purchaseBills.branchId,
        purchaseId: purchaseBills.purchaseId,
        billNumber: purchaseBills.billNumber,
        supplierInvoiceNo: purchaseBills.supplierInvoiceNo,
        billDate: purchaseBills.billDate,
        dueDate: purchaseBills.dueDate,
        status: purchaseBills.status,
        billAmountUsd: purchaseBills.billAmountUsd,
        taxAmount: purchaseBills.taxAmount,
        approvedBy: purchaseBills.approvedBy,
        approvedAt: purchaseBills.approvedAt,
        createdAt: purchaseBills.createdAt,
        updatedAt: purchaseBills.updatedAt,
        createdBy: purchaseBills.createdBy,
        updatedBy: purchaseBills.updatedBy,
        deletedAt: purchaseBills.deletedAt,
        version: purchaseBills.version,
        purchaseNumber: purchases.purchaseNumber,
      })
      .from(purchaseBills)
      .innerJoin(purchases, eq(purchases.id, purchaseBills.purchaseId))
      .where(where)
      .orderBy(desc(purchaseBills.createdAt))
      .limit(params.pageSize)
      .offset(offset),
    tx.select({ value: sql<number>`count(*)::int` }).from(purchaseBills).where(where),
  ]);

  return { items: rows, total: totalRows[0]?.value ?? 0, page: params.page, pageSize: params.pageSize };
}

export async function listBillsForPurchase(tx: TenantTx, companyId: string, purchaseId: string): Promise<PurchaseBillRow[]> {
  return tx
    .select()
    .from(purchaseBills)
    .where(and(eq(purchaseBills.purchaseId, purchaseId), eq(purchaseBills.companyId, companyId), isNull(purchaseBills.deletedAt)))
    .orderBy(asc(purchaseBills.createdAt));
}

/** PL-5: the batched, list-screen version of listBillsForPurchase above - ONE query for every purchase on the current page, needed for computePaidStatus (which needs each purchase's own bills' ids/amounts, not just a per-item quantity sum like received/billed). */
export async function listBillsForPurchases(tx: TenantTx, companyId: string, purchaseIds: string[]): Promise<PurchaseBillRow[]> {
  if (purchaseIds.length === 0) {
    return [];
  }
  return tx
    .select()
    .from(purchaseBills)
    .where(and(inArray(purchaseBills.purchaseId, purchaseIds), eq(purchaseBills.companyId, companyId), isNull(purchaseBills.deletedAt)));
}

/** PL-3's cancel guard (purchase.service.ts): a PO with any bill against it (draft or approved - a bill existing at all is a financial fact already in motion) can no longer be cancelled, mirroring purchase-receipts.repository.ts's hasAnyReceiptForPurchase. */
export async function hasAnyBillForPurchase(tx: TenantTx, companyId: string, purchaseId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: purchaseBills.id })
    .from(purchaseBills)
    .where(and(eq(purchaseBills.purchaseId, purchaseId), eq(purchaseBills.companyId, companyId), isNull(purchaseBills.deletedAt)))
    .limit(1);
  return row !== undefined;
}

export async function findBillById(tx: TenantTx, companyId: string, purchaseId: string, id: string): Promise<PurchaseBillRow | undefined> {
  const [row] = await tx
    .select()
    .from(purchaseBills)
    .where(and(eq(purchaseBills.id, id), eq(purchaseBills.purchaseId, purchaseId), eq(purchaseBills.companyId, companyId), isNull(purchaseBills.deletedAt)))
    .limit(1);
  return row;
}

/** PL-5: Payment doesn't know a bill's parent purchase upfront (it picks bills by SUPPLIER, potentially across several purchases) - unlike findBillById above, which the existing per-purchase Bill endpoints always call with a known purchaseId already in the URL. */
export async function findBillByIdOnly(tx: TenantTx, companyId: string, id: string): Promise<PurchaseBillRow | undefined> {
  const [row] = await tx
    .select()
    .from(purchaseBills)
    .where(and(eq(purchaseBills.id, id), eq(purchaseBills.companyId, companyId), isNull(purchaseBills.deletedAt)))
    .limit(1);
  return row;
}

export async function insertBill(tx: TenantTx, values: PurchaseBillInsert): Promise<PurchaseBillRow> {
  const [row] = await tx.insert(purchaseBills).values(values).returning();
  if (!row) {
    throw new Error("failed to insert purchase bill");
  }
  return row;
}

export async function updateBillFields(
  tx: TenantTx,
  companyId: string,
  id: string,
  values: Partial<PurchaseBillInsert>,
): Promise<PurchaseBillRow | undefined> {
  const [row] = await tx
    .update(purchaseBills)
    .set(values)
    .where(and(eq(purchaseBills.id, id), eq(purchaseBills.companyId, companyId), isNull(purchaseBills.deletedAt)))
    .returning();
  return row;
}

/** CAS transition, same shape as purchase.repository.ts's transitionPurchaseStatus - a concurrent double-approve loses the race cleanly (zero rows matched). */
export async function transitionBillStatus(
  tx: TenantTx,
  companyId: string,
  id: string,
  input: { from: PurchaseBillRow["status"]; to: PurchaseBillRow["status"]; extra?: Record<string, unknown> },
): Promise<PurchaseBillRow | undefined> {
  const [row] = await tx
    .update(purchaseBills)
    .set({ status: input.to, ...(input.extra ?? {}), updatedAt: new Date() })
    .where(and(eq(purchaseBills.id, id), eq(purchaseBills.companyId, companyId), eq(purchaseBills.status, input.from), isNull(purchaseBills.deletedAt)))
    .returning();
  return row;
}

export async function listItemsForBill(tx: TenantTx, companyId: string, billId: string): Promise<PurchaseBillItemRow[]> {
  return tx
    .select()
    .from(purchaseBillItems)
    .where(and(eq(purchaseBillItems.billId, billId), eq(purchaseBillItems.companyId, companyId)))
    .orderBy(asc(purchaseBillItems.createdAt));
}

export async function insertBillItem(tx: TenantTx, values: PurchaseBillItemInsert): Promise<PurchaseBillItemRow> {
  const [row] = await tx.insert(purchaseBillItems).values(values).returning();
  if (!row) {
    throw new Error("failed to insert purchase bill item");
  }
  return row;
}

export interface BilledQuantityRow {
  purchaseItemId: string;
  billedQuantity: string;
}

export interface BilledQuantityRowForPurchase extends BilledQuantityRow {
  purchaseId: string;
}

/** PL-4: the batched, list-screen version of sumBilledQuantitiesByItem below - ONE query for every purchase on the current page, mirroring purchase-receipts.repository.ts's sumConfirmedReceivedQuantitiesByItemForPurchases exactly (including the "draft and approved both count" rule, unchanged from the per-purchase version). */
export async function sumBilledQuantitiesByItemForPurchases(
  tx: TenantTx,
  companyId: string,
  purchaseIds: string[],
): Promise<BilledQuantityRowForPurchase[]> {
  if (purchaseIds.length === 0) {
    return [];
  }
  const rows = await tx
    .select({
      purchaseId: purchaseBills.purchaseId,
      purchaseItemId: purchaseBillItems.purchaseItemId,
      billedQuantity: sql<string>`sum(${purchaseBillItems.billedQuantity})`.as("billed_quantity"),
    })
    .from(purchaseBillItems)
    .innerJoin(purchaseBills, eq(purchaseBills.id, purchaseBillItems.billId))
    .innerJoin(purchaseItems, eq(purchaseItems.id, purchaseBillItems.purchaseItemId))
    .where(and(inArray(purchaseBills.purchaseId, purchaseIds), eq(purchaseBills.companyId, companyId), isNull(purchaseBills.deletedAt), isNull(purchaseItems.deletedAt)))
    .groupBy(purchaseBills.purchaseId, purchaseBillItems.purchaseItemId);
  return rows;
}

/**
 * SUM(billed_quantity) per purchase_item, across every bill for the given
 * purchase (draft AND approved both count - unlike receipts, a bill has
 * no physical/financial-fact distinction to gate on; billing itself is
 * the financial fact, regardless of approval status). Mirrors
 * purchase-receipts.repository.ts's sumConfirmedReceivedQuantitiesByItem
 * exactly, substituting bill items for receipt items - the over-billing
 * guard (purchase-bills.service.ts) and the PO's derived billed_status
 * both read this rather than trusting any single bill in isolation.
 */
export async function sumBilledQuantitiesByItem(tx: TenantTx, companyId: string, purchaseId: string): Promise<BilledQuantityRow[]> {
  const rows = await tx
    .select({
      purchaseItemId: purchaseBillItems.purchaseItemId,
      billedQuantity: sql<string>`sum(${purchaseBillItems.billedQuantity})`.as("billed_quantity"),
    })
    .from(purchaseBillItems)
    .innerJoin(purchaseBills, eq(purchaseBills.id, purchaseBillItems.billId))
    .innerJoin(purchaseItems, eq(purchaseItems.id, purchaseBillItems.purchaseItemId))
    .where(
      and(
        eq(purchaseBills.purchaseId, purchaseId),
        eq(purchaseBills.companyId, companyId),
        isNull(purchaseBills.deletedAt),
        isNull(purchaseItems.deletedAt),
      ),
    )
    .groupBy(purchaseBillItems.purchaseItemId);
  return rows;
}
