import { eventBus } from "../../common/events/bus.js";
import type { RequestContext } from "../../common/context/request-context.js";
import { ConflictError, NotFoundError, UnauthorizedError } from "../../common/errors/index.js";
import { parseMoney, roundAmount } from "../../common/money/decimal.js";
import { insertAuditLog } from "../../core/audit/write.js";
import { nextNumber } from "../../core/numbering/next-number.js";
import { findTransition, runGuards, type WorkflowTransition } from "../../core/workflow/transitions.js";
import { withTenantDb } from "../../database/get-db.js";
import { listItemsWithPricingForPurchase } from "./purchase-items.repository.js";
import {
  findAnyInvoiceForPurchase,
  findInvoiceById,
  insertInvoice,
  transitionInvoiceStatus,
  updateInvoiceFields,
  type PurchaseInvoiceRow,
} from "./purchase-invoices.repository.js";
import type { CreatePurchaseInvoiceInput, UpdatePurchaseInvoiceInput } from "./purchase-invoices.validator.js";
import { findPurchaseById, findShipmentByPurchaseId } from "./purchase.repository.js";

/**
 * "One-to-many with single enforced by default" (confirmed with the
 * user): purchase_invoices.purchase_id is a plain FK - the schema
 * supports partial invoicing genuinely - but this flag rejects a second
 * invoice per purchase until partial invoicing is actually requested.
 * Flip to true (no migration needed) when it is.
 */
const ALLOW_PARTIAL_INVOICING = false;

interface InvoiceApproveGuardContext {
  purchaseStatus: string;
}

function requirePurchaseNotDraft(context: InvoiceApproveGuardContext): void {
  if (context.purchaseStatus === "draft") {
    throw new ConflictError("Cannot approve: the underlying purchase order must be approved first");
  }
}

/** Draft -> Approved only (rule 8's spirit extended to invoices: Part 4's re-approval cycle re-enters this SAME transition, never a separate "reapprove" one - purchase-items.service.ts flips an approved invoice back to draft, and this is how it moves forward again). */
const PURCHASE_INVOICE_WORKFLOW: WorkflowTransition<PurchaseInvoiceRow["status"], InvoiceApproveGuardContext>[] = [
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

/** Prompt 22 Part 2: an invoice is created any time, regardless of the parent purchase's own status - a supplier can send its invoice before the PO is internally approved. Approval (where stock actually moves) is where the purchase-must-be-approved guard lives, not here. */
export async function create(ctx: RequestContext, purchaseId: string, input: CreatePurchaseInvoiceInput): Promise<PurchaseInvoiceRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const purchase = await findPurchaseById(tx, scope.companyId, purchaseId);
    if (!purchase) {
      throw new NotFoundError("Purchase not found");
    }

    if (!ALLOW_PARTIAL_INVOICING) {
      const existing = await findAnyInvoiceForPurchase(tx, scope.companyId, purchaseId);
      if (existing) {
        throw new ConflictError(`Purchase ${purchase.purchaseNumber} already has an invoice - partial invoicing is not enabled`);
      }
    }

    // Company-wide, not branch-scoped - matches purchase.service.ts's own
    // "PO" nextNumber call exactly (seedDefaultNumberSeries seeds every
    // series with a null branch_id; passing a real branchId here would
    // look for a branch-specific series that was never seeded).
    const invoiceNumber = await nextNumber(tx, {
      companyId: scope.companyId,
      docType: "SUPPLIER_INVOICE",
      date: new Date(input.invoiceDate),
    });

    const row = await insertInvoice(tx, {
      companyId: scope.companyId,
      ...(purchase.branchId ? { branchId: purchase.branchId } : {}),
      purchaseId,
      invoiceNumber,
      ...(input.supplierInvoiceNo ? { supplierInvoiceNo: input.supplierInvoiceNo } : {}),
      invoiceDate: input.invoiceDate,
      invoiceAmountUsd: roundAmount(parseMoney(input.invoiceAmountUsd)),
      createdBy: scope.userId,
    });

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "purchase_invoice",
      entityId: row.id,
      action: "purchase_invoice.created",
      after: { invoiceNumber: row.invoiceNumber, purchaseId, invoiceDate: row.invoiceDate, invoiceAmountUsd: row.invoiceAmountUsd },
    });

    return row;
  });
}

