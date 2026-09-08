import { ConflictError, NotFoundError, UnauthorizedError } from "../../common/errors/index.js";
import type { RequestContext } from "../../common/context/request-context.js";
import { parseMoney } from "../../common/money/decimal.js";
import { insertAuditLog } from "../../core/audit/write.js";
import { reserveFromLot, releaseReservation } from "../../core/inventory-lots/reserve-allocate.js";
import type { PaginatedRows } from "../../core/masters/types.js";
import { nextNumber } from "../../core/numbering/next-number.js";
import { requireAtLeastOneValidLine } from "../../core/workflow/guards.js";
import { findTransition, runGuards, type WorkflowTransition } from "../../core/workflow/transitions.js";
import { withTenantDb, type TenantTx } from "../../database/get-db.js";
import { findCustomerById } from "../customers/customers.repository.js";
import {
  hasAnyDeliveryForSales,
  sumDeliveredQuantitiesByItem,
  sumDeliveredQuantitiesByItemForSalesOrders,
  sumReservedAndConsumedBySalesItem,
  sumReservedAndConsumedBySalesItemForSalesOrders,
} from "./deliveries.repository.js";
import { hasAnyInvoiceForSales, sumInvoicedQuantitiesByItem, sumInvoicedQuantitiesByItemForSalesOrders } from "./sales-invoices.repository.js";
import { sumOutstandingReceivablesForCustomer, sumPaidAmountsByInvoiceForSalesOrders } from "./sales-payments-received.repository.js";
import {
  computeDeliveredStatus,
  computeInvoicedStatus,
  computePaidStatus,
  computeRealized,
  type DeliveredStatus,
  type InvoicedStatus,
  type PaidStatus,
} from "./sales-lifecycle.js";
import { findCostsBySalesId, type SalesAdditionalCostsRow } from "./sales-costs.repository.js";
import { listLotsForSales, listLotsForSalesItem, updateSalesItemLot, type SalesItemLotRow } from "./sales-item-lots.repository.js";
import { listItemsWithPricingForSales, type SalesItemWithPricing } from "./sales-items.repository.js";
import { listInvoicesForSalesOrders } from "./sales-invoices.repository.js";
import type { CreateSalesInput, SalesListQuery, UpdateSalesInput } from "./sales.validator.js";
import {
  findSalesById,
  findShipmentBySalesId,
  insertSales,
  insertSalesShipment,
  listSales,
  transitionSalesStatus,
  updateSales,
  updateSalesShipment,
  type SalesRow,
  type SalesShipmentRow,
} from "./sales.repository.js";

interface ApproveGuardContext {
  items: SalesItemWithPricing[];
  lotPicksByItemId: Map<string, SalesItemLotRow[]>;
}

/**
 * What makes one sales item "valid" to approve - domain-specific, mirrors
 * purchase.service.ts's validatePurchaseItemForApproval, plus a check
 * Purchase has no equivalent of: at least one lot must actually be picked.
 * Without this, approve()'s own reservation loop (which only ever
 * iterates whatever sales_item_lots rows exist) silently reserves
 * nothing for an unpicked item, and the sale transitions to "approved"
 * with zero real holds - the two-step model's whole point (Approval
 * RESERVES lot quantity) silently fails to happen. Caught via manual
 * testing: a sale approved with no lot picks at all, leaving Deliver's
 * own outstanding-qty table empty and misreporting "already fully
 * delivered" instead of "nothing was ever reserved."
 */
function validateSalesItemForApproval(item: SalesItemWithPricing, lotPicksByItemId: Map<string, SalesItemLotRow[]>): string | undefined {
  if (parseMoney(item.quantity).lte(0)) {
    return `Cannot approve: item ${item.id} has quantity ${item.quantity}, must be greater than 0`;
  }
  if (parseMoney(item.pricing.salesRateUsd).lte(0)) {
    return `Cannot approve: item ${item.id} has sales rate ${item.pricing.salesRateUsd}, must be greater than 0`;
  }
  if (parseMoney(item.pricing.exchangeRate).lte(0)) {
    return `Cannot approve: item ${item.id} has exchange rate ${item.pricing.exchangeRate}, must be greater than 0`;
  }
  if ((lotPicksByItemId.get(item.id) ?? []).length === 0) {
    return `Cannot approve: item ${item.id} has no stock lot picked - pick at least one lot before approving`;
  }
  return undefined;
}

