import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { PaginatedRows } from "../../core/masters/types.js";
import type { TenantTx } from "../../database/get-db.js";
import { paymentsReceived, salesInvoices, salesPaymentAllocations, sales } from "../../database/tenant/schema.js";

export type PaymentReceivedRow = typeof paymentsReceived.$inferSelect;
export type PaymentReceivedInsert = typeof paymentsReceived.$inferInsert;
export type SalesPaymentAllocationRow = typeof salesPaymentAllocations.$inferSelect;
export type SalesPaymentAllocationInsert = typeof salesPaymentAllocations.$inferInsert;

export interface PaymentReceivedWithAllocations extends PaymentReceivedRow {
  allocations: SalesPaymentAllocationRow[];
}

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. Mirrors purchase-payments.repository.ts. */

export interface PaymentsReceivedListParams {
  page: number;
  pageSize: number;
  customerId?: string | undefined;
  paymentDateFrom?: string | undefined;
  paymentDateTo?: string | undefined;
}

/** The "Payments Received" list screen's own endpoint - cross-customer, paginated + filtered server-side (rule 10), mirroring listAllPayments. */
export async function listAllPaymentsReceived(
  tx: TenantTx,
  companyId: string,
  params: PaymentsReceivedListParams,
): Promise<PaginatedRows<PaymentReceivedRow>> {
  const conditions = [eq(paymentsReceived.companyId, companyId), isNull(paymentsReceived.deletedAt)];
  if (params.customerId) {
    conditions.push(eq(paymentsReceived.customerId, params.customerId));
  }
  if (params.paymentDateFrom) {
    conditions.push(gte(paymentsReceived.paymentDate, params.paymentDateFrom));
  }
  if (params.paymentDateTo) {
    conditions.push(lte(paymentsReceived.paymentDate, params.paymentDateTo));
  }

  const where = and(...conditions);
  const offset = (params.page - 1) * params.pageSize;

  const [rows, totalRows] = await Promise.all([
    tx.select().from(paymentsReceived).where(where).orderBy(desc(paymentsReceived.createdAt)).limit(params.pageSize).offset(offset),
    tx.select({ value: sql<number>`count(*)::int` }).from(paymentsReceived).where(where),
  ]);

  return { items: rows, total: totalRows[0]?.value ?? 0, page: params.page, pageSize: params.pageSize };
}

export async function findPaymentReceivedById(tx: TenantTx, companyId: string, id: string): Promise<PaymentReceivedRow | undefined> {
  const [row] = await tx
    .select()
    .from(paymentsReceived)
    .where(and(eq(paymentsReceived.id, id), eq(paymentsReceived.companyId, companyId), isNull(paymentsReceived.deletedAt)))
    .limit(1);
  return row;
}

export async function listAllocationsForPaymentReceived(tx: TenantTx, companyId: string, paymentId: string): Promise<SalesPaymentAllocationRow[]> {
  return tx
    .select()
    .from(salesPaymentAllocations)
    .where(and(eq(salesPaymentAllocations.paymentId, paymentId), eq(salesPaymentAllocations.companyId, companyId), isNull(salesPaymentAllocations.deletedAt)));
}

export async function insertPaymentReceived(tx: TenantTx, values: PaymentReceivedInsert): Promise<PaymentReceivedRow> {
  const [row] = await tx.insert(paymentsReceived).values(values).returning();
  if (!row) {
    throw new Error("failed to insert payment received");
  }
  return row;
}

export async function insertSalesPaymentAllocation(tx: TenantTx, values: SalesPaymentAllocationInsert): Promise<SalesPaymentAllocationRow> {
  const [row] = await tx.insert(salesPaymentAllocations).values(values).returning();
  if (!row) {
    throw new Error("failed to insert sales payment allocation");
  }
  return row;
}

export interface PaidAmountRow {
  invoiceId: string;
  paidAmountUsd: string;
}

/**
 * SUM(applied_amount_usd) per invoice, across every payment allocation
 * ever recorded against it - sales-payments-received.service.ts's over-
 * payment guard (never allocate more than an invoice's own outstanding
 * balance) and the invoice's own derived "paid" transition both read this.
 * Mirrors purchase-payments.repository.ts's sumPaidAmountsByBill exactly.
 */
export async function sumPaidAmountsByInvoice(tx: TenantTx, companyId: string, invoiceIds: string[]): Promise<PaidAmountRow[]> {
  if (invoiceIds.length === 0) {
    return [];
  }
  const rows = await tx
    .select({
      invoiceId: salesPaymentAllocations.invoiceId,
      paidAmountUsd: sql<string>`sum(${salesPaymentAllocations.appliedAmountUsd})`.as("paid_amount_usd"),
    })
    .from(salesPaymentAllocations)
    .where(and(inArray(salesPaymentAllocations.invoiceId, invoiceIds), eq(salesPaymentAllocations.companyId, companyId), isNull(salesPaymentAllocations.deletedAt)))
    .groupBy(salesPaymentAllocations.invoiceId);
  return rows;
}

