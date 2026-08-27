import type { RequestContext } from "../../common/context/request-context.js";
import { ConflictError, NotFoundError, UnauthorizedError } from "../../common/errors/index.js";
import { parseMoney, roundAmount, roundRate } from "../../common/money/decimal.js";
import { insertAuditLog } from "../../core/audit/write.js";
import { nextNumber } from "../../core/numbering/next-number.js";
import { findTransition, runGuards, type WorkflowTransition } from "../../core/workflow/transitions.js";
import { withTenantDb } from "../../database/get-db.js";
import type { PaginatedRows } from "../../core/masters/types.js";
import { listItemsWithPricingForPurchase } from "./purchase-items.repository.js";
import {
  findBillById,
  insertBill,
  insertBillItem,
  listAllBills,
  listBillsForPurchase,
  listItemsForBill,
  sumBilledQuantitiesByItem,
  transitionBillStatus,
  updateBillFields,
  type BillsListParams,
  type PurchaseBillItemRow,
  type PurchaseBillRow,
  type PurchaseBillWithPurchaseNumber,
} from "./purchase-bills.repository.js";
import type { CreatePurchaseInvoiceInput, UpdatePurchaseInvoiceInput } from "./purchase-bills.validator.js";
import { computeBilledStatus, computeReceivedStatus, maybeAutoClosePurchase, type BilledStatus } from "./purchase-lifecycle.js";
import { sumConfirmedReceivedQuantitiesByItem } from "./purchase-receipts.repository.js";
import { findPurchaseById } from "./purchase.repository.js";

export type { BilledStatus };

interface BillApproveGuardContext {
  purchaseStatus: string;
}

function requirePurchaseNotDraft(context: BillApproveGuardContext): void {
  if (context.purchaseStatus === "draft") {
    throw new ConflictError("Cannot approve: the underlying purchase order must be issued first");
  }
}

/** Draft -> Approved only. No reconciliation cycle (PL-1/ADR 0016 already removed that - a bill never moved stock in the first place, so there's nothing to reconcile on an item edit). */
const PURCHASE_BILL_WORKFLOW: WorkflowTransition<PurchaseBillRow["status"], BillApproveGuardContext>[] = [
  {
    name: "approve",
    from: "draft",
    to: "approved",
    permission: "purchase.invoice.approve",
    guards: [requirePurchaseNotDraft],
  },
];

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

/**
 * PL-2: the WIRE shape for every response this module returns - kept as
 * Prompt 22's field names (invoiceNumber/invoiceDate/invoiceAmountUsd)
 * even though PurchaseBillRow's own columns are now billNumber/billDate/
 * billAmountUsd. The REST surface (/invoices), field-definitions entity
 * ("invoice"), and attachment entity string ("purchase_invoice") are all
 * deliberately unrenamed in this prompt (PL-4 does the coordinated
 * cutover) - this function is the ONE place that translates, so every
 * endpoint (create/update/approve/list) speaks the same wire shape
 * purchase.service.ts's getById already established via
 * attachInvoiceVariance.
 */
export interface PurchaseBillWire {
  id: string;
  purchaseId: string;
  invoiceNumber: string;
  supplierInvoiceNo: string | null;
  invoiceDate: string;
  dueDate: string | null;
  invoiceAmountUsd: string;
  taxAmount: string | null;
  status: PurchaseBillRow["status"];
}

export interface PurchaseBillWireWithItems extends PurchaseBillWire {
  items: PurchaseBillItemRow[];
}

function toWireShape(bill: PurchaseBillRow): PurchaseBillWire {
  return {
    id: bill.id,
    purchaseId: bill.purchaseId,
    invoiceNumber: bill.billNumber,
    supplierInvoiceNo: bill.supplierInvoiceNo,
    invoiceDate: bill.billDate,
    dueDate: bill.dueDate,
    invoiceAmountUsd: bill.billAmountUsd,
    taxAmount: bill.taxAmount,
    status: bill.status,
  };
}

export interface PurchaseBillWireWithPurchaseNumber extends PurchaseBillWire {
  purchaseNumber: string;
}

/** PL-4: the standalone "Purchase Bills" list screen's own endpoint - cross-purchase, paginated + filtered server-side (rule 10). Distinct from `list` below, which is scoped to one purchase's own sub-panel. */
export async function listAll(ctx: RequestContext, params: BillsListParams): Promise<PaginatedRows<PurchaseBillWireWithPurchaseNumber>> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, async (tx) => {
    const page = await listAllBills(tx, scope.companyId, params);
    return {
      ...page,
      items: page.items.map((bill: PurchaseBillWithPurchaseNumber) => ({ ...toWireShape(bill), purchaseNumber: bill.purchaseNumber })),
    };
  });
}