/**
 * Draft -> Approved is the two-step model's step 1 (docs/SALES-MODULE-
 * PLAN.md §0): Approval RESERVES lot quantity (soft hold in the plan's own
 * words, but a REAL row-locked hold via core/inventory-lots' reserveFromLot
 * - "soft" there means "not yet a physical stock movement", not "not
 * enforced"). Guards run BEFORE any reservation is attempted, same
 * ordering discipline as Purchase's issue(). The reservation loop itself
 * happens inside approve() below, in the SAME transaction as the status
 * CAS update - see that function's own doc comment for why.
 */
const SALES_WORKFLOW: WorkflowTransition<SalesRow["status"], ApproveGuardContext>[] = [
  {
    name: "approve",
    from: "draft",
    to: "approved",
    permission: "sales.order.approve",
    guards: [
      (context) =>
        requireAtLeastOneValidLine(
          context.items,
          (item) => validateSalesItemForApproval(item, context.lotPicksByItemId),
          "Cannot approve: sales order has no items",
        ),
    ],
  },
];

/** Not a WorkflowTransition entry - mirrors purchase.service.ts's CANCELLABLE_FROM_STATUSES exactly (reachable from two starting states, which the engine's static from->to lookup can't model). */
const CANCELLABLE_FROM_STATUSES: ReadonlyArray<SalesRow["status"]> = ["draft", "approved"];

interface CancelGuardContext {
  hasAnyDelivery: boolean;
  hasAnyInvoice: boolean;
}

/**
 * Mirrors purchase.service.ts's requireNothingFulfilledForCancel exactly -
 * a real, previously-missing guard: cancel() had no check at all for
 * whether a delivery or invoice already existed against the sale, so a
 * sale could be cancelled after stock had physically shipped (Delivery)
 * or an invoice had been raised (financial fact already in motion),
 * leaving those documents orphaned against a cancelled parent. Caught in
 * manual testing: a cancelled sale still showing up under Invoices and on
 * the dashboard.
 */
function requireNothingFulfilledForCancel(context: CancelGuardContext): void {
  if (context.hasAnyDelivery) {
    throw new ConflictError("Cannot cancel: this sales order already has a delivery against it");
  }
  if (context.hasAnyInvoice) {
    throw new ConflictError("Cannot cancel: this sales order already has an invoice against it");
  }
}

export interface SalesWithShipment extends SalesRow {
  shipment: SalesShipmentRow;
  items?: SalesItemWithLots[];
  additionalCosts?: SalesAdditionalCostsRow | undefined;
  /** Non-blocking, informational only (docs/SALES-MODULE-PLAN.md's locked decision: WARN, never hard-block). Present on the approve() response when this sale would push the customer's outstanding receivables over their creditLimit - see computeCreditExposure's own doc comment for exactly what this does and does not represent. */
  warnings?: string[];
  /** S-4: derived from stock_lot_reservations (reserved vs consumed), never stored - see sales-lifecycle.ts's own doc comment for why the denominator is reserved qty, not ordered qty. */
  deliveredStatus?: DeliveredStatus;
  /** deliveredStatus !== "not_delivered" - the plan's own "realized profit flips true on delivery" trigger. */
  realized?: boolean;
  /** S-5: derived from sales_invoice_items (invoiced vs delivered), never stored - see sales-lifecycle.ts's computeInvoicedStatus doc comment for why the denominator is delivered qty, not ordered or reserved qty. */
  invoicedStatus?: InvoicedStatus;
  /** S-5: derived from sales_payment_allocations against each invoice's own amount, never stored - mirrors purchase.service.ts's paidStatus exactly. */
  paidStatus?: PaidStatus;
}

/** S-3/S-4/S-5: the Sales Order list's own row shape - mirrors purchase.service.ts's PurchaseRowWithFulfilment. */
export interface SalesRowWithFulfilmentStatus extends SalesRow {
  deliveredStatus: DeliveredStatus;
  realized: boolean;
  invoicedStatus: InvoicedStatus;
  paidStatus: PaidStatus;
}

