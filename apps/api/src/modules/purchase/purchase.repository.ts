import { and, asc, eq, gte, ilike, isNull, lte, sql, type SQL } from "drizzle-orm";
import type { PaginatedRows } from "../../core/masters/types.js";
import type { TenantTx } from "../../database/get-db.js";
import { purchaseShipments, purchases } from "../../database/tenant/schema.js";

export type PurchaseRow = typeof purchases.$inferSelect;
export type PurchaseInsert = typeof purchases.$inferInsert;
export type PurchaseShipmentRow = typeof purchaseShipments.$inferSelect;
export type PurchaseShipmentInsert = typeof purchaseShipments.$inferInsert;

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. */

export interface PurchasesListParams {
  page: number;
  pageSize: number;
  search?: string | undefined;
  status?: "draft" | "issued" | "closed" | "cancelled" | undefined;
  supplierId?: string | undefined;
  branchId?: string | undefined;
  divisionId?: string | undefined;
  receivedStatus?: "not_received" | "partial" | "fully_received" | undefined;
  billedStatus?: "not_billed" | "partial" | "fully_billed" | undefined;
  /** Inclusive range on purchase_date - both ends optional independently. */
  purchaseDateFrom?: string | undefined;
  purchaseDateTo?: string | undefined;
}

/**
 * PL-4: the received/billed FILTER, unlike the list's own DISPLAY columns
 * (purchase.service.ts's list() batches those per-page, post-fetch), has
 * to be a real SQL-level classification - filtering the whole matching
 * set correctly before pagination (rule 10), not just the current page.
 * Mirrors purchase-lifecycle.ts's computeReceivedStatus thresholds
 * exactly, just expressed as correlated EXISTS subqueries against
 * purchase_items instead of an in-memory loop over already-fetched rows:
 *   not_received:   no item on this purchase has any confirmed receipt qty yet
 *   fully_received: EVERY item's confirmed-received qty >= its ordered qty
 *   partial:        anything in between
 * Per-item received qty is its own correlated scalar subquery (SUM over
 * purchase_receipt_items joined to purchase_receipts, status='confirmed'),
 * matching sumConfirmedReceivedQuantitiesByItem's own filter exactly.
 */
function receivedStatusCondition(status: "not_received" | "partial" | "fully_received"): SQL {
  const receivedQtyForItem = sql`(
    select coalesce(sum(pri.received_quantity), 0)
    from purchase_receipt_items pri
    inner join purchase_receipts pr on pr.id = pri.receipt_id
    where pri.purchase_item_id = pi.id and pr.status = 'confirmed' and pr.deleted_at is null
  )`;
  const hasAnyItem = sql`exists (select 1 from purchase_items pi where pi.purchase_id = ${purchases.id} and pi.deleted_at is null)`;
  const anyReceived = sql`exists (select 1 from purchase_items pi where pi.purchase_id = ${purchases.id} and pi.deleted_at is null and ${receivedQtyForItem} > 0)`;
  const anyUnfulfilled = sql`exists (select 1 from purchase_items pi where pi.purchase_id = ${purchases.id} and pi.deleted_at is null and ${receivedQtyForItem} < pi.quantity)`;

  if (status === "not_received") {
    return sql`(not ${hasAnyItem} or not ${anyReceived})`;
  }
  if (status === "fully_received") {
    return sql`(${hasAnyItem} and not ${anyUnfulfilled})`;
  }
  return sql`(${hasAnyItem} and ${anyReceived} and ${anyUnfulfilled})`;
}

/** PL-4: the billed axis's own version of receivedStatusCondition - same shape, substituting purchase_bill_items/purchase_bills (every bill regardless of status counts, matching sumBilledQuantitiesByItem's own "draft AND approved both count" rule - billing itself is the financial fact, unlike receiving where only "confirmed" counts). */
function billedStatusCondition(status: "not_billed" | "partial" | "fully_billed"): SQL {
  const billedQtyForItem = sql`(
    select coalesce(sum(pbi.billed_quantity), 0)
    from purchase_bill_items pbi
    inner join purchase_bills pb on pb.id = pbi.bill_id
    where pbi.purchase_item_id = pi.id and pb.deleted_at is null
  )`;
  const hasAnyItem = sql`exists (select 1 from purchase_items pi where pi.purchase_id = ${purchases.id} and pi.deleted_at is null)`;
  const anyBilled = sql`exists (select 1 from purchase_items pi where pi.purchase_id = ${purchases.id} and pi.deleted_at is null and ${billedQtyForItem} > 0)`;
  const anyUnfulfilled = sql`exists (select 1 from purchase_items pi where pi.purchase_id = ${purchases.id} and pi.deleted_at is null and ${billedQtyForItem} < pi.quantity)`;

  if (status === "not_billed") {
    return sql`(not ${hasAnyItem} or not ${anyBilled})`;
  }
  if (status === "fully_billed") {
    return sql`(${hasAnyItem} and not ${anyUnfulfilled})`;
  }
  return sql`(${hasAnyItem} and ${anyBilled} and ${anyUnfulfilled})`;
}