export interface PaidAmountRowForSales extends PaidAmountRow {
  salesId: string;
}

/** Batched, list-screen version of sumPaidAmountsByInvoice above - one query for every sale on the current page, mirrors sumPaidAmountsByBillForPurchases exactly (joining through sales_invoices to attach each row's own salesId). */
export async function sumPaidAmountsByInvoiceForSalesOrders(tx: TenantTx, companyId: string, salesIds: string[]): Promise<PaidAmountRowForSales[]> {
  if (salesIds.length === 0) {
    return [];
  }
  const rows = await tx
    .select({
      salesId: salesInvoices.salesId,
      invoiceId: salesPaymentAllocations.invoiceId,
      paidAmountUsd: sql<string>`sum(${salesPaymentAllocations.appliedAmountUsd})`.as("paid_amount_usd"),
    })
    .from(salesPaymentAllocations)
    .innerJoin(salesInvoices, eq(salesInvoices.id, salesPaymentAllocations.invoiceId))
    .where(and(inArray(salesInvoices.salesId, salesIds), eq(salesPaymentAllocations.companyId, companyId), isNull(salesPaymentAllocations.deletedAt), isNull(salesInvoices.deletedAt)))
    .groupBy(salesInvoices.salesId, salesPaymentAllocations.invoiceId);
  return rows;
}

export interface OutstandingInvoiceRow {
  id: string;
  salesId: string;
  salesNumber: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  invoiceAmountUsd: string;
  paidAmountUsd: string;
}

/**
 * Every APPROVED invoice for a given customer that isn't already fully
 * paid - the Payment Received form's own invoice picker (and the create
 * guard) both need this. Mirrors purchase-payments.repository.ts's
 * listOutstandingBillsForSupplier exactly, substituting customer/invoice
 * for supplier/bill.
 */
export async function listOutstandingInvoicesForCustomer(tx: TenantTx, companyId: string, customerId: string): Promise<OutstandingInvoiceRow[]> {
  const rows = await tx
    .select({
      id: salesInvoices.id,
      salesId: salesInvoices.salesId,
      salesNumber: sales.salesNumber,
      invoiceNumber: salesInvoices.invoiceNumber,
      invoiceDate: salesInvoices.invoiceDate,
      dueDate: salesInvoices.dueDate,
      invoiceAmountUsd: salesInvoices.invoiceAmountUsd,
      paidAmountUsd: sql<string>`coalesce(sum(${salesPaymentAllocations.appliedAmountUsd}), 0)`.as("paid_amount_usd"),
    })
    .from(salesInvoices)
    .innerJoin(sales, eq(sales.id, salesInvoices.salesId))
    .leftJoin(salesPaymentAllocations, and(eq(salesPaymentAllocations.invoiceId, salesInvoices.id), isNull(salesPaymentAllocations.deletedAt)))
    .where(and(eq(sales.customerId, customerId), eq(salesInvoices.companyId, companyId), eq(salesInvoices.status, "approved"), isNull(salesInvoices.deletedAt)))
    .groupBy(salesInvoices.id, sales.salesNumber)
    .having(sql`${salesInvoices.invoiceAmountUsd} > coalesce(sum(${salesPaymentAllocations.appliedAmountUsd}), 0)`);
  return rows;
}

export interface OutstandingBalanceRow {
  invoiceAmountUsd: string;
  paidAmountUsd: string;
}

/**
 * The customer's total outstanding receivables balance across EVERY
 * approved, not-fully-paid invoice, regardless of which sale it came from
 * - sales.service.ts's approve() reads this for the credit-exposure
 * warning (docs/adr/0028's own resolved decision: real outstanding
 * receivables, not "other open sales orders' value"). Same left-join/
 * having shape as listOutstandingInvoicesForCustomer, minus the per-row
 * detail this caller doesn't need.
 */
export async function sumOutstandingReceivablesForCustomer(tx: TenantTx, companyId: string, customerId: string): Promise<OutstandingBalanceRow[]> {
  const rows = await tx
    .select({
      invoiceAmountUsd: salesInvoices.invoiceAmountUsd,
      paidAmountUsd: sql<string>`coalesce(sum(${salesPaymentAllocations.appliedAmountUsd}), 0)`.as("paid_amount_usd"),
    })
    .from(salesInvoices)
    .innerJoin(sales, eq(sales.id, salesInvoices.salesId))
    .leftJoin(salesPaymentAllocations, and(eq(salesPaymentAllocations.invoiceId, salesInvoices.id), isNull(salesPaymentAllocations.deletedAt)))
    .where(and(eq(sales.customerId, customerId), eq(salesInvoices.companyId, companyId), eq(salesInvoices.status, "approved"), isNull(salesInvoices.deletedAt)))
    .groupBy(salesInvoices.id)
    .having(sql`${salesInvoices.invoiceAmountUsd} > coalesce(sum(${salesPaymentAllocations.appliedAmountUsd}), 0)`);
  return rows;
}
