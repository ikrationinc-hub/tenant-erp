import type { RequestContext } from "../../common/context/request-context.js";
import { ConflictError, NotFoundError, UnauthorizedError } from "../../common/errors/index.js";
import { parseMoney, roundAmount, roundRate } from "../../common/money/decimal.js";
import { insertAuditLog } from "../../core/audit/write.js";
import type { PaginatedRows } from "../../core/masters/types.js";
import { nextNumber } from "../../core/numbering/next-number.js";
import { findTransition, runGuards, type WorkflowTransition } from "../../core/workflow/transitions.js";
import { withTenantDb } from "../../database/get-db.js";
import { sumDeliveredQuantitiesByItem } from "./deliveries.repository.js";
import {
  findInvoiceById,
  insertInvoice,
  insertInvoiceItem,
  listAllInvoices,
  listInvoicesForSales,
  listItemsForInvoice,
  sumInvoicedQuantitiesByItem,
  transitionInvoiceStatus,
  updateInvoiceFields,
  type InvoicesListParams,
  type SalesInvoiceItemRow,
  type SalesInvoiceRow,
  type SalesInvoiceWithSalesNumber,
} from "./sales-invoices.repository.js";
import type { CreateSalesInvoiceInput, UpdateSalesInvoiceInput } from "./sales-invoices.validator.js";
import { computeDeliveredStatus, computeInvoicedStatus, maybeAutoCloseSalesOrder } from "./sales-lifecycle.js";
import { sumReservedAndConsumedBySalesItem } from "./deliveries.repository.js";
import { findSalesById } from "./sales.repository.js";

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

/** Draft -> Approved only, financial-only (no stock/reservation interaction at all, unlike Delivery) - mirrors PURCHASE_BILL_WORKFLOW exactly, minus the "underlying purchase must not be draft" guard: an invoice CAN be created and approved against a still-Draft or Cancelled sale is NOT allowed either (see create()'s own check), but there is no analogous "sale not draft" workflow guard here because create() already gates entry at the door - approve() only ever sees an invoice that already exists. */
const SALES_INVOICE_WORKFLOW: WorkflowTransition<SalesInvoiceRow["status"], Record<string, never>>[] = [
  {
    name: "approve",
    from: "draft",
    to: "approved",
    permission: "sales.invoice.approve",
    guards: [],
  },
];

export interface SalesInvoiceWithItems extends SalesInvoiceRow {
  items: SalesInvoiceItemRow[];
}

/** The standalone "Sales Invoices" list screen's own endpoint - cross-sale, paginated + filtered server-side (rule 10). Mirrors purchase-bills.service.ts's listAll. */
export async function listAll(ctx: RequestContext, params: InvoicesListParams): Promise<PaginatedRows<SalesInvoiceWithSalesNumber>> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, (tx) => listAllInvoices(tx, scope.companyId, params));
}

export async function list(ctx: RequestContext, salesId: string): Promise<SalesInvoiceWithItems[]> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, async (tx) => {
    const invoices = await listInvoicesForSales(tx, scope.companyId, salesId);
    const withItems: SalesInvoiceWithItems[] = [];
    for (const invoice of invoices) {
      const items = await listItemsForInvoice(tx, scope.companyId, invoice.id);
      withItems.push({ ...invoice, items });
    }
    return withItems;
  });
}

/**
 * An invoice is created any time the sale is Approved or Closed - NOT
 * Draft or Cancelled (there's nothing to invoice against an unapproved or
 * dead sale). Unlike Purchase Bill (which allows billing before the PO is
 * even issued), Sales Invoice requires the sale to have been approved
 * first, since Approval is the moment a Sales Order becomes a real
 * commitment (docs/adr/0026). Multiple invoices per sale are allowed
 * unconditionally (partial invoicing is a first-class case, mirrors
 * Purchase Bill's own §1). `items` is optional - see sales-invoices.
 * validator.ts's own doc comment - but when present, over-invoicing
 * (invoicing more than a sales item's DELIVERED quantity, summed across
 * every existing invoice) is rejected at create time. This ceiling is
 * DELIVERED quantity, not ordered quantity (docs/adr/0028) - a deliberate
 * divergence from Purchase Bill's own ceiling (ordered quantity), since a
 * sale can only ever ship what got delivered. A sales item with nothing
 * delivered yet simply has no ceiling to check against here and is
 * rejected outright (can't invoice a line that hasn't shipped) - this
 * does NOT block invoicing the sale as a whole: a header-only invoice (no
 * items) is always allowed regardless of delivery state, which is what
 * makes "invoice independent of delivery" true at the SALE level while
 * still protecting per-item correctness when items are itemized.
 */