export interface SalesItemWithLots extends SalesItemWithPricing {
  lots: SalesItemLotRow[];
  /** S-4: this item's own reserved-vs-consumed figures (stock_lot_reservations, excluding released) - "0" when nothing has been reserved yet (e.g. a still-Draft sale). Drives SalesFulfilmentPanels.tsx's Deliver form outstanding-qty cap. */
  reservedQty: string;
  consumedQty: string;
  /** S-5: this item's own delivered-vs-invoiced figures - "0" when nothing has shipped/been invoiced yet. Drives SalesReceivablesPanels.tsx's Invoice form outstanding-qty cap. */
  deliveredQty: string;
  invoicedQty: string;
}

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

/** Server-derived from loadingDate's calendar year, never user-entered - mirrors purchase.service.ts's deriveShipmentYear exactly (same slicing-not-parsing reasoning). */
function deriveShipmentYear(loadingDate: string): number {
  return Number(loadingDate.slice(0, 4));
}

/** Rule 8, mirrors purchase.service.ts's assertDraft exactly. Exported: sales-items.service.ts/sales-item-lots.service.ts import assertItemsEditable below, and sales-costs.service.ts imports this one directly (costs lock strictly at Draft, same as Purchase's). */
export function assertDraft(salesOrder: SalesRow): void {
  if (salesOrder.status !== "draft") {
    throw new ConflictError(`Sales order ${salesOrder.salesNumber} is ${salesOrder.status} and can no longer be edited`);
  }
}

/**
 * Items/lot-picks stay editable past Draft, through Approved - unlike the
 * header/costs lock assertDraft enforces. Mirrors purchase.service.ts's
 * assertItemsEditable, minus the "any receipt exists" branch (S-4/Delivery
 * doesn't exist yet - there is nothing that could have consumed a
 * reservation yet, so terminal-status is the only lock this phase needs).
 * Kept `tx`/`companyId` params (unused for now) and every call site kept
 * `await`ing this even though it's synchronous today, so S-4 can add a
 * real "has any delivery" DB check here later without touching any caller.
 */
export function assertItemsEditable(_tx: TenantTx, _companyId: string, salesOrder: SalesRow): void {
  if (salesOrder.status === "closed" || salesOrder.status === "cancelled") {
    throw new ConflictError(`Sales order ${salesOrder.salesNumber} is ${salesOrder.status} and can no longer be edited`);
  }
}

/**
 * S-5 (docs/adr/0028): now that real invoice/payment data exists, this
 * checks the customer's REAL outstanding receivables - the sum of every
 * approved, not-fully-paid sales invoice's own outstanding balance
 * (invoiceAmountUsd - paid), plus this sale's own value (not yet invoiced,
 * so it isn't in that sum yet) - compared against customers.creditLimit.
 * Before S-5 this summed "other approved sales orders' value" instead
 * (S-3 ADR 0026's own documented stopgap, since no receivables existed
 * yet). WARN only (docs/SALES-MODULE-PLAN.md's locked decision, unchanged)
 * - this function never throws, it only returns a warning string or
 * undefined; the caller decides whether/how to surface it, and approval
 * proceeds either way.
 */
function computeCreditExposure(input: { creditLimit: string; outstandingReceivables: string; thisSaleValue: string; customerName: string }): string | undefined {
  const exposure = parseMoney(input.outstandingReceivables).plus(input.thisSaleValue);
  const limit = parseMoney(input.creditLimit);
  if (limit.gt(0) && exposure.gt(limit)) {
    return `This sale would bring ${input.customerName}'s outstanding receivables to ${exposure.toString()}, over their credit limit of ${limit.toString()}. This reflects this sale plus their existing unpaid/partially-paid invoices - allowed, not blocked.`;
  }
  return undefined;
}

/**
 * S-4/S-5: batched, not per-row - a handful of extra queries, each scoped
 * to just the sales IDs on THIS page, then computeDeliveredStatus/
 * computeInvoicedStatus/computePaidStatus all run per row from in-memory
 * Map lookups - mirrors purchase.service.ts's own list() batching
 * discipline (PL-4) exactly.
 */