export async function list(ctx: RequestContext, purchaseId: string): Promise<PurchaseBillWireWithItems[]> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, async (tx) => {
    const bills = await listBillsForPurchase(tx, scope.companyId, purchaseId);
    const withItems: PurchaseBillWireWithItems[] = [];
    for (const bill of bills) {
      const items = await listItemsForBill(tx, scope.companyId, bill.id);
      withItems.push({ ...toWireShape(bill), items });
    }
    return withItems;
  });
}

/**
 * A bill is created any time, regardless of the parent purchase's own
 * status - a supplier can send its invoice before the PO is internally
 * approved. Multiple bills per purchase are allowed unconditionally
 * (PL-2 §1: partial billing is a first-class case, not a flag - unlike
 * Prompt 22's ALLOW_PARTIAL_INVOICING, there is no single-bill-by-default
 * restriction here). `items` is optional - see purchase-bills.validator.ts's
 * doc comment - but when present, over-billing (billing more than a
 * purchase item's ordered quantity, summed across every existing bill) is
 * rejected at create time, same discipline as receipts' own over-receipt
 * guard.
 */
export async function create(ctx: RequestContext, purchaseId: string, input: CreatePurchaseInvoiceInput): Promise<PurchaseBillWireWithItems> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const purchase = await findPurchaseById(tx, scope.companyId, purchaseId);
    if (!purchase) {
      throw new NotFoundError("Purchase not found");
    }

    const billLines = input.items ?? [];
    if (billLines.length > 0) {
      const orderedItems = await listItemsWithPricingForPurchase(tx, scope.companyId, purchaseId);
      const orderedById = new Map(orderedItems.map((item) => [item.id, item]));
      for (const line of billLines) {
        if (!orderedById.has(line.purchaseItemId)) {
          throw new ConflictError(`Purchase item ${line.purchaseItemId} does not belong to purchase ${purchase.purchaseNumber}`);
        }
      }

      const alreadyBilled = await sumBilledQuantitiesByItem(tx, scope.companyId, purchaseId);
      const alreadyBilledById = new Map(alreadyBilled.map((row) => [row.purchaseItemId, parseMoney(row.billedQuantity)]));

      for (const line of billLines) {
        const orderedItem = orderedById.get(line.purchaseItemId);
        if (!orderedItem) {
          continue;
        }
        const requestedQuantity = parseMoney(line.billedQuantity);
        if (requestedQuantity.lte(0)) {
          throw new ConflictError(`billedQuantity for item ${line.purchaseItemId} must be greater than 0`);
        }
        const alreadyBilledQuantity = alreadyBilledById.get(line.purchaseItemId) ?? parseMoney("0");
        const orderedQuantity = parseMoney(orderedItem.quantity);
        if (alreadyBilledQuantity.plus(requestedQuantity).gt(orderedQuantity)) {
          throw new ConflictError(
            `Cannot bill ${requestedQuantity.toString()} of item ${line.purchaseItemId}: only ${orderedQuantity.minus(alreadyBilledQuantity).toString()} remains unbilled (ordered ${orderedQuantity.toString()}, already billed ${alreadyBilledQuantity.toString()})`,
          );
        }
      }
    }

    // Company-wide, not branch-scoped - matches purchase.service.ts's own
    // "PO" nextNumber call exactly (seedDefaultNumberSeries seeds every
    // series with a null branch_id; passing a real branchId here would
    // look for a branch-specific series that was never seeded).
    const billNumber = await nextNumber(tx, {
      companyId: scope.companyId,
      docType: "BILL",
      date: new Date(input.invoiceDate),
    });

    const bill = await insertBill(tx, {
      companyId: scope.companyId,
      ...(purchase.branchId ? { branchId: purchase.branchId } : {}),
      purchaseId,
      billNumber,
      ...(input.supplierInvoiceNo ? { supplierInvoiceNo: input.supplierInvoiceNo } : {}),
      billDate: input.invoiceDate,
      ...(input.dueDate ? { dueDate: input.dueDate } : {}),
      billAmountUsd: roundAmount(parseMoney(input.invoiceAmountUsd)),
      ...(input.taxAmount ? { taxAmount: roundAmount(parseMoney(input.taxAmount)) } : {}),
      createdBy: scope.userId,
    });

    const items: PurchaseBillItemRow[] = [];
    for (const line of billLines) {
      const item = await insertBillItem(tx, {
        billId: bill.id,
        companyId: scope.companyId,
        purchaseItemId: line.purchaseItemId,
        billedQuantity: roundRate(parseMoney(line.billedQuantity)),
        billedAmountUsd: roundAmount(parseMoney(line.billedAmountUsd)),
        createdBy: scope.userId,
      });
      items.push(item);
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "purchase_invoice",
      entityId: bill.id,
      action: "purchase_invoice.created",
      after: { billNumber: bill.billNumber, purchaseId, billDate: bill.billDate, billAmountUsd: bill.billAmountUsd, items: billLines },
    });

    return { ...toWireShape(bill), items };
  });
}