export async function create(ctx: RequestContext, salesId: string, input: CreateSalesInvoiceInput): Promise<SalesInvoiceWithItems> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const salesOrder = await findSalesById(tx, scope.companyId, salesId);
    if (!salesOrder) {
      throw new NotFoundError("Sales order not found");
    }
    if (salesOrder.status !== "approved" && salesOrder.status !== "closed") {
      throw new ConflictError(`Cannot invoice a sales order that is "${salesOrder.status}" - it must be approved first`);
    }

    const invoiceLines = input.items ?? [];
    if (invoiceLines.length > 0) {
      const deliveredRows = await sumDeliveredQuantitiesByItem(tx, scope.companyId, salesId);
      const deliveredById = new Map(deliveredRows.map((row) => [row.salesItemId, parseMoney(row.deliveredQuantity)]));

      const alreadyInvoiced = await sumInvoicedQuantitiesByItem(tx, scope.companyId, salesId);
      const alreadyInvoicedById = new Map(alreadyInvoiced.map((row) => [row.salesItemId, parseMoney(row.invoicedQuantity)]));

      for (const line of invoiceLines) {
        const requestedQuantity = parseMoney(line.invoicedQuantity);
        if (requestedQuantity.lte(0)) {
          throw new ConflictError(`invoicedQuantity for item ${line.salesItemId} must be greater than 0`);
        }
        const deliveredQuantity = deliveredById.get(line.salesItemId);
        if (!deliveredQuantity || deliveredQuantity.lte(0)) {
          throw new ConflictError(`Sales item ${line.salesItemId} has nothing delivered yet - nothing to invoice`);
        }
        const alreadyInvoicedQuantity = alreadyInvoicedById.get(line.salesItemId) ?? parseMoney("0");
        if (alreadyInvoicedQuantity.plus(requestedQuantity).gt(deliveredQuantity)) {
          throw new ConflictError(
            `Cannot invoice ${requestedQuantity.toString()} of item ${line.salesItemId}: only ${deliveredQuantity.minus(alreadyInvoicedQuantity).toString()} remains uninvoiced (delivered ${deliveredQuantity.toString()}, already invoiced ${alreadyInvoicedQuantity.toString()})`,
          );
        }
      }
    }

    // Company-wide series (core/provisioning/seed-number-series.ts seeds
    // "INVOICE" with no branch_id) - same reasoning as SO/DELIVERY's own
    // nextNumber calls.
    const invoiceNumber = await nextNumber(tx, {
      companyId: scope.companyId,
      docType: "INVOICE",
      date: new Date(input.invoiceDate),
    });

    const invoice = await insertInvoice(tx, {
      companyId: scope.companyId,
      ...(salesOrder.branchId ? { branchId: salesOrder.branchId } : {}),
      salesId,
      invoiceNumber,
      ...(input.customerReferenceNo ? { customerReferenceNo: input.customerReferenceNo } : {}),
      invoiceDate: input.invoiceDate,
      ...(input.dueDate ? { dueDate: input.dueDate } : {}),
      invoiceAmountUsd: roundAmount(parseMoney(input.invoiceAmountUsd)),
      ...(input.taxAmount ? { taxAmount: roundAmount(parseMoney(input.taxAmount)) } : {}),
      createdBy: scope.userId,
    });

    const items: SalesInvoiceItemRow[] = [];
    for (const line of invoiceLines) {
      const item = await insertInvoiceItem(tx, {
        invoiceId: invoice.id,
        companyId: scope.companyId,
        salesItemId: line.salesItemId,
        invoicedQuantity: roundRate(parseMoney(line.invoicedQuantity)),
        invoicedAmountUsd: roundAmount(parseMoney(line.invoicedAmountUsd)),
        createdBy: scope.userId,
      });
      items.push(item);
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "sales_invoice",
      entityId: invoice.id,
      action: "sales_invoice.created",
      after: { invoiceNumber: invoice.invoiceNumber, salesId, invoiceDate: invoice.invoiceDate, invoiceAmountUsd: invoice.invoiceAmountUsd, items: invoiceLines },
    });

    return { ...invoice, items };
  });
}