export async function list(ctx: RequestContext, params: SalesListQuery): Promise<PaginatedRows<SalesRowWithFulfilmentStatus>> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, async (tx) => {
    const page = await listSales(tx, scope.companyId, params);
    const salesIds = page.items.map((row) => row.id);

    const reservedAndConsumedRows = await sumReservedAndConsumedBySalesItemForSalesOrders(tx, scope.companyId, salesIds);
    const reservedBySales = new Map<string, { reservedItems: { id: string; reservedQty: string }[]; deliveredByItemId: Map<string, string> }>();
    for (const row of reservedAndConsumedRows) {
      const bucket = reservedBySales.get(row.salesId) ?? { reservedItems: [], deliveredByItemId: new Map<string, string>() };
      bucket.reservedItems.push({ id: row.salesItemId, reservedQty: row.reservedQty });
      bucket.deliveredByItemId.set(row.salesItemId, row.consumedQty);
      reservedBySales.set(row.salesId, bucket);
    }

    const deliveredRows = await sumDeliveredQuantitiesByItemForSalesOrders(tx, scope.companyId, salesIds);
    const deliveredBySales = new Map<string, { id: string; deliveredQty: string }[]>();
    for (const row of deliveredRows) {
      const bucket = deliveredBySales.get(row.salesId) ?? [];
      bucket.push({ id: row.salesItemId, deliveredQty: row.deliveredQuantity });
      deliveredBySales.set(row.salesId, bucket);
    }

    const invoicedRows = await sumInvoicedQuantitiesByItemForSalesOrders(tx, scope.companyId, salesIds);
    const invoicedBySales = new Map<string, Map<string, string>>();
    for (const row of invoicedRows) {
      const bucket = invoicedBySales.get(row.salesId) ?? new Map<string, string>();
      bucket.set(row.salesItemId, row.invoicedQuantity);
      invoicedBySales.set(row.salesId, bucket);
    }

    const invoices = await listInvoicesForSalesOrders(tx, scope.companyId, salesIds);
    const invoicesBySales = new Map<string, { id: string; invoiceAmountUsd: string }[]>();
    for (const invoice of invoices) {
      const bucket = invoicesBySales.get(invoice.salesId) ?? [];
      bucket.push({ id: invoice.id, invoiceAmountUsd: invoice.invoiceAmountUsd });
      invoicesBySales.set(invoice.salesId, bucket);
    }

    const paidRows = await sumPaidAmountsByInvoiceForSalesOrders(tx, scope.companyId, salesIds);
    const paidBySales = new Map<string, Map<string, string>>();
    for (const row of paidRows) {
      const bucket = paidBySales.get(row.salesId) ?? new Map<string, string>();
      bucket.set(row.invoiceId, row.paidAmountUsd);
      paidBySales.set(row.salesId, bucket);
    }

    return {
      ...page,
      items: page.items.map((row) => {
        const reservedBucket = reservedBySales.get(row.id) ?? { reservedItems: [], deliveredByItemId: new Map<string, string>() };
        const deliveredStatus = computeDeliveredStatus(reservedBucket.reservedItems, reservedBucket.deliveredByItemId);
        const invoicedStatus = computeInvoicedStatus(deliveredBySales.get(row.id) ?? [], invoicedBySales.get(row.id) ?? new Map<string, string>());
        const paidStatus = computePaidStatus(invoicesBySales.get(row.id) ?? [], paidBySales.get(row.id) ?? new Map<string, string>());
        return {
          ...row,
          deliveredStatus,
          realized: computeRealized(deliveredStatus),
          invoicedStatus,
          paidStatus,
        };
      }),
    };
  });
}

