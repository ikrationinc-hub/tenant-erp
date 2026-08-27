import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { PaginatedRows } from "../../core/masters/types.js";
import type { TenantTx } from "../../database/get-db.js";
import { purchaseItems, purchases, stockMovements } from "../../database/tenant/schema.js";

export type StockMovementRow = typeof stockMovements.$inferSelect;
export type StockMovementInsert = typeof stockMovements.$inferInsert;

/** A movement's own columns plus its resolved source purchase, when its reference_type is "purchase_item" - so a client can link straight back to the purchase that created it without a second round trip. Both are null for any other/future reference_type. */
export interface StockMovementWithSourceRow extends StockMovementRow {
  sourcePurchaseId: string | null;
  sourcePurchaseNumber: string | null;
}

export interface StockBalanceRow {
  itemId: string;
  gradeId: string | null;
  warehouseId: string;
  uomId: string;
  quantity: string;
}

export interface BalancesListParams {
  page: number;
  pageSize: number;
  itemId?: string | undefined;
  warehouseId?: string | undefined;
  branchId?: string | undefined;
}

export interface MovementsListParams {
  page: number;
  pageSize: number;
  itemId?: string | undefined;
  warehouseId?: string | undefined;
  branchId?: string | undefined;
  gradeId?: string | undefined;
  movementType?: string | undefined;
  referenceType?: string | undefined;
  referenceId?: string | undefined;
  movementDateFrom?: string | undefined;
  movementDateTo?: string | undefined;
}

/** Only the repository layer touches SQL (rule 5) - service/subscriber never import `db`. No update/delete: append-only ledger (schema.ts's doc comment) - a correction is a new, offsetting row, never an edit. */

export async function insertStockMovement(tx: TenantTx, values: StockMovementInsert): Promise<StockMovementRow> {
  const [row] = await tx.insert(stockMovements).values(values).returning();
  if (!row) {
    throw new Error("failed to insert stock movement");
  }
  return row;
}

export async function listStockMovementsByReference(
  tx: TenantTx,
  companyId: string,
  referenceType: string,
  referenceId: string,
): Promise<StockMovementRow[]> {
  return tx
    .select()
    .from(stockMovements)
    .where(and(eq(stockMovements.companyId, companyId), eq(stockMovements.referenceType, referenceType), eq(stockMovements.referenceId, referenceId)));
}

function balanceFilterConditions(companyId: string, params: Pick<BalancesListParams, "itemId" | "warehouseId" | "branchId">) {
  const conditions = [eq(stockMovements.companyId, companyId)];
  if (params.itemId) {
    conditions.push(eq(stockMovements.itemId, params.itemId));
  }
  if (params.warehouseId) {
    conditions.push(eq(stockMovements.warehouseId, params.warehouseId));
  }
  if (params.branchId) {
    conditions.push(eq(stockMovements.branchId, params.branchId));
  }
  return conditions;
}

/**
 * Current quantity per (item, grade, warehouse) - DERIVED by summing
 * movements, never a stored column (CLAUDE.md §6.7's whole point). A
 * plain GROUP BY + SUM, not a materialized view - fine at prototype
 * volume; only reach for one if a seeded ~100k-movement test shows this
 * is too slow.
 */
export async function getStockBalances(
  tx: TenantTx,
  companyId: string,
  params: BalancesListParams,
): Promise<PaginatedRows<StockBalanceRow>> {
  const where = and(...balanceFilterConditions(companyId, params));
  const offset = (params.page - 1) * params.pageSize;

  const grouped = tx
    .select({
      itemId: stockMovements.itemId,
      gradeId: stockMovements.gradeId,
      warehouseId: stockMovements.warehouseId,
      uomId: stockMovements.uomId,
    })
    .from(stockMovements)
    .where(where)
    .groupBy(stockMovements.itemId, stockMovements.gradeId, stockMovements.warehouseId, stockMovements.uomId)
    .as("grouped");

  const [rows, totalRows] = await Promise.all([
    tx
      .select({
        itemId: stockMovements.itemId,
        gradeId: stockMovements.gradeId,
        warehouseId: stockMovements.warehouseId,
        uomId: stockMovements.uomId,
        quantity: sql<string>`sum(${stockMovements.quantity})`.as("quantity"),
      })
      .from(stockMovements)
      .where(where)
      .groupBy(stockMovements.itemId, stockMovements.gradeId, stockMovements.warehouseId, stockMovements.uomId)
      .orderBy(asc(stockMovements.itemId), asc(stockMovements.warehouseId))
      .limit(params.pageSize)
      .offset(offset),
    tx.select({ value: sql<number>`count(*)::int` }).from(grouped),
  ]);

  return { items: rows, total: totalRows[0]?.value ?? 0, page: params.page, pageSize: params.pageSize };
}

