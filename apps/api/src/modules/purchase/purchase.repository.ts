import { and, asc, eq, gte, ilike, isNull, lte, or, sql } from "drizzle-orm";
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
  status?: "draft" | "approved" | "posted" | undefined;
  supplierId?: string | undefined;
  branchId?: string | undefined;
  /** Inclusive range on purchase_date - both ends optional independently. */
  purchaseDateFrom?: string | undefined;
  purchaseDateTo?: string | undefined;
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
  if (params.purchaseDateFrom) {
    conditions.push(gte(purchases.purchaseDate, params.purchaseDateFrom));
  }
  if (params.purchaseDateTo) {
    conditions.push(lte(purchases.purchaseDate, params.purchaseDateTo));
  }
  if (params.search) {
    const term = `%${params.search}%`;
    const searchCondition = or(ilike(purchases.purchaseNumber, term), ilike(purchases.supplierInvoiceNo, term));
    if (searchCondition) {
      conditions.push(searchCondition);
    }
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

/** Exact-match lookup by supplierInvoiceNo - not part of any real FR, but a stable natural key scripts/seed-dev.ts uses to stay idempotent (purchase_number itself is only known after creation, since it's numbering-engine-generated). */
export async function findPurchaseBySupplierInvoiceNo(
  tx: TenantTx,
  companyId: string,
  supplierInvoiceNo: string,
): Promise<PurchaseRow | undefined> {
  const [row] = await tx
    .select()
    .from(purchases)
    .where(and(eq(purchases.supplierInvoiceNo, supplierInvoiceNo), eq(purchases.companyId, companyId), isNull(purchases.deletedAt)))
    .limit(1);
  return row;
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