export async function getById(ctx: RequestContext, id: string): Promise<SalesWithShipment> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, async (tx) => {
    const salesOrder = await findSalesById(tx, scope.companyId, id);
    if (!salesOrder) {
      throw new NotFoundError("Sales order not found");
    }
    const shipment = await findShipmentBySalesId(tx, scope.companyId, id);
    if (!shipment) {
      throw new Error(`Sales order ${id} has no shipment row - the 1:1 invariant was violated`);
    }
    const items = await listItemsWithPricingForSales(tx, scope.companyId, id);
    const lotsByItemId = new Map<string, SalesItemLotRow[]>();
    for (const item of items) {
      lotsByItemId.set(item.id, await listLotsForSalesItem(tx, scope.companyId, item.id));
    }
    const additionalCosts = await findCostsBySalesId(tx, scope.companyId, id);

    const reservedAndConsumed = await sumReservedAndConsumedBySalesItem(tx, scope.companyId, id);
    const reservedItems = reservedAndConsumed.map((row) => ({ id: row.salesItemId, reservedQty: row.reservedQty }));
    const deliveredByItemId = new Map(reservedAndConsumed.map((row) => [row.salesItemId, row.consumedQty]));
    const deliveredStatus = computeDeliveredStatus(reservedItems, deliveredByItemId);
    // Per-item figures too, not just the sale-level aggregate above -
    // SalesFulfilmentPanels.tsx's Deliver form needs each item's own
    // reservedQty/consumedQty to cap its outstanding-qty input, the same
    // way it already reads pricing/lots off each item.
    const reservedAndConsumedByItemId = new Map(reservedAndConsumed.map((row) => [row.salesItemId, row]));

    const deliveredRows = await sumDeliveredQuantitiesByItem(tx, scope.companyId, id);
    const deliveredItems = deliveredRows.map((row) => ({ id: row.salesItemId, deliveredQty: row.deliveredQuantity }));
    // Per-item deliveredQty too (not just the sale-level aggregate) -
    // SalesReceivablesPanels.tsx's Invoice form needs each item's own
    // delivered-minus-invoiced figure to cap its outstanding-qty input.
    const deliveredQtyByItemId = new Map(deliveredRows.map((row) => [row.salesItemId, row.deliveredQuantity]));
    const invoicedRows = await sumInvoicedQuantitiesByItem(tx, scope.companyId, id);
    const invoicedByItemId = new Map(invoicedRows.map((row) => [row.salesItemId, row.invoicedQuantity]));
    const invoicedStatus = computeInvoicedStatus(deliveredItems, invoicedByItemId);

    const invoicesForSale = await listInvoicesForSalesOrders(tx, scope.companyId, [id]);
    const invoicesForCompute = invoicesForSale.map((invoice) => ({ id: invoice.id, invoiceAmountUsd: invoice.invoiceAmountUsd }));
    const paidRows = await sumPaidAmountsByInvoiceForSalesOrders(tx, scope.companyId, [id]);
    const paidByInvoiceId = new Map(paidRows.map((row) => [row.invoiceId, row.paidAmountUsd]));
    const paidStatus = computePaidStatus(invoicesForCompute, paidByInvoiceId);

    return {
      ...salesOrder,
      shipment,
      items: items.map((item) => ({
        ...item,
        lots: lotsByItemId.get(item.id) ?? [],
        reservedQty: reservedAndConsumedByItemId.get(item.id)?.reservedQty ?? "0",
        consumedQty: reservedAndConsumedByItemId.get(item.id)?.consumedQty ?? "0",
        deliveredQty: deliveredQtyByItemId.get(item.id) ?? "0",
        invoicedQty: invoicedByItemId.get(item.id) ?? "0",
      })),
      additionalCosts,
      deliveredStatus,
      realized: computeRealized(deliveredStatus),
      invoicedStatus,
      paidStatus,
    };
  });
}