export async function listStockMovements(
  tx: TenantTx,
  companyId: string,
  params: MovementsListParams,
): Promise<PaginatedRows<StockMovementWithSourceRow>> {
  const conditions = balanceFilterConditions(companyId, params);
  if (params.gradeId) {
    conditions.push(eq(stockMovements.gradeId, params.gradeId));
  }
  if (params.movementType) {
    conditions.push(eq(stockMovements.movementType, params.movementType as StockMovementRow["movementType"]));
  }
  if (params.referenceType) {
    conditions.push(eq(stockMovements.referenceType, params.referenceType));
  }
  if (params.referenceId) {
    conditions.push(eq(stockMovements.referenceId, params.referenceId));
  }
  if (params.movementDateFrom) {
    conditions.push(gte(stockMovements.movementDate, params.movementDateFrom));
  }
  if (params.movementDateTo) {
    conditions.push(lte(stockMovements.movementDate, params.movementDateTo));
  }

  const where = and(...conditions);
  const offset = (params.page - 1) * params.pageSize;

  // LEFT JOINed, not required: a movement whose reference_type isn't
  // "purchase_item" (every future movement type - sale_out, adjustment,
  // transfer) simply gets null source columns, never excluded.
  const sourceJoinCondition = and(
    eq(purchaseItems.id, stockMovements.referenceId),
    eq(stockMovements.referenceType, "purchase_item"),
  );

  const [rows, totalRows] = await Promise.all([
    tx
      .select({
        id: stockMovements.id,
        companyId: stockMovements.companyId,
        branchId: stockMovements.branchId,
        itemId: stockMovements.itemId,
        gradeId: stockMovements.gradeId,
        warehouseId: stockMovements.warehouseId,
        quantity: stockMovements.quantity,
        uomId: stockMovements.uomId,
        movementType: stockMovements.movementType,
        movementDate: stockMovements.movementDate,
        referenceType: stockMovements.referenceType,
        referenceId: stockMovements.referenceId,
        purchaseInvoiceId: stockMovements.purchaseInvoiceId,
        receiptId: stockMovements.receiptId,
        reversalOfMovementId: stockMovements.reversalOfMovementId,
        createdAt: stockMovements.createdAt,
        updatedAt: stockMovements.updatedAt,
        createdBy: stockMovements.createdBy,
        updatedBy: stockMovements.updatedBy,
        deletedAt: stockMovements.deletedAt,
        version: stockMovements.version,
        sourcePurchaseId: purchases.id,
        sourcePurchaseNumber: purchases.purchaseNumber,
      })
      .from(stockMovements)
      .leftJoin(purchaseItems, sourceJoinCondition)
      .leftJoin(purchases, eq(purchases.id, purchaseItems.purchaseId))
      .where(where)
      .orderBy(desc(stockMovements.movementDate), desc(stockMovements.createdAt))
      .limit(params.pageSize)
      .offset(offset),
    tx.select({ value: sql<number>`count(*)::int` }).from(stockMovements).where(where),
  ]);

  return {
    items: rows.map((row) => ({ ...row, sourcePurchaseId: row.sourcePurchaseId ?? null, sourcePurchaseNumber: row.sourcePurchaseNumber ?? null })),
    total: totalRows[0]?.value ?? 0,
    page: params.page,
    pageSize: params.pageSize,
  };
}
