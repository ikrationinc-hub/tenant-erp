import type { RequestContext } from "../../common/context/request-context.js";
import { ConflictError, NotFoundError, UnauthorizedError } from "../../common/errors/index.js";
import { parseMoney, roundAmount } from "../../common/money/decimal.js";
import { insertAuditLog } from "../../core/audit/write.js";
import type { PaginatedRows } from "../../core/masters/types.js";
import { nextNumber } from "../../core/numbering/next-number.js";
import { withTenantDb } from "../../database/get-db.js";
import { findBillByIdOnly, transitionBillStatus } from "./purchase-bills.repository.js";
import {
  findPaymentById,
  insertPayment,
  insertPaymentAllocation,
  listAllPayments,
  listAllocationsForPayment,
  listOutstandingBillsForSupplier,
  sumPaidAmountsByBill,
  type OutstandingBillRow,
  type PaymentAllocationRow,
  type PaymentRow,
  type PaymentsListParams,
} from "./purchase-payments.repository.js";
import type { CreatePaymentInput } from "./purchase-payments.validator.js";

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

export interface PaymentWire extends PaymentRow {
  allocations: PaymentAllocationRow[];
}

/** PL-5: the bill picker's own read model - every APPROVED, not-yet-fully-paid bill for a supplier, with its own outstanding balance already computed (billAmountUsd - paidAmountUsd), so the frontend never has to derive it (rule 3). */
export interface OutstandingBillWithBalance extends OutstandingBillRow {
  outstandingAmountUsd: string;
}

export async function listOutstandingBillsFor(ctx: RequestContext, supplierId: string): Promise<OutstandingBillWithBalance[]> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, async (tx) => {
    const rows = await listOutstandingBillsForSupplier(tx, scope.companyId, supplierId);
    return rows.map((row) => ({
      ...row,
      outstandingAmountUsd: roundAmount(parseMoney(row.billAmountUsd).minus(parseMoney(row.paidAmountUsd))),
    }));
  });
}

export async function listAll(ctx: RequestContext, params: PaymentsListParams): Promise<PaginatedRows<PaymentRow>> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, (tx) => listAllPayments(tx, scope.companyId, params));
}

export async function getById(ctx: RequestContext, id: string): Promise<PaymentWire> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, async (tx) => {
    const payment = await findPaymentById(tx, scope.companyId, id);
    if (!payment) {
      throw new NotFoundError("Payment not found");
    }
    const allocations = await listAllocationsForPayment(tx, scope.companyId, id);
    return { ...payment, allocations };
  });
}

/**
 * PL-5: records a payment against one or more bills in one transaction.
 * Each allocation line is checked against that bill's own CURRENT
 * outstanding balance (billAmountUsd minus everything already paid
 * against it, from sumPaidAmountsByBill - re-summed fresh inside this
 * same transaction, never trusted from a stale read) - over-paying a
 * bill is rejected the same way over-receiving/over-billing already are.
 * Only APPROVED bills are payable (requireBillApproved below) - a draft
 * bill's amount isn't final yet, same reasoning purchase-bills.service.ts's
 * own requirePurchaseNotDraft guard already applies one level up in the
 * lifecycle. After all allocations are written, every bill this payment
 * touched is re-checked: if its total paid now equals its own
 * billAmountUsd, it transitions draft/approved -> paid automatically
 * (maybeAutoPayBill below) - the same "derive the terminal state from a
 * freshly re-summed figure, inside the same transaction as the write that
 * might have just completed it" pattern purchase-lifecycle.ts's
 * maybeAutoClosePurchase already established for the PO's own Closed
 * state.
 */
