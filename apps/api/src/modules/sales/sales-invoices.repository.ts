import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { PaginatedRows } from "../../core/masters/types.js";
import type { TenantTx } from "../../database/get-db.js";
import { salesInvoiceItems, salesInvoices, salesItems, sales } from "../../database/tenant/schema.js";

export type SalesInvoiceRow = typeof salesInvoices.$inferSelect;
export type SalesInvoiceInsert = typeof salesInvoices.$inferInsert;
export type SalesInvoiceItemRow = typeof salesInvoiceItems.$inferSelect;
export type SalesInvoiceItemInsert = typeof salesInvoiceItems.$inferInsert;

/** The cross-sale Sales Invoices list's own row shape - mirrors purchase-bills.repository.ts's PurchaseBillWithPurchaseNumber. */
export interface SalesInvoiceWithSalesNumber extends SalesInvoiceRow {
  salesNumber: string;
}

export interface InvoicesListParams {
  page: number;
  pageSize: number;
  status?: SalesInvoiceRow["status"] | undefined;
  invoiceDateFrom?: string | undefined;
  invoiceDateTo?: string | undefined;
}

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. Mirrors purchase-bills.repository.ts. */

export async function listAllInvoices(tx: TenantTx, companyId: string, params: InvoicesListParams): Promise<PaginatedRows<SalesInvoiceWithSalesNumber>> {
  const conditions = [eq(salesInvoices.companyId, companyId), isNull(salesInvoices.deletedAt)];
  if (params.status) {
    conditions.push(eq(salesInvoices.status, params.status));
  }
  if (params.invoiceDateFrom) {
    conditions.push(gte(salesInvoices.invoiceDate, params.invoiceDateFrom));
  }
  if (params.invoiceDateTo) {
    conditions.push(lte(salesInvoices.invoiceDate, params.invoiceDateTo));
  }

  const where = and(...conditions);
  const offset = (params.page - 1) * params.pageSize;

  const [rows, totalRows] = await Promise.all([
    tx
      .select({
        id: salesInvoices.id,
        companyId: salesInvoices.companyId,
        branchId: salesInvoices.branchId,
        salesId: salesInvoices.salesId,
        invoiceNumber: salesInvoices.invoiceNumber,
        customerReferenceNo: salesInvoices.customerReferenceNo,
        invoiceDate: salesInvoices.invoiceDate,
        dueDate: salesInvoices.dueDate,
        status: salesInvoices.status,
        invoiceAmountUsd: salesInvoices.invoiceAmountUsd,
        taxAmount: salesInvoices.taxAmount,
        approvedBy: salesInvoices.approvedBy,
        approvedAt: salesInvoices.approvedAt,
        createdAt: salesInvoices.createdAt,
        updatedAt: salesInvoices.updatedAt,
        createdBy: salesInvoices.createdBy,
        updatedBy: salesInvoices.updatedBy,
        deletedAt: salesInvoices.deletedAt,
        version: salesInvoices.version,
        salesNumber: sales.salesNumber,
      })
      .from(salesInvoices)
      .innerJoin(sales, eq(sales.id, salesInvoices.salesId))
      .where(where)
      .orderBy(desc(salesInvoices.createdAt))
      .limit(params.pageSize)
      .offset(offset),
    tx.select({ value: sql<number>`count(*)::int` }).from(salesInvoices).where(where),
  ]);

  return { items: rows, total: totalRows[0]?.value ?? 0, page: params.page, pageSize: params.pageSize };
}

export async function listInvoicesForSales(tx: TenantTx, companyId: string, salesId: string): Promise<SalesInvoiceRow[]> {
  return tx
    .select()
    .from(salesInvoices)
    .where(and(eq(salesInvoices.salesId, salesId), eq(salesInvoices.companyId, companyId), isNull(salesInvoices.deletedAt)))
    .orderBy(asc(salesInvoices.createdAt));
}

/** sales.service.ts's cancel guard: a sale with any invoice against it (draft or approved - an invoice existing at all is a financial fact already in motion) can no longer be cancelled, mirroring purchase-bills.repository.ts's hasAnyBillForPurchase. */
export async function hasAnyInvoiceForSales(tx: TenantTx, companyId: string, salesId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: salesInvoices.id })
    .from(salesInvoices)
    .where(and(eq(salesInvoices.salesId, salesId), eq(salesInvoices.companyId, companyId), isNull(salesInvoices.deletedAt)))
    .limit(1);
  return row !== undefined;
}

/** Batched, list-screen version of listInvoicesForSales above - one query for every sale on the current page, needed for computePaidStatus (which needs each sale's own invoices' ids/amounts, not just a per-item quantity sum). Mirrors purchase-bills.repository.ts's listBillsForPurchases. */
export async function listInvoicesForSalesOrders(tx: TenantTx, companyId: string, salesIds: string[]): Promise<SalesInvoiceRow[]> {
  if (salesIds.length === 0) {
    return [];
  }
  return tx
    .select()
    .from(salesInvoices)
    .where(and(inArray(salesInvoices.salesId, salesIds), eq(salesInvoices.companyId, companyId), isNull(salesInvoices.deletedAt)));
}

export async function findInvoiceById(tx: TenantTx, companyId: string, salesId: string, id: string): Promise<SalesInvoiceRow | undefined> {
  const [row] = await tx
    .select()
    .from(salesInvoices)
    .where(and(eq(salesInvoices.id, id), eq(salesInvoices.salesId, salesId), eq(salesInvoices.companyId, companyId), isNull(salesInvoices.deletedAt)))
    .limit(1);
  return row;
}