/** Draft only - once approved, a field edit isn't allowed (matches the purchase header's own Draft-only lock). */
export async function update(
  ctx: RequestContext,
  purchaseId: string,
  billId: string,
  input: UpdatePurchaseInvoiceInput,
): Promise<PurchaseBillWire> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const existing = await findBillById(tx, scope.companyId, purchaseId, billId);
    if (!existing) {
      throw new NotFoundError("Purchase invoice not found");
    }
    if (existing.status !== "draft") {
      throw new ConflictError(`Invoice ${existing.billNumber} is ${existing.status} and can no longer be edited`);
    }

    const row = await updateBillFields(tx, scope.companyId, billId, {
      ...(input.supplierInvoiceNo !== undefined ? { supplierInvoiceNo: input.supplierInvoiceNo } : {}),
      ...(input.invoiceDate !== undefined ? { billDate: input.invoiceDate } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      ...(input.invoiceAmountUsd !== undefined ? { billAmountUsd: roundAmount(parseMoney(input.invoiceAmountUsd)) } : {}),
      ...(input.taxAmount !== undefined ? { taxAmount: roundAmount(parseMoney(input.taxAmount)) } : {}),
      updatedBy: scope.userId,
    });
    if (!row) {
      throw new NotFoundError("Purchase invoice not found");
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "purchase_invoice",
      entityId: billId,
      action: "purchase_invoice.updated",
      before: { supplierInvoiceNo: existing.supplierInvoiceNo, billDate: existing.billDate, billAmountUsd: existing.billAmountUsd },
      after: { supplierInvoiceNo: row.supplierInvoiceNo, billDate: row.billDate, billAmountUsd: row.billAmountUsd },
    });

    return toWireShape(row);
  });
}

/**
 * PL-1/ADR 0016 (unchanged by PL-2): purely a financial approval - no
 * stock effect. Approving records the supplier's liability; physical
 * stock only moves on a Purchase Receipt confirm. PL-2 does NOT auto-move
 * the PO to a "Closed" state on full receipt+billing - there is no
 * `closed` value in purchaseStatusEnum yet (that enum rework, Draft ->
 * Issued -> Closed, is PL-3's job, its own audited migration since it
 * touches existing data - see ADR 0017). billed_status alone is exposed
 * here; PO-level auto-close is deferred to PL-3.
 */
export async function approve(ctx: RequestContext, purchaseId: string, billId: string): Promise<PurchaseBillWire> {
  const scope = requireTenantScope(ctx);
  const transition = findTransition(PURCHASE_BILL_WORKFLOW, "approve");

  return withTenantDb(ctx, async (tx) => {
    const purchase = await findPurchaseById(tx, scope.companyId, purchaseId);
    if (!purchase) {
      throw new NotFoundError("Purchase not found");
    }
    const existing = await findBillById(tx, scope.companyId, purchaseId, billId);
    if (!existing) {
      throw new NotFoundError("Purchase invoice not found");
    }

    runGuards(transition, { purchaseStatus: purchase.status });

    const row = await transitionBillStatus(tx, scope.companyId, billId, {
      from: transition.from,
      to: transition.to,
      extra: { approvedBy: scope.userId, approvedAt: new Date() },
    });
    if (!row) {
      throw new ConflictError(`Invoice ${existing.billNumber} is "${existing.status}", not "${transition.from}" - cannot approve`);
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "purchase_invoice",
      entityId: billId,
      action: "purchase_invoice.approved",
      before: { status: existing.status },
      after: { status: row.status },
    });

    // PL-3: this approval just changed the billed axis - check whether
    // the PO is now fully done on BOTH axes and should auto-close, using
    // the freshest possible figures (re-summed after this bill's own
    // write, in the SAME transaction).
    const orderedItems = await listItemsWithPricingForPurchase(tx, scope.companyId, purchaseId);
    const receivedSums = await sumConfirmedReceivedQuantitiesByItem(tx, scope.companyId, purchaseId);
    const receivedByItemId = new Map(receivedSums.map((sumRow) => [sumRow.purchaseItemId, sumRow.receivedQuantity]));
    const billedSums = await sumBilledQuantitiesByItem(tx, scope.companyId, purchaseId);
    const billedByItemId = new Map(billedSums.map((sumRow) => [sumRow.purchaseItemId, sumRow.billedQuantity]));
    await maybeAutoClosePurchase(
      tx,
      scope.companyId,
      purchaseId,
      computeReceivedStatus(orderedItems, receivedByItemId),
      computeBilledStatus(orderedItems, billedByItemId),
    );

    return toWireShape(row);
  });
}