/** Draft only - once approved, a field edit isn't allowed (matches Purchase Bill's own Draft-only lock). */
export async function update(
  ctx: RequestContext,
  salesId: string,
  invoiceId: string,
  input: UpdateSalesInvoiceInput,
): Promise<SalesInvoiceRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const existing = await findInvoiceById(tx, scope.companyId, salesId, invoiceId);
    if (!existing) {
      throw new NotFoundError("Sales invoice not found");
    }
    if (existing.status !== "draft") {
      throw new ConflictError(`Invoice ${existing.invoiceNumber} is ${existing.status} and can no longer be edited`);
    }

    const row = await updateInvoiceFields(tx, scope.companyId, invoiceId, {
      ...(input.customerReferenceNo !== undefined ? { customerReferenceNo: input.customerReferenceNo } : {}),
      ...(input.invoiceDate !== undefined ? { invoiceDate: input.invoiceDate } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      ...(input.invoiceAmountUsd !== undefined ? { invoiceAmountUsd: roundAmount(parseMoney(input.invoiceAmountUsd)) } : {}),
      ...(input.taxAmount !== undefined ? { taxAmount: roundAmount(parseMoney(input.taxAmount)) } : {}),
      updatedBy: scope.userId,
    });
    if (!row) {
      throw new NotFoundError("Sales invoice not found");
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "sales_invoice",
      entityId: invoiceId,
      action: "sales_invoice.updated",
      before: { customerReferenceNo: existing.customerReferenceNo, invoiceDate: existing.invoiceDate, invoiceAmountUsd: existing.invoiceAmountUsd },
      after: { customerReferenceNo: row.customerReferenceNo, invoiceDate: row.invoiceDate, invoiceAmountUsd: row.invoiceAmountUsd },
    });

    return row;
  });
}

/**
 * Purely a financial approval - no stock effect (mirrors Purchase Bill's
 * own approve() exactly). After the transition, recompute both fulfilment
 * axes with the freshest possible figures (re-summed after this invoice's
 * own write, in the SAME transaction) and call maybeAutoCloseSalesOrder -
 * this is what finally makes "Closed" reachable now that both S-4 and S-5
 * exist.
 */
export async function approve(ctx: RequestContext, salesId: string, invoiceId: string): Promise<SalesInvoiceRow> {
  const scope = requireTenantScope(ctx);
  const transition = findTransition(SALES_INVOICE_WORKFLOW, "approve");

  return withTenantDb(ctx, async (tx) => {
    const existing = await findInvoiceById(tx, scope.companyId, salesId, invoiceId);
    if (!existing) {
      throw new NotFoundError("Sales invoice not found");
    }

    runGuards(transition, {});

    const row = await transitionInvoiceStatus(tx, scope.companyId, invoiceId, {
      from: transition.from,
      to: transition.to,
      extra: { approvedBy: scope.userId, approvedAt: new Date() },
    });
    if (!row) {
      throw new ConflictError(`Invoice ${existing.invoiceNumber} is "${existing.status}", not "${transition.from}" - cannot approve`);
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "sales_invoice",
      entityId: invoiceId,
      action: "sales_invoice.approved",
      before: { status: existing.status },
      after: { status: row.status },
    });

    const reservedAndConsumed = await sumReservedAndConsumedBySalesItem(tx, scope.companyId, salesId);
    const reservedItems = reservedAndConsumed.map((sumRow) => ({ id: sumRow.salesItemId, reservedQty: sumRow.reservedQty }));
    const deliveredByItemId = new Map(reservedAndConsumed.map((sumRow) => [sumRow.salesItemId, sumRow.consumedQty]));
    const deliveredStatus = computeDeliveredStatus(reservedItems, deliveredByItemId);

    const deliveredRows = await sumDeliveredQuantitiesByItem(tx, scope.companyId, salesId);
    const deliveredItems = deliveredRows.map((sumRow) => ({ id: sumRow.salesItemId, deliveredQty: sumRow.deliveredQuantity }));
    const invoicedRows = await sumInvoicedQuantitiesByItem(tx, scope.companyId, salesId);
    const invoicedByItemId = new Map(invoicedRows.map((sumRow) => [sumRow.salesItemId, sumRow.invoicedQuantity]));
    const invoicedStatus = computeInvoicedStatus(deliveredItems, invoicedByItemId);

    await maybeAutoCloseSalesOrder(tx, scope.companyId, salesId, deliveredStatus, invoicedStatus);

    return row;
  });
}
