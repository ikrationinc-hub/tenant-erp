import { and, asc, eq, gte, ilike, isNull, lte, ne, sql } from "drizzle-orm";
import type { PaginatedRows } from "../../core/masters/types.js";
import type { TenantTx } from "../../database/get-db.js";
import { salesItems, salesPricing, salesShipments, sales } from "../../database/tenant/schema.js";

export type SalesRow = typeof sales.$inferSelect;
export type SalesInsert = typeof sales.$inferInsert;
export type SalesShipmentRow = typeof salesShipments.$inferSelect;
export type SalesShipmentInsert = typeof salesShipments.$inferInsert;

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. Mirrors purchase.repository.ts. */

export interface SalesListParams {
  page: number;
  pageSize: number;
  search?: string | undefined;
  status?: "draft" | "approved" | "closed" | "cancelled" | undefined;
  customerId?: string | undefined;
  branchId?: string | undefined;
  divisionId?: string | undefined;
  salesDateFrom?: string | undefined;
  salesDateTo?: string | undefined;
}

export async function listSales(tx: TenantTx, companyId: string, params: SalesListParams): Promise<PaginatedRows<SalesRow>> {
  const conditions = [eq(sales.companyId, companyId), isNull(sales.deletedAt)];
  if (params.status) {
    conditions.push(eq(sales.status, params.status));
  }
  if (params.customerId) {
    conditions.push(eq(sales.customerId, params.customerId));
  }
  if (params.branchId) {
    conditions.push(eq(sales.branchId, params.branchId));
  }
  if (params.divisionId) {
    conditions.push(eq(sales.divisionId, params.divisionId));
  }
  if (params.salesDateFrom) {
    conditions.push(gte(sales.salesDate, params.salesDateFrom));
  }
  if (params.salesDateTo) {
    conditions.push(lte(sales.salesDate, params.salesDateTo));
  }
  if (params.search) {
    conditions.push(ilike(sales.salesNumber, `%${params.search}%`));
  }

  const where = and(...conditions);
  const offset = (params.page - 1) * params.pageSize;

  const [rows, totalRows] = await Promise.all([
    tx.select().from(sales).where(where).orderBy(asc(sales.salesNumber)).limit(params.pageSize).offset(offset),
    tx.select({ value: sql<number>`count(*)::int` }).from(sales).where(where),
  ]);

  return { items: rows, total: totalRows[0]?.value ?? 0, page: params.page, pageSize: params.pageSize };
}

export async function findSalesById(tx: TenantTx, companyId: string, id: string): Promise<SalesRow | undefined> {
  const [row] = await tx
    .select()
    .from(sales)
    .where(and(eq(sales.id, id), eq(sales.companyId, companyId), isNull(sales.deletedAt)))
    .limit(1);
  return row;
}

export async function insertSales(tx: TenantTx, values: SalesInsert): Promise<SalesRow> {
  const [row] = await tx.insert(sales).values(values).returning();
  if (!row) {
    throw new Error("failed to insert sales order");
  }
  return row;
}

export async function updateSales(
  tx: TenantTx,
  companyId: string,
  id: string,
  values: Record<string, unknown>,
): Promise<SalesRow | undefined> {
  const [row] = await tx
    .update(sales)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(sales.id, id), eq(sales.companyId, companyId), isNull(sales.deletedAt)))
    .returning();
  return row;
}

/**
 * The workflow engine's actual enforcement mechanism, identical contract to
 * purchase.repository.ts's transitionPurchaseStatus - one conditional
 * `UPDATE ... WHERE status = $from`. Returns `undefined` if no row matched
 * (already moved on, or doesn't exist) - the caller tells those apart.
 */
export async function transitionSalesStatus(
  tx: TenantTx,
  companyId: string,
  id: string,
  input: { from: SalesRow["status"]; to: SalesRow["status"]; extra?: Record<string, unknown> },
): Promise<SalesRow | undefined> {
  const [row] = await tx
    .update(sales)
    .set({ status: input.to, ...(input.extra ?? {}), updatedAt: new Date() })
    .where(and(eq(sales.id, id), eq(sales.companyId, companyId), eq(sales.status, input.from), isNull(sales.deletedAt)))
    .returning();
  return row;
}

/** Sum of salesAmountUsd across the customer's OTHER currently-approved sales - the "open order exposure" credit-limit proxy (see sales.service.ts's computeCreditExposure). Excludes `excludeSalesId` so re-approving (impossible today, but defensive) or checking-before-insert never double-counts the sale itself. */
export async function sumApprovedSalesValueForCustomer(
  tx: TenantTx,
  companyId: string,
  customerId: string,
  excludeSalesId: string | undefined,
): Promise<string> {
  const conditions = [eq(sales.companyId, companyId), eq(sales.customerId, customerId), eq(sales.status, "approved"), isNull(sales.deletedAt)];
  if (excludeSalesId) {
    conditions.push(ne(sales.id, excludeSalesId));
  }

  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${salesPricing.salesAmountUsd}), 0)` })
    .from(sales)
    .leftJoin(salesItems, and(eq(salesItems.salesId, sales.id), isNull(salesItems.deletedAt)))
    .leftJoin(salesPricing, and(eq(salesPricing.salesItemId, salesItems.id), isNull(salesPricing.deletedAt)))
    .where(and(...conditions));
  return row?.total ?? "0";
}

export async function findShipmentBySalesId(tx: TenantTx, companyId: string, salesId: string): Promise<SalesShipmentRow | undefined> {
  const [row] = await tx
    .select()
    .from(salesShipments)
    .where(and(eq(salesShipments.salesId, salesId), eq(salesShipments.companyId, companyId), isNull(salesShipments.deletedAt)))
    .limit(1);
  return row;
}

export async function insertSalesShipment(tx: TenantTx, values: SalesShipmentInsert): Promise<SalesShipmentRow> {
  const [row] = await tx.insert(salesShipments).values(values).returning();
  if (!row) {
    throw new Error("failed to insert sales shipment");
  }
  return row;
}

export async function updateSalesShipment(
  tx: TenantTx,
  companyId: string,
  salesId: string,
  values: Record<string, unknown>,
): Promise<SalesShipmentRow | undefined> {
  const [row] = await tx
    .update(salesShipments)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(salesShipments.salesId, salesId), eq(salesShipments.companyId, companyId), isNull(salesShipments.deletedAt)))
    .returning();
  return row;
}