export async function listPurchases(
  tx: TenantTx,
  companyId: string,
  params: PurchasesListParams,
): Promise<PaginatedRows<PurchaseRow>> {
  const conditions = [eq(purchases.companyId, companyId), isNull(purchases.deletedAt)];
  if (params.status) {
    conditions.push(eq(purchases.status, params.status));
  }
  if (params.supplierId) {
    conditions.push(eq(purchases.supplierId, params.supplierId));
  }
  if (params.branchId) {
    conditions.push(eq(purchases.branchId, params.branchId));
  }
  if (params.divisionId) {
    conditions.push(eq(purchases.divisionId, params.divisionId));
  }
  if (params.receivedStatus) {
    conditions.push(receivedStatusCondition(params.receivedStatus));
  }
  if (params.billedStatus) {
    conditions.push(billedStatusCondition(params.billedStatus));
  }
  if (params.purchaseDateFrom) {
    conditions.push(gte(purchases.purchaseDate, params.purchaseDateFrom));
  }
  if (params.purchaseDateTo) {
    conditions.push(lte(purchases.purchaseDate, params.purchaseDateTo));
  }
  if (params.search) {
    conditions.push(ilike(purchases.purchaseNumber, `%${params.search}%`));
  }

  const where = and(...conditions);
  const offset = (params.page - 1) * params.pageSize;

  const [rows, totalRows] = await Promise.all([
    tx.select().from(purchases).where(where).orderBy(asc(purchases.purchaseNumber)).limit(params.pageSize).offset(offset),
    tx.select({ value: sql<number>`count(*)::int` }).from(purchases).where(where),
  ]);

  return { items: rows, total: totalRows[0]?.value ?? 0, page: params.page, pageSize: params.pageSize };
}

export async function findPurchaseById(tx: TenantTx, companyId: string, id: string): Promise<PurchaseRow | undefined> {
  const [row] = await tx
    .select()
    .from(purchases)
    .where(and(eq(purchases.id, id), eq(purchases.companyId, companyId), isNull(purchases.deletedAt)))
    .limit(1);
  return row;
}

/** Exact-match lookup by its shipment's containerId - not part of any real FR, but a stable natural key scripts/seed-dev-core.ts uses to stay idempotent (purchase_number itself is only known after creation, since it's numbering-engine-generated). Was keyed off purchases.supplierInvoiceNo until that column was removed as a PO-level leftover from the pre-four-document-lifecycle model (the supplier's invoice number now belongs on the Bill, purchase_bills.supplierInvoiceNo) - the seed script's own container (created first, before the purchase, via its own idempotent ensureMaster-by-code lookup) is an equally stable 1:1 key. */
export async function findPurchaseByShipmentContainerId(
  tx: TenantTx,
  companyId: string,
  containerId: string,
): Promise<PurchaseRow | undefined> {
  const [row] = await tx
    .select({ purchase: purchases })
    .from(purchases)
    .innerJoin(purchaseShipments, eq(purchaseShipments.purchaseId, purchases.id))
    .where(
      and(
        eq(purchaseShipments.containerId, containerId),
        eq(purchases.companyId, companyId),
        isNull(purchases.deletedAt),
        isNull(purchaseShipments.deletedAt),
      ),
    )
    .limit(1);
  return row?.purchase;
}

export async function insertPurchase(tx: TenantTx, values: PurchaseInsert): Promise<PurchaseRow> {
  const [row] = await tx.insert(purchases).values(values).returning();
  if (!row) {
    throw new Error("failed to insert purchase");
  }
  return row;
}

export async function updatePurchase(
  tx: TenantTx,
  companyId: string,
  id: string,
  values: Record<string, unknown>,
): Promise<PurchaseRow | undefined> {
  const [row] = await tx
    .update(purchases)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(purchases.id, id), eq(purchases.companyId, companyId), isNull(purchases.deletedAt)))
    .returning();
  return row;
}

/**
 * The workflow engine's actual enforcement mechanism (core/workflow/
 * transitions.ts's doc comment): one conditional `UPDATE ... WHERE status
 * = $from`. Returns `undefined` if no row matched - either the purchase
 * doesn't exist, or (the case this exists for) its status had already
 * moved on by the time this ran, e.g. a concurrent approval that won the
 * race. The caller (purchase.service.ts) is responsible for telling those
 * two cases apart (it already has the row from a prior findPurchaseById).
 */
export async function transitionPurchaseStatus(
  tx: TenantTx,
  companyId: string,
  id: string,
  input: { from: PurchaseRow["status"]; to: PurchaseRow["status"]; extra?: Record<string, unknown> },
): Promise<PurchaseRow | undefined> {
  const [row] = await tx
    .update(purchases)
    .set({ status: input.to, ...(input.extra ?? {}), updatedAt: new Date() })
    .where(and(eq(purchases.id, id), eq(purchases.companyId, companyId), eq(purchases.status, input.from), isNull(purchases.deletedAt)))
    .returning();
  return row;
}

export async function findShipmentByPurchaseId(
  tx: TenantTx,
  companyId: string,
  purchaseId: string,
): Promise<PurchaseShipmentRow | undefined> {
  const [row] = await tx
    .select()
    .from(purchaseShipments)
    .where(and(eq(purchaseShipments.purchaseId, purchaseId), eq(purchaseShipments.companyId, companyId), isNull(purchaseShipments.deletedAt)))
    .limit(1);
  return row;
}

export async function insertPurchaseShipment(tx: TenantTx, values: PurchaseShipmentInsert): Promise<PurchaseShipmentRow> {
  const [row] = await tx.insert(purchaseShipments).values(values).returning();
  if (!row) {
    throw new Error("failed to insert purchase shipment");
  }
  return row;
}

export async function updatePurchaseShipment(
  tx: TenantTx,
  companyId: string,
  purchaseId: string,
  values: Record<string, unknown>,
): Promise<PurchaseShipmentRow | undefined> {
  const [row] = await tx
    .update(purchaseShipments)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(purchaseShipments.purchaseId, purchaseId), eq(purchaseShipments.companyId, companyId), isNull(purchaseShipments.deletedAt)))
    .returning();
  return row;
}
