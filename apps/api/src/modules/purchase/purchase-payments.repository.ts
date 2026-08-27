import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { PaginatedRows } from "../../core/masters/types.js";
import type { TenantTx } from "../../database/get-db.js";
import { paymentAllocations, payments, purchaseBills, purchases } from "../../database/tenant/schema.js";

export type PaymentRow = typeof payments.$inferSelect;
export type PaymentInsert = typeof payments.$inferInsert;
export type PaymentAllocationRow = typeof paymentAllocations.$inferSelect;
export type PaymentAllocationInsert = typeof paymentAllocations.$inferInsert;

export interface PaymentWithAllocations extends PaymentRow {
  allocations: PaymentAllocationRow[];
}

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. */

export interface PaymentsListParams {
  page: number;
  pageSize: number;
  supplierId?: string | undefined;
  paymentDateFrom?: string | undefined;
  paymentDateTo?: string | undefined;
}

/** PL-5: the "Payments Made" list screen's own endpoint - cross-supplier, paginated + filtered server-side (rule 10), mirroring listAllReceipts/listAllBills. */
export async function listAllPayments(tx: TenantTx, companyId: string, params: PaymentsListParams): Promise<PaginatedRows<PaymentRow>> {
  const conditions = [eq(payments.companyId, companyId), isNull(payments.deletedAt)];
  if (params.supplierId) {
    conditions.push(eq(payments.supplierId, params.supplierId));
  }
  if (params.paymentDateFrom) {
    conditions.push(gte(payments.paymentDate, params.paymentDateFrom));
  }
  if (params.paymentDateTo) {
    conditions.push(lte(payments.paymentDate, params.paymentDateTo));
  }

  const where = and(...conditions);
  const offset = (params.page - 1) * params.pageSize;

  const [rows, totalRows] = await Promise.all([
    tx.select().from(payments).where(where).orderBy(desc(payments.createdAt)).limit(params.pageSize).offset(offset),
    tx.select({ value: sql<number>`count(*)::int` }).from(payments).where(where),
  ]);

  return { items: rows, total: totalRows[0]?.value ?? 0, page: params.page, pageSize: params.pageSize };
}

export async function findPaymentById(tx: TenantTx, companyId: string, id: string): Promise<PaymentRow | undefined> {
  const [row] = await tx
    .select()
    .from(payments)
    .where(and(eq(payments.id, id), eq(payments.companyId, companyId), isNull(payments.deletedAt)))
    .limit(1);
  return row;
}

export async function listAllocationsForPayment(tx: TenantTx, companyId: string, paymentId: string): Promise<PaymentAllocationRow[]> {
  return tx
    .select()
    .from(paymentAllocations)
    .where(and(eq(paymentAllocations.paymentId, paymentId), eq(paymentAllocations.companyId, companyId), isNull(paymentAllocations.deletedAt)));
}

export async function insertPayment(tx: TenantTx, values: PaymentInsert): Promise<PaymentRow> {
  const [row] = await tx.insert(payments).values(values).returning();
  if (!row) {
    throw new Error("failed to insert payment");
  }
  return row;
}

export async function insertPaymentAllocation(tx: TenantTx, values: PaymentAllocationInsert): Promise<PaymentAllocationRow> {
  const [row] = await tx.insert(paymentAllocations).values(values).returning();
  if (!row) {
    throw new Error("failed to insert payment allocation");
  }
  return row;
}

export interface PaidAmountRow {
  billId: string;
  paidAmountUsd: string;
}

/**
 * SUM(applied_amount_usd) per bill, across every payment allocation ever
 * recorded against it - purchase-payments.service.ts's over-payment guard
 * (never allocate more than a bill's own outstanding balance) and the
 * bill's own derived "paid" transition both read this, same "compute on
 * read from a sum, never store the running total" discipline PL-1/PL-2
 * already established for received/billed quantities. Deleted allocations
 * (none exist yet - no reversal flow - but isNull guards it regardless,
 * matching every other sum-query's own convention) never count.
 */