/** Draft only - once approved, a field edit either goes through re-approval (purchase item changes) or isn't allowed at all (editing the invoice's own fields after approval isn't part of this prompt's scope). */
export async function update(
  ctx: RequestContext,
  purchaseId: string,
  invoiceId: string,
  input: UpdatePurchaseInvoiceInput,
): Promise<PurchaseInvoiceRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const existing = await findInvoiceById(tx, scope.companyId, purchaseId, invoiceId);
    if (!existing) {
      throw new NotFoundError("Purchase invoice not found");
    }
    if (existing.status !== "draft") {
      throw new ConflictError(`Invoice ${existing.invoiceNumber} is ${existing.status} and can no longer be edited`);
    }

    const row = await updateInvoiceFields(tx, scope.companyId, invoiceId, {
      ...(input.supplierInvoiceNo !== undefined ? { supplierInvoiceNo: input.supplierInvoiceNo } : {}),
      ...(input.invoiceDate !== undefined ? { invoiceDate: input.invoiceDate } : {}),
      ...(input.invoiceAmountUsd !== undefined ? { invoiceAmountUsd: roundAmount(parseMoney(input.invoiceAmountUsd)) } : {}),
      updatedBy: scope.userId,
    });
    if (!row) {
      throw new NotFoundError("Purchase invoice not found");
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "purchase_invoice",
      entityId: invoiceId,
      action: "purchase_invoice.updated",
      before: { supplierInvoiceNo: existing.supplierInvoiceNo, invoiceDate: existing.invoiceDate, invoiceAmountUsd: existing.invoiceAmountUsd },
      after: { supplierInvoiceNo: row.supplierInvoiceNo, invoiceDate: row.invoiceDate, invoiceAmountUsd: row.invoiceAmountUsd },
    });

    return row;
  });
}

/**
 * Prompt 22 Part 3/4: THE trigger for stock movement - never purchase
 * approval anymore. This same code path serves both a first approval and
 * every re-approval after a stock-relevant edit (purchase-items.service.ts's
 * triggerInvoiceReapprovalIfNeeded flips status back to draft, never
 * calls this directly) - the event always carries the purchase's CURRENT
 * items, and core/inventory's subscriber reconciles against whatever this
 * invoice previously moved, so this function itself never needs to know
 * or care which case it is.
 */
export async function approve(ctx: RequestContext, purchaseId: string, invoiceId: string): Promise<PurchaseInvoiceRow> {
  const scope = requireTenantScope(ctx);
  const transition = findTransition(PURCHASE_INVOICE_WORKFLOW, "approve");

  return withTenantDb(ctx, async (tx) => {
    const purchase = await findPurchaseById(tx, scope.companyId, purchaseId);
    if (!purchase) {
      throw new NotFoundError("Purchase not found");
    }
    const shipment = await findShipmentByPurchaseId(tx, scope.companyId, purchaseId);
    if (!shipment) {
      throw new Error(`Purchase ${purchaseId} has no shipment row - the 1:1 invariant was violated`);
    }
    const existing = await findInvoiceById(tx, scope.companyId, purchaseId, invoiceId);
    if (!existing) {
      throw new NotFoundError("Purchase invoice not found");
    }

    runGuards(transition, { purchaseStatus: purchase.status });

    const row = await transitionInvoiceStatus(tx, scope.companyId, invoiceId, {
      from: transition.from,
      to: transition.to,
      extra: { approvedBy: scope.userId, approvedAt: new Date() },
    });
    if (!row) {
      throw new ConflictError(`Invoice ${existing.invoiceNumber} is "${existing.status}", not "${transition.from}" - cannot approve`);
    }

    const items = await listItemsWithPricingForPurchase(tx, scope.companyId, purchaseId);

    await eventBus.emit(tx, "invoice.approved", {
      invoiceId,
      purchaseId,
      companyId: scope.companyId,
      branchId: purchase.branchId,
      warehouseId: shipment.warehouseId,
      approvedBy: scope.userId,
      items: items.map((item) => ({
        purchaseItemId: item.id,
        itemId: item.itemId,
        gradeId: item.gradeId,
        quantity: item.quantity,
        uomId: item.uomId,
      })),
    });

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "purchase_invoice",
      entityId: invoiceId,
      action: "purchase_invoice.approved",
      before: { status: existing.status },
      after: { status: row.status },
    });

    return row;
  });
}