/** FR-101/FR-102/FR-103 mirror. */
export async function create(ctx: RequestContext, input: CreateSalesInput): Promise<SalesWithShipment> {
  const scope = requireTenantScope(ctx);
  const { shipment: shipmentInput, ...header } = input;

  return withTenantDb(ctx, async (tx) => {
    // Company-wide series (core/provisioning/seed-number-series.ts seeds
    // "SO" with no branch_id) - same reasoning as purchases' "PO" series:
    // not scoped by the sale's own branchId, a data field, not a
    // numbering axis.
    const salesNumber = await nextNumber(tx, {
      companyId: scope.companyId,
      docType: "SO",
      date: new Date(header.salesDate),
    });

    const salesOrder = await insertSales(tx, {
      ...header,
      salesNumber,
      companyId: scope.companyId,
      createdBy: scope.userId,
    });

    const shipment = await insertSalesShipment(tx, {
      ...shipmentInput,
      shipmentYear: deriveShipmentYear(shipmentInput.loadingDate),
      salesId: salesOrder.id,
      companyId: scope.companyId,
      createdBy: scope.userId,
    });

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "sales",
      entityId: salesOrder.id,
      action: "sales.created",
      after: { ...header, salesNumber, shipment: shipmentInput },
    });

    return { ...salesOrder, shipment };
  });
}

/** Header/shipment edits - Draft only (rule 8). Mirrors purchase.service.ts's update. */
export async function update(ctx: RequestContext, id: string, input: UpdateSalesInput): Promise<SalesWithShipment> {
  const scope = requireTenantScope(ctx);
  const { shipment: shipmentInput, ...header } = input;

  return withTenantDb(ctx, async (tx) => {
    const existing = await findSalesById(tx, scope.companyId, id);
    if (!existing) {
      throw new NotFoundError("Sales order not found");
    }
    assertDraft(existing);

    let salesOrder = existing;
    if (Object.keys(header).length > 0) {
      const updated = await updateSales(tx, scope.companyId, id, { ...header, updatedBy: scope.userId });
      if (!updated) {
        throw new NotFoundError("Sales order not found");
      }
      salesOrder = updated;
    }

    let shipment = await findShipmentBySalesId(tx, scope.companyId, id);
    if (!shipment) {
      throw new Error(`Sales order ${id} has no shipment row - the 1:1 invariant was violated`);
    }
    if (shipmentInput && Object.keys(shipmentInput).length > 0) {
      const loadingDate = shipmentInput.loadingDate ?? shipment.loadingDate;
      const updatedShipment = await updateSalesShipment(tx, scope.companyId, id, {
        ...shipmentInput,
        shipmentYear: deriveShipmentYear(loadingDate),
        updatedBy: scope.userId,
      });
      if (!updatedShipment) {
        throw new Error(`Sales order ${id} has no shipment row - the 1:1 invariant was violated`);
      }
      shipment = updatedShipment;
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "sales",
      entityId: id,
      action: "sales.updated",
      before: pick(existing, Object.keys(header)),
      after: pick(salesOrder, Object.keys(header)),
    });

    return { ...salesOrder, shipment };
  });
}

/**
 * Draft -> Approved: the two-step model's step 1. Guards run first
 * (requireAtLeastOneValidLine); the CAS status transition and the
 * per-lot-pick reservation loop happen in the SAME transaction, so a
 * ConflictError from ANY single reserveFromLot call (another sale won the
 * race for that lot's capacity between pick-time and approve-time) rolls
 * back the whole transaction - the status change AND every reservation
 * already made in this loop - never a partial reservation, exactly the
 * plan's own explicit requirement ("If any reservation fails ... the
 * whole approval rolls back with a clear error"). The credit-limit check
 * runs after a successful reservation (it's informational, never gates
 * the transaction) and is attached to the response as `warnings`, never
 * thrown.
 */