export async function sumPaidAmountsByBill(tx: TenantTx, companyId: string, billIds: string[]): Promise<PaidAmountRow[]> {
  if (billIds.length === 0) {
    return [];
  }
  const rows = await tx
    .select({
      billId: paymentAllocations.billId,
      paidAmountUsd: sql<string>`sum(${paymentAllocations.appliedAmountUsd})`.as("paid_amount_usd"),
    })
    .from(paymentAllocations)
    .where(and(inArray(paymentAllocations.billId, billIds), eq(paymentAllocations.companyId, companyId), isNull(paymentAllocations.deletedAt)))
    .groupBy(paymentAllocations.billId);
  return rows;
}

export interface PaidAmountRowForPurchase extends PaidAmountRow {
  purchaseId: string;
}

/**
 * PL-5: the batched, list-screen version of sumPaidAmountsByBill above -
 * ONE query for every purchase on the current page, mirroring
 * sumBilledQuantitiesByItemForPurchases exactly (including joining through
 * purchase_bills to attach each row's own purchaseId, needed to split the
 * flat result back into one Map per purchase for computePaidStatus).
 */
export async function sumPaidAmountsByBillForPurchases(tx: TenantTx, companyId: string, purchaseIds: string[]): Promise<PaidAmountRowForPurchase[]> {
  if (purchaseIds.length === 0) {
    return [];
  }
  const rows = await tx
    .select({
      purchaseId: purchaseBills.purchaseId,
      billId: paymentAllocations.billId,
      paidAmountUsd: sql<string>`sum(${paymentAllocations.appliedAmountUsd})`.as("paid_amount_usd"),
    })
    .from(paymentAllocations)
    .innerJoin(purchaseBills, eq(purchaseBills.id, paymentAllocations.billId))
    .where(and(inArray(purchaseBills.purchaseId, purchaseIds), eq(paymentAllocations.companyId, companyId), isNull(paymentAllocations.deletedAt), isNull(purchaseBills.deletedAt)))
    .groupBy(purchaseBills.purchaseId, paymentAllocations.billId);
  return rows;
}

export interface OutstandingBillRow {
  id: string;
  purchaseId: string;
  purchaseNumber: string;
  billNumber: string;
  billDate: string;
  dueDate: string | null;
  billAmountUsd: string;
  paidAmountUsd: string;
}

/**
 * PL-5: every APPROVED bill for a given supplier that isn't already fully
 * paid - what the Payment form's own bill picker (and the create guard)
 * both need. Only `approved` bills are eligible (a draft bill's amount
 * isn't final yet - same reasoning purchase-bills.service.ts's own
 * requirePurchaseNotDraft guard already applies one level up), and
 * `reversed`/`paid` bills are excluded outright (nothing left to pay, or
 * the document itself was voided). Left-joined to payment_allocations so
 * a bill with zero payments so far still returns a row (paidAmountUsd
 * "0"), not silently dropped by an inner join.
 */
export async function listOutstandingBillsForSupplier(tx: TenantTx, companyId: string, supplierId: string): Promise<OutstandingBillRow[]> {
  const rows = await tx
    .select({
      id: purchaseBills.id,
      purchaseId: purchaseBills.purchaseId,
      purchaseNumber: purchases.purchaseNumber,
      billNumber: purchaseBills.billNumber,
      billDate: purchaseBills.billDate,
      dueDate: purchaseBills.dueDate,
      billAmountUsd: purchaseBills.billAmountUsd,
      paidAmountUsd: sql<string>`coalesce(sum(${paymentAllocations.appliedAmountUsd}), 0)`.as("paid_amount_usd"),
    })
    .from(purchaseBills)
    .innerJoin(purchases, eq(purchases.id, purchaseBills.purchaseId))
    .leftJoin(
      paymentAllocations,
      and(eq(paymentAllocations.billId, purchaseBills.id), isNull(paymentAllocations.deletedAt)),
    )
    .where(
      and(
        eq(purchases.supplierId, supplierId),
        eq(purchaseBills.companyId, companyId),
        eq(purchaseBills.status, "approved"),
        isNull(purchaseBills.deletedAt),
      ),
    )
    .groupBy(purchaseBills.id, purchases.purchaseNumber)
    .having(sql`${purchaseBills.billAmountUsd} > coalesce(sum(${paymentAllocations.appliedAmountUsd}), 0)`);
  return rows;
}
