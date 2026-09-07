import type { RequestContext } from "../../common/context/request-context.js";
import { ConflictError, NotFoundError, UnauthorizedError } from "../../common/errors/index.js";
import { parseMoney, roundAmount } from "../../common/money/decimal.js";
import { insertAuditLog } from "../../core/audit/write.js";
import type { PaginatedRows } from "../../core/masters/types.js";
import { nextNumber } from "../../core/numbering/next-number.js";
import { withTenantDb } from "../../database/get-db.js";
import { sumDeliveredQuantitiesByItem, sumReservedAndConsumedBySalesItem } from "./deliveries.repository.js";
import { findInvoiceByIdOnly, sumInvoicedQuantitiesByItem, transitionInvoiceStatus } from "./sales-invoices.repository.js";
import {
  findPaymentReceivedById,
  insertPaymentReceived,
  insertSalesPaymentAllocation,
  listAllocationsForPaymentReceived,
  listAllPaymentsReceived,
  listOutstandingInvoicesForCustomer,
  sumPaidAmountsByInvoice,
  type OutstandingInvoiceRow,
  type PaymentReceivedRow,
  type PaymentsReceivedListParams,
  type SalesPaymentAllocationRow,
} from "./sales-payments-received.repository.js";
import type { CreatePaymentReceivedInput } from "./sales-payments-received.validator.js";
import { computeDeliveredStatus, computeInvoicedStatus, maybeAutoCloseSalesOrder } from "./sales-lifecycle.js";

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

export interface PaymentReceivedWire extends PaymentReceivedRow {
  allocations: SalesPaymentAllocationRow[];
}

/** The invoice picker's own read model - every APPROVED, not-yet-fully-paid invoice for a customer, with its own outstanding balance already computed (invoiceAmountUsd - paidAmountUsd), so the frontend never has to derive it (rule 3). Mirrors purchase-payments.service.ts's listOutstandingBillsFor. */
export interface OutstandingInvoiceWithBalance extends OutstandingInvoiceRow {
  outstandingAmountUsd: string;
}

export async function listOutstandingInvoicesFor(ctx: RequestContext, customerId: string): Promise<OutstandingInvoiceWithBalance[]> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, async (tx) => {
    const rows = await listOutstandingInvoicesForCustomer(tx, scope.companyId, customerId);
    return rows.map((row) => ({
      ...row,
      outstandingAmountUsd: roundAmount(parseMoney(row.invoiceAmountUsd).minus(parseMoney(row.paidAmountUsd))),
    }));
  });
}

export async function listAll(ctx: RequestContext, params: PaymentsReceivedListParams): Promise<PaginatedRows<PaymentReceivedRow>> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, (tx) => listAllPaymentsReceived(tx, scope.companyId, params));
}

export async function getById(ctx: RequestContext, id: string): Promise<PaymentReceivedWire> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, async (tx) => {
    const payment = await findPaymentReceivedById(tx, scope.companyId, id);
    if (!payment) {
      throw new NotFoundError("Payment received not found");
    }
    const allocations = await listAllocationsForPaymentReceived(tx, scope.companyId, id);
    return { ...payment, allocations };
  });
}

/**
 * Records a payment received against one or more invoices in one
 * transaction - mirrors purchase-payments.service.ts's create() exactly.
 * Each allocation line is checked against that invoice's own CURRENT
 * outstanding balance (re-summed fresh inside this same transaction,
 * never trusted from a stale read). Only APPROVED invoices are payable.
 * After all allocations are written, every invoice this payment touched
 * is re-checked: if its total paid now equals its own invoiceAmountUsd,
 * it auto-transitions to "paid" - then, for every sale any of those
 * invoices belongs to, both fulfilment axes are recomputed and
 * maybeAutoCloseSalesOrder is called (this is the OTHER place, besides
 * sales-invoices.service.ts's approve(), that can complete a sale's
 * journey to Closed).
 */
