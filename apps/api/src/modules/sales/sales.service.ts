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
import { findCostsBySalesId, type SalesAdditionalCostsRow } from "./sales-costs.repository.js";
import { listLotsForSales, listLotsForSalesItem, updateSalesItemLot, type SalesItemLotRow } from "./sales-item-lots.repository.js";
import { listItemsWithPricingForSales, type SalesItemWithPricing } from "./sales-items.repository.js";
import type { CreateSalesInput, SalesListQuery, UpdateSalesInput } from "./sales.validator.js";
import {
  findSalesById,
  findShipmentBySalesId,
  insertSales,
  insertSalesShipment,
  listSales,
  sumApprovedSalesValueForCustomer,
  transitionSalesStatus,
  updateSales,
  updateSalesShipment,
  type SalesRow,
  type SalesShipmentRow,
} from "./sales.repository.js";

interface ApproveGuardContext {
  items: SalesItemWithPricing[];
}

/** What makes one sales item "valid" to approve - domain-specific, mirrors purchase.service.ts's validatePurchaseItemForApproval. */
function validateSalesItemForApproval(item: SalesItemWithPricing): string | undefined {
  if (parseMoney(item.quantity).lte(0)) {
    return `Cannot approve: item ${item.id} has quantity ${item.quantity}, must be greater than 0`;
  }
  if (parseMoney(item.pricing.salesRateUsd).lte(0)) {
    return `Cannot approve: item ${item.id} has sales rate ${item.pricing.salesRateUsd}, must be greater than 0`;
  }
  if (parseMoney(item.pricing.exchangeRate).lte(0)) {
    return `Cannot approve: item ${item.id} has exchange rate ${item.pricing.exchangeRate}, must be greater than 0`;
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
    guards: [(context) => requireAtLeastOneValidLine(context.items, validateSalesItemForApproval, "Cannot approve: sales order has no items")],
  },
];

/** Not a WorkflowTransition entry - mirrors purchase.service.ts's CANCELLABLE_FROM_STATUSES exactly (reachable from two starting states, which the engine's static from->to lookup can't model). */
const CANCELLABLE_FROM_STATUSES: ReadonlyArray<SalesRow["status"]> = ["draft", "approved"];

export interface SalesWithShipment extends SalesRow {
  shipment: SalesShipmentRow;
  items?: SalesItemWithLots[];
  additionalCosts?: SalesAdditionalCostsRow | undefined;
  /** Non-blocking, informational only (docs/SALES-MODULE-PLAN.md's locked decision: WARN, never hard-block). Present on the approve() response when this sale would push the customer's open-order exposure over their creditLimit - see computeCreditExposure's own doc comment for exactly what this does and does not represent. */
  warnings?: string[];
}

export interface SalesItemWithLots extends SalesItemWithPricing {
  lots: SalesItemLotRow[];
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
 * The "open order exposure" proxy the plan's own §4 leaves as an
 * unresolved client question (outstanding receivables vs outstanding +
 * open orders) - resolved for THIS phase as: this sale's own value plus
 * the sum of the customer's OTHER currently-approved sales orders'
 * salesAmountUsd, compared against customers.creditLimit. This is
 * deliberately NOT "outstanding receivables" - there is no invoice/
 * payment data at all until S-5 exists, so nothing today can represent a
 * true receivable balance. WARN only (docs/SALES-MODULE-PLAN.md's locked
 * decision) - this function never throws, it only returns a warning
 * string or undefined; the caller decides whether/how to surface it, and
 * approval proceeds either way.
 */
function computeCreditExposure(input: { creditLimit: string; otherApprovedValue: string; thisSaleValue: string; customerName: string }): string | undefined {
  const exposure = parseMoney(input.otherApprovedValue).plus(input.thisSaleValue);
  const limit = parseMoney(input.creditLimit);
  if (limit.gt(0) && exposure.gt(limit)) {
    return `This sale would bring ${input.customerName}'s open Sales Order value to ${exposure.toString()}, over their credit limit of ${limit.toString()}. This reflects open orders only, not full outstanding receivables (payment tracking isn't built yet) - allowed, not blocked.`;
  }
  return undefined;
}

export async function list(ctx: RequestContext, params: SalesListQuery): Promise<PaginatedRows<SalesRow>> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, (tx) => listSales(tx, scope.companyId, params));
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

    return {
      ...salesOrder,
      shipment,
      items: items.map((item) => ({ ...item, lots: lotsByItemId.get(item.id) ?? [] })),
      additionalCosts,
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

    runGuards(transition, { items });

    const row = await transitionSalesStatus(tx, scope.companyId, id, {
      from: transition.from,
      to: transition.to,
      extra: { approvedBy: scope.userId, approvedAt: new Date() },
    });
    if (!row) {
      throw new ConflictError(`Sales order ${existing.salesNumber} is "${existing.status}", not "${transition.from}" - cannot approve`);
    }

    const itemIds = items.map((item) => item.id);
    const lotPicks = await listLotsForSales(tx, scope.companyId, itemIds);
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
      const otherApprovedValue = await sumApprovedSalesValueForCustomer(tx, scope.companyId, row.customerId, id);
      const warning = computeCreditExposure({
        creditLimit: customer.creditLimit,
        otherApprovedValue,
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