/** Payment doesn't know an invoice's parent sale upfront (it picks invoices by CUSTOMER, potentially across several sales) - unlike findInvoiceById above. Mirrors purchase-payments.repository.ts's findBillByIdOnly. */
export async function findInvoiceByIdOnly(tx: TenantTx, companyId: string, id: string): Promise<SalesInvoiceRow | undefined> {
  const [row] = await tx
    .select()
    .from(salesInvoices)
    .where(and(eq(salesInvoices.id, id), eq(salesInvoices.companyId, companyId), isNull(salesInvoices.deletedAt)))
    .limit(1);
  return row;
}

export async function insertInvoice(tx: TenantTx, values: SalesInvoiceInsert): Promise<SalesInvoiceRow> {
  const [row] = await tx.insert(salesInvoices).values(values).returning();
  if (!row) {
    throw new Error("failed to insert sales invoice");
  }
  return row;
}

export async function updateInvoiceFields(
  tx: TenantTx,
  companyId: string,
  id: string,
  values: Partial<SalesInvoiceInsert>,
): Promise<SalesInvoiceRow | undefined> {
  const [row] = await tx
    .update(salesInvoices)
    .set(values)
    .where(and(eq(salesInvoices.id, id), eq(salesInvoices.companyId, companyId), isNull(salesInvoices.deletedAt)))
    .returning();
  return row;
}

/** CAS transition, same shape as sales.repository.ts's transitionSalesStatus - a concurrent double-approve (or double-auto-pay) loses the race cleanly (zero rows matched). */
export async function transitionInvoiceStatus(
  tx: TenantTx,
  companyId: string,
  id: string,
  input: { from: SalesInvoiceRow["status"]; to: SalesInvoiceRow["status"]; extra?: Record<string, unknown> },
): Promise<SalesInvoiceRow | undefined> {
  const [row] = await tx
    .update(salesInvoices)
    .set({ status: input.to, ...(input.extra ?? {}), updatedAt: new Date() })
    .where(and(eq(salesInvoices.id, id), eq(salesInvoices.companyId, companyId), eq(salesInvoices.status, input.from), isNull(salesInvoices.deletedAt)))
    .returning();
  return row;
}

export async function listItemsForInvoice(tx: TenantTx, companyId: string, invoiceId: string): Promise<SalesInvoiceItemRow[]> {
  return tx
    .select()
    .from(salesInvoiceItems)
    .where(and(eq(salesInvoiceItems.invoiceId, invoiceId), eq(salesInvoiceItems.companyId, companyId)))
    .orderBy(asc(salesInvoiceItems.createdAt));
}

export async function insertInvoiceItem(tx: TenantTx, values: SalesInvoiceItemInsert): Promise<SalesInvoiceItemRow> {
  const [row] = await tx.insert(salesInvoiceItems).values(values).returning();
  if (!row) {
    throw new Error("failed to insert sales invoice item");
  }
  return row;
}

export interface InvoicedQuantityRow {
  salesItemId: string;
  invoicedQuantity: string;
}

export interface InvoicedQuantityRowForSales extends InvoicedQuantityRow {
  salesId: string;
}

/** Batched, list-screen version of sumInvoicedQuantitiesByItem below - one query for every sale on the current page, mirrors purchase-bills.repository.ts's sumBilledQuantitiesByItemForPurchases exactly (including the "draft and approved both count" rule). */
export async function sumInvoicedQuantitiesByItemForSalesOrders(
  tx: TenantTx,
  companyId: string,
  salesIds: string[],
): Promise<InvoicedQuantityRowForSales[]> {
  if (salesIds.length === 0) {
    return [];
  }
  const rows = await tx
    .select({
      salesId: salesInvoices.salesId,
      salesItemId: salesInvoiceItems.salesItemId,
      invoicedQuantity: sql<string>`sum(${salesInvoiceItems.invoicedQuantity})`.as("invoiced_quantity"),
    })
    .from(salesInvoiceItems)
    .innerJoin(salesInvoices, eq(salesInvoices.id, salesInvoiceItems.invoiceId))
    .innerJoin(salesItems, eq(salesItems.id, salesInvoiceItems.salesItemId))
    .where(and(inArray(salesInvoices.salesId, salesIds), eq(salesInvoices.companyId, companyId), isNull(salesInvoices.deletedAt), isNull(salesItems.deletedAt)))
    .groupBy(salesInvoices.salesId, salesInvoiceItems.salesItemId);
  return rows;
}

/**
 * SUM(invoiced_quantity) per sales_item, across every invoice for the
 * given sale (draft AND approved both count - unlike delivery, an invoice
 * has no physical/financial-fact distinction to gate on; invoicing itself
 * is the financial fact, regardless of approval status). Mirrors purchase-
 * bills.repository.ts's sumBilledQuantitiesByItem exactly - the over-
 * invoicing guard (sales-invoices.service.ts) and the sale's derived
 * invoicedStatus both read this rather than trusting any single invoice
 * in isolation.
 */
export async function sumInvoicedQuantitiesByItem(tx: TenantTx, companyId: string, salesId: string): Promise<InvoicedQuantityRow[]> {
  const rows = await tx
    .select({
      salesItemId: salesInvoiceItems.salesItemId,
      invoicedQuantity: sql<string>`sum(${salesInvoiceItems.invoicedQuantity})`.as("invoiced_quantity"),
    })
    .from(salesInvoiceItems)
    .innerJoin(salesInvoices, eq(salesInvoices.id, salesInvoiceItems.invoiceId))
    .innerJoin(salesItems, eq(salesItems.id, salesInvoiceItems.salesItemId))
    .where(and(eq(salesInvoices.salesId, salesId), eq(salesInvoices.companyId, companyId), isNull(salesInvoices.deletedAt), isNull(salesItems.deletedAt)))
    .groupBy(salesInvoiceItems.salesItemId);
  return rows;
}