export async function create(ctx: RequestContext, input: CreatePaymentReceivedInput): Promise<PaymentReceivedWire> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const invoiceIds = input.allocations.map((allocation) => allocation.invoiceId);
    const invoices = await Promise.all(invoiceIds.map((invoiceId) => findInvoiceByIdOnly(tx, scope.companyId, invoiceId)));
    const paidSums = await sumPaidAmountsByInvoice(tx, scope.companyId, invoiceIds);
    const paidByInvoiceId = new Map(paidSums.map((row) => [row.invoiceId, row.paidAmountUsd]));

    let runningTotal = parseMoney("0");
    for (let i = 0; i < input.allocations.length; i += 1) {
      const allocation = input.allocations[i];
      const invoice = invoices[i];
      if (!allocation || !invoice) {
        throw new NotFoundError(`Invoice ${input.allocations[i]?.invoiceId} not found`);
      }
      if (invoice.status !== "approved") {
        throw new ConflictError(`Invoice ${invoice.invoiceNumber} is "${invoice.status}" - only an approved invoice can be paid`);
      }
      const appliedAmount = parseMoney(allocation.appliedAmountUsd);
      if (appliedAmount.lte(0)) {
        throw new ConflictError(`appliedAmountUsd for invoice ${invoice.invoiceNumber} must be greater than 0`);
      }
      const alreadyPaid = parseMoney(paidByInvoiceId.get(invoice.id) ?? "0");
      const outstanding = parseMoney(invoice.invoiceAmountUsd).minus(alreadyPaid);
      if (appliedAmount.gt(outstanding)) {
        throw new ConflictError(
          `Cannot apply ${appliedAmount.toString()} to invoice ${invoice.invoiceNumber}: only ${outstanding.toString()} remains outstanding (invoice amount ${invoice.invoiceAmountUsd}, already paid ${alreadyPaid.toString()})`,
        );
      }
      runningTotal = runningTotal.plus(appliedAmount);
    }

    const paymentNumber = await nextNumber(tx, {
      companyId: scope.companyId,
      docType: "RECEIPT",
      date: new Date(input.paymentDate),
    });

    const payment = await insertPaymentReceived(tx, {
      companyId: scope.companyId,
      customerId: input.customerId,
      paymentNumber,
      paymentDate: input.paymentDate,
      paymentMode: input.paymentMode,
      ...(input.referenceNumber ? { referenceNumber: input.referenceNumber } : {}),
      paymentAmountUsd: roundAmount(runningTotal),
      ...(input.notes ? { notes: input.notes } : {}),
      createdBy: scope.userId,
    });

    const allocations: SalesPaymentAllocationRow[] = [];
    for (const allocation of input.allocations) {
      const row = await insertSalesPaymentAllocation(tx, {
        paymentId: payment.id,
        companyId: scope.companyId,
        invoiceId: allocation.invoiceId,
        appliedAmountUsd: roundAmount(parseMoney(allocation.appliedAmountUsd)),
        createdBy: scope.userId,
      });
      allocations.push(row);
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "payment_received",
      entityId: payment.id,
      action: "payment_received.recorded",
      after: {
        paymentNumber: payment.paymentNumber,
        customerId: payment.customerId,
        paymentAmountUsd: payment.paymentAmountUsd,
        allocations: input.allocations,
      },
    });

    // Every invoice this payment touched may now be fully paid - re-sum
    // fresh (this transaction's own writes above included) and
    // auto-transition each one that's actually settled.
    const freshPaidSums = await sumPaidAmountsByInvoice(tx, scope.companyId, invoiceIds);
    const freshPaidByInvoiceId = new Map(freshPaidSums.map((row) => [row.invoiceId, row.paidAmountUsd]));
    const touchedSalesIds = new Set<string>();
    for (const invoice of invoices) {
      if (!invoice) {
        continue;
      }
      touchedSalesIds.add(invoice.salesId);
      const totalPaid = parseMoney(freshPaidByInvoiceId.get(invoice.id) ?? "0");
      if (totalPaid.gte(parseMoney(invoice.invoiceAmountUsd))) {
        const row = await transitionInvoiceStatus(tx, scope.companyId, invoice.id, { from: invoice.status, to: "paid" });
        if (row) {
          await insertAuditLog(tx, {
            companyId: scope.companyId,
            changedBy: scope.userId,
            entity: "sales_invoice",
            entityId: invoice.id,
            action: "sales_invoice.paid",
            before: { status: invoice.status },
            after: { status: row.status },
          });
        }
      }
    }

    // A payment can settle invoices spanning multiple sales - recheck
    // auto-close for every one of them, same reasoning sales-invoices.
    // service.ts's approve() already applies to a single sale.
    for (const salesId of touchedSalesIds) {
      const reservedAndConsumed = await sumReservedAndConsumedBySalesItem(tx, scope.companyId, salesId);
      const reservedItems = reservedAndConsumed.map((row) => ({ id: row.salesItemId, reservedQty: row.reservedQty }));
      const deliveredByItemId = new Map(reservedAndConsumed.map((row) => [row.salesItemId, row.consumedQty]));
      const deliveredStatus = computeDeliveredStatus(reservedItems, deliveredByItemId);

      const deliveredRows = await sumDeliveredQuantitiesByItem(tx, scope.companyId, salesId);
      const deliveredItems = deliveredRows.map((row) => ({ id: row.salesItemId, deliveredQty: row.deliveredQuantity }));
      const invoicedRows = await sumInvoicedQuantitiesByItem(tx, scope.companyId, salesId);
      const invoicedByItemId = new Map(invoicedRows.map((row) => [row.salesItemId, row.invoicedQuantity]));
      const invoicedStatus = computeInvoicedStatus(deliveredItems, invoicedByItemId);

      await maybeAutoCloseSalesOrder(tx, scope.companyId, salesId, deliveredStatus, invoicedStatus);
    }

    return { ...payment, allocations };
  });
}