export async function approve(ctx: RequestContext, id: string): Promise<SalesWithShipment> {
  const scope = requireTenantScope(ctx);
  const transition = findTransition(SALES_WORKFLOW, "approve");

  return withTenantDb(ctx, async (tx) => {
    const existing = await findSalesById(tx, scope.companyId, id);
    if (!existing) {
      throw new NotFoundError("Sales order not found");
    }

    const shipment = await findShipmentBySalesId(tx, scope.companyId, id);
    if (!shipment) {
      throw new Error(`Sales order ${id} has no shipment row - the 1:1 invariant was violated`);
    }
    const items = await listItemsWithPricingForSales(tx, scope.companyId, id);
    const itemIds = items.map((item) => item.id);
    const lotPicks = await listLotsForSales(tx, scope.companyId, itemIds);
    const lotPicksByItemId = new Map<string, SalesItemLotRow[]>();
    for (const pick of lotPicks) {
      const bucket = lotPicksByItemId.get(pick.salesItemId) ?? [];
      bucket.push(pick);
      lotPicksByItemId.set(pick.salesItemId, bucket);
    }

    runGuards(transition, { items, lotPicksByItemId });

    const row = await transitionSalesStatus(tx, scope.companyId, id, {
      from: transition.from,
      to: transition.to,
      extra: { approvedBy: scope.userId, approvedAt: new Date() },
    });
    if (!row) {
      throw new ConflictError(`Sales order ${existing.salesNumber} is "${existing.status}", not "${transition.from}" - cannot approve`);
    }

    for (const pick of lotPicks) {
      const reservation = await reserveFromLot(tx, {
        lotId: pick.stockLotId,
        qty: pick.qty,
        referenceType: "sales_order_item",
        referenceId: pick.salesItemId,
        createdBy: scope.userId,
        ...(row.branchId ? { branchId: row.branchId } : {}),
      });
      await updateSalesItemLot(tx, scope.companyId, pick.id, { reservationId: reservation.id, updatedBy: scope.userId });
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "sales",
      entityId: id,
      action: "sales.approved",
      before: { status: existing.status },
      after: { status: row.status },
    });

    const warnings: string[] = [];
    const customer = await findCustomerById(tx, scope.companyId, row.customerId);
    if (customer) {
      const thisSaleValue = items.reduce((sum, item) => sum.plus(item.pricing.salesAmountUsd), parseMoney("0")).toString();
      const outstandingRows = await sumOutstandingReceivablesForCustomer(tx, scope.companyId, row.customerId);
      const outstandingReceivables = outstandingRows
        .reduce((sum, invoice) => sum.plus(parseMoney(invoice.invoiceAmountUsd).minus(invoice.paidAmountUsd)), parseMoney("0"))
        .toString();
      const warning = computeCreditExposure({
        creditLimit: customer.creditLimit,
        outstandingReceivables,
        thisSaleValue,
        customerName: customer.name,
      });
      if (warning) {
        warnings.push(warning);
      }
    }

    return { ...row, shipment, warnings };
  });
}

/**
 * Draft or Approved -> Cancelled. Cancelling an Approved sale releases
 * every reservation its lot picks hold (releaseReservation, per pick, in
 * the SAME transaction as the status change) - the two-step model's own
 * symmetry: what Approve reserves, Cancel gives back. A reservation that
 * was never made (still Draft, reservationId null on every pick) has
 * nothing to release, so this is a no-op loop over zero rows in that case.
 */
export async function cancel(ctx: RequestContext, id: string): Promise<SalesRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const existing = await findSalesById(tx, scope.companyId, id);
    if (!existing) {
      throw new NotFoundError("Sales order not found");
    }
    if (!CANCELLABLE_FROM_STATUSES.includes(existing.status)) {
      throw new ConflictError(`Sales order ${existing.salesNumber} is "${existing.status}" - cannot cancel`);
    }

    const hasAnyDelivery = await hasAnyDeliveryForSales(tx, scope.companyId, id);
    const hasAnyInvoice = await hasAnyInvoiceForSales(tx, scope.companyId, id);
    requireNothingFulfilledForCancel({ hasAnyDelivery, hasAnyInvoice });

    const items = await listItemsWithPricingForSales(tx, scope.companyId, id);
    const itemIds = items.map((item) => item.id);
    const lotPicks = await listLotsForSales(tx, scope.companyId, itemIds);
    for (const pick of lotPicks) {
      if (pick.reservationId) {
        await releaseReservation(tx, pick.reservationId);
      }
    }

    const row = await transitionSalesStatus(tx, scope.companyId, id, {
      from: existing.status,
      to: "cancelled",
      extra: { cancelledBy: scope.userId, cancelledAt: new Date() },
    });
    if (!row) {
      throw new ConflictError(`Sales order ${existing.salesNumber} is "${existing.status}" - cannot cancel`);
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "sales",
      entityId: id,
      action: "sales.cancelled",
      before: { status: existing.status },
      after: { status: row.status },
    });

    return row;
  });
}

function pick(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    result[key] = source[key];
  }
  return result;
}