export async function create(ctx: RequestContext, input: CreatePaymentInput): Promise<PaymentWire> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const billIds = input.allocations.map((allocation) => allocation.billId);
    const bills = await Promise.all(billIds.map((billId) => findBillByIdOnly(tx, scope.companyId, billId)));
    const paidSums = await sumPaidAmountsByBill(tx, scope.companyId, billIds);
    const paidByBillId = new Map(paidSums.map((row) => [row.billId, row.paidAmountUsd]));

    let runningTotal = parseMoney("0");
    for (let i = 0; i < input.allocations.length; i += 1) {
      const allocation = input.allocations[i];
      const bill = bills[i];
      if (!allocation || !bill) {
        throw new NotFoundError(`Bill ${input.allocations[i]?.billId} not found`);
      }
      if (bill.status !== "approved") {
        throw new ConflictError(`Bill ${bill.billNumber} is "${bill.status}" - only an approved bill can be paid`);
      }
      const appliedAmount = parseMoney(allocation.appliedAmountUsd);
      if (appliedAmount.lte(0)) {
        throw new ConflictError(`appliedAmountUsd for bill ${bill.billNumber} must be greater than 0`);
      }
      const alreadyPaid = parseMoney(paidByBillId.get(bill.id) ?? "0");
      const outstanding = parseMoney(bill.billAmountUsd).minus(alreadyPaid);
      if (appliedAmount.gt(outstanding)) {
        throw new ConflictError(
          `Cannot apply ${appliedAmount.toString()} to bill ${bill.billNumber}: only ${outstanding.toString()} remains outstanding (bill amount ${bill.billAmountUsd}, already paid ${alreadyPaid.toString()})`,
        );
      }
      runningTotal = runningTotal.plus(appliedAmount);
    }

    const paymentNumber = await nextNumber(tx, {
      companyId: scope.companyId,
      docType: "PAYMENT",
      date: new Date(input.paymentDate),
    });

    const payment = await insertPayment(tx, {
      companyId: scope.companyId,
      supplierId: input.supplierId,
      paymentNumber,
      paymentDate: input.paymentDate,
      paymentMode: input.paymentMode,
      ...(input.referenceNumber ? { referenceNumber: input.referenceNumber } : {}),
      paymentAmountUsd: roundAmount(runningTotal),
      ...(input.notes ? { notes: input.notes } : {}),
      createdBy: scope.userId,
    });

    const allocations: PaymentAllocationRow[] = [];
    for (const allocation of input.allocations) {
      const row = await insertPaymentAllocation(tx, {
        paymentId: payment.id,
        companyId: scope.companyId,
        billId: allocation.billId,
        appliedAmountUsd: roundAmount(parseMoney(allocation.appliedAmountUsd)),
        createdBy: scope.userId,
      });
      allocations.push(row);
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "payment",
      entityId: payment.id,
      action: "payment.recorded",
      after: {
        paymentNumber: payment.paymentNumber,
        supplierId: payment.supplierId,
        paymentAmountUsd: payment.paymentAmountUsd,
        allocations: input.allocations,
      },
    });

    // Every bill this payment touched may now be fully paid - re-sum
    // fresh (this transaction's own writes above included) and
    // auto-transition each one that's actually settled.
    const freshPaidSums = await sumPaidAmountsByBill(tx, scope.companyId, billIds);
    const freshPaidByBillId = new Map(freshPaidSums.map((row) => [row.billId, row.paidAmountUsd]));
    for (const bill of bills) {
      if (!bill) {
        continue;
      }
      const totalPaid = parseMoney(freshPaidByBillId.get(bill.id) ?? "0");
      if (totalPaid.gte(parseMoney(bill.billAmountUsd))) {
        const row = await transitionBillStatus(tx, scope.companyId, bill.id, { from: bill.status, to: "paid" });
        if (row) {
          await insertAuditLog(tx, {
            companyId: scope.companyId,
            changedBy: scope.userId,
            entity: "purchase_invoice",
            entityId: bill.id,
            action: "purchase_invoice.paid",
            before: { status: bill.status },
            after: { status: row.status },
          });
        }
      }
    }

    return { ...payment, allocations };
  });
}
