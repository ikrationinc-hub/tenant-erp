import type { RequestContext } from "../../common/context/request-context.js";
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from "../../common/errors/index.js";
import { parseMoney, roundRate } from "../../common/money/decimal.js";
import { insertAuditLog } from "../../core/audit/write.js";
import { consumeReservation } from "../../core/inventory-lots/reserve-allocate.js";
import type { PaginatedRows } from "../../core/masters/types.js";
import { requireAtLeastOneValidLine } from "../../core/workflow/guards.js";
import { findTransition, runGuards, type WorkflowTransition } from "../../core/workflow/transitions.js";
import { nextNumber } from "../../core/numbering/next-number.js";
import { withTenantDb } from "../../database/get-db.js";
import {
  findDeliveryById,
  insertDelivery,
  insertDeliveryItem,
  listActiveReservationsForSalesItem,
  listAllDeliveries,
  listDeliveriesForSales,
  listItemsForDelivery,
  sumReservedAndConsumedBySalesItem,
  transitionDeliveryStatus,
  type DeliveriesListParams,
  type DeliveryItemRow,
  type DeliveryRow,
  type DeliveryWithSalesNumber,
} from "./deliveries.repository.js";
import type { CreateDeliveryInput } from "./deliveries.validator.js";
import { findSalesById } from "./sales.repository.js";

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

interface ConfirmGuardContext {
  items: DeliveryItemRow[];
}

function validateDeliveryItemForConfirm(item: DeliveryItemRow): string | undefined {
  if (parseMoney(item.deliveredQuantity).lte(0)) {
    return `Cannot confirm: item ${item.id} has deliveredQuantity ${item.deliveredQuantity}, must be greater than 0`;
  }
  return undefined;
}

/** Draft -> Confirmed only, mirrors purchase-receipts.service.ts's PURCHASE_RECEIPT_WORKFLOW exactly - a delivery, once confirmed, is immutable (rule 8); there is no re-confirm/edit path. */
const DELIVERY_WORKFLOW: WorkflowTransition<DeliveryRow["status"], ConfirmGuardContext>[] = [
  {
    name: "confirm",
    from: "draft",
    to: "confirmed",
    permission: "sales.delivery.confirm",
    guards: [(context) => requireAtLeastOneValidLine(context.items, validateDeliveryItemForConfirm, "Cannot confirm: delivery has no items")],
  },
];

export interface DeliveryWithItems extends DeliveryRow {
  items: DeliveryItemRow[];
}

/** The standalone "Deliveries" list screen's own endpoint - cross-sale, paginated + filtered server-side (rule 10). Mirrors purchase-receipts.service.ts's listAll. */
export async function listAll(ctx: RequestContext, params: DeliveriesListParams): Promise<PaginatedRows<DeliveryWithSalesNumber>> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, (tx) => listAllDeliveries(tx, scope.companyId, params));
}

export async function list(ctx: RequestContext, salesId: string): Promise<DeliveryWithItems[]> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, async (tx) => {
    const rows = await listDeliveriesForSales(tx, scope.companyId, salesId);
    const withItems: DeliveryWithItems[] = [];
    for (const delivery of rows) {
      const items = await listItemsForDelivery(tx, scope.companyId, delivery.id);
      withItems.push({ ...delivery, items });
    }
    return withItems;
  });
}

/**
 * Create is Draft-only output (no confirm here) - mirrors purchase-
 * receipts.service.ts's create() exactly: a delivery starts life as a
 * real row with real lines, but consumes NO reservation until a separate
 * confirm call. Over-delivery is checked at CREATE time too, not only
 * confirm, so a user gets the rejection immediately. The guard reads
 * sumReservedAndConsumedBySalesItem (backed by stock_lot_reservations'
 * own consumedQty counter) rather than summing this sale's OWN delivery_
 * items, since a concurrent delivery against the same sale could exist -
 * the authoritative "how much is left" figure lives on the reservation
 * itself, not derived from this document's own history.
 */
export async function create(ctx: RequestContext, salesId: string, input: CreateDeliveryInput): Promise<DeliveryWithItems> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const salesOrder = await findSalesById(tx, scope.companyId, salesId);
    if (!salesOrder) {
      throw new NotFoundError("Sales order not found");
    }
    if (salesOrder.status !== "approved") {
      throw new ConflictError(`Cannot deliver against a sales order that is "${salesOrder.status}" - it must be approved first`);
    }

    const reservedAndConsumed = await sumReservedAndConsumedBySalesItem(tx, scope.companyId, salesId);
    const bySalesItemId = new Map(reservedAndConsumed.map((row) => [row.salesItemId, row]));

    for (const line of input.items) {
      const requestedQuantity = parseMoney(line.deliveredQuantity);
      if (requestedQuantity.lte(0)) {
        throw new ValidationError(`deliveredQuantity for item ${line.salesItemId} must be greater than 0`);
      }
      const figures = bySalesItemId.get(line.salesItemId);
      if (!figures) {
        throw new ValidationError(`Sales item ${line.salesItemId} has no active reservation on this sale - nothing to deliver`);
      }
      const remaining = parseMoney(figures.reservedQty).minus(figures.consumedQty);
      if (requestedQuantity.gt(remaining)) {
        throw new ConflictError(
          `Cannot deliver ${requestedQuantity.toString()} of item ${line.salesItemId}: only ${remaining.toString()} remains reserved-and-undelivered (reserved ${figures.reservedQty}, already delivered ${figures.consumedQty})`,
        );
      }
    }

    // Company-wide series (core/provisioning/seed-number-series.ts seeds
    // "DELIVERY" with no branch_id) - same reasoning as PO/SO/PURCHASE_
    // RECEIPT: not scoped by the delivery's own branchId, a data field,
    // not a numbering axis.
    const deliveryOrderNo = await nextNumber(tx, {
      companyId: scope.companyId,
      docType: "DELIVERY",
      date: new Date(input.dispatchDate),
    });

    const { items: itemsInput, ...header } = input;
    const delivery = await insertDelivery(tx, {
      ...header,
      ...(salesOrder.branchId ? { branchId: salesOrder.branchId } : {}),
      companyId: scope.companyId,
      salesId,
      deliveryOrderNo,
      createdBy: scope.userId,
    });

    const items: DeliveryItemRow[] = [];
    for (const line of itemsInput) {
      const item = await insertDeliveryItem(tx, {
        deliveryId: delivery.id,
        companyId: scope.companyId,
        salesItemId: line.salesItemId,
        deliveredQuantity: roundRate(parseMoney(line.deliveredQuantity)),
        createdBy: scope.userId,
      });
      items.push(item);
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "delivery",
      entityId: delivery.id,
      action: "delivery.created",
      after: { deliveryOrderNo, salesId, dispatchDate: delivery.dispatchDate, warehouseId: delivery.warehouseId, items: input.items },
    });

    return { ...delivery, items };
  });
}

/**
 * THE stock-writing transition (S-4, docs/SALES-MODULE-PLAN.md) - mirrors
 * purchase-receipts.service.ts's confirm() exactly, substituting
 * consumeReservation for the receipt's own direct insertStockMovement
 * call, since S-2 already built and tested that exact mechanism. A single
 * delivery line's salesItemId may span MULTIPLE reservations (several
 * lots picked for one line) - this consumes across them in creation
 * order (oldest reservation first) until the line's own deliveredQuantity
 * is exhausted, all inside the SAME transaction as the Draft->Confirmed
 * status change. Any consumeReservation failure (only possible if a
 * concurrent delivery against the same sale raced past the create-time
 * check) rolls back the whole confirm - no partial consumption, no
 * partial status change, same "all-or-nothing" contract S-3's own
 * approve() established for reserveFromLot.
 */
export async function confirm(ctx: RequestContext, salesId: string, deliveryId: string): Promise<DeliveryWithItems> {
  const scope = requireTenantScope(ctx);
  const transition = findTransition(DELIVERY_WORKFLOW, "confirm");

  return withTenantDb(ctx, async (tx) => {
    const salesOrder = await findSalesById(tx, scope.companyId, salesId);
    if (!salesOrder) {
      throw new NotFoundError("Sales order not found");
    }
    const existing = await findDeliveryById(tx, scope.companyId, salesId, deliveryId);
    if (!existing) {
      throw new NotFoundError("Delivery not found");
    }
    const items = await listItemsForDelivery(tx, scope.companyId, deliveryId);

    runGuards(transition, { items });

    const row = await transitionDeliveryStatus(tx, scope.companyId, deliveryId, {
      from: transition.from,
      to: transition.to,
      extra: { confirmedBy: scope.userId, confirmedAt: new Date() },
    });
    if (!row) {
      throw new ConflictError(`Delivery ${existing.deliveryOrderNo} is "${existing.status}", not "${transition.from}" - cannot confirm`);
    }

    for (const item of items) {
      let remainingToConsume = parseMoney(item.deliveredQuantity);
      const reservations = await listActiveReservationsForSalesItem(tx, scope.companyId, item.salesItemId);
      for (const reservation of reservations) {
        if (remainingToConsume.lte(0)) {
          break;
        }
        const reservationRemaining = parseMoney(reservation.qty).minus(reservation.consumedQty);
        if (reservationRemaining.lte(0)) {
          continue;
        }
        const toConsume = remainingToConsume.lt(reservationRemaining) ? remainingToConsume : reservationRemaining;
        await consumeReservation(tx, reservation.reservationId, {
          qty: roundRate(toConsume),
          movementDate: row.dispatchDate,
          createdBy: scope.userId,
        });
        remainingToConsume = remainingToConsume.minus(toConsume);
      }
      if (remainingToConsume.gt(0)) {
        throw new ConflictError(
          `Delivery item ${item.id} (sales item ${item.salesItemId}) could not be fully consumed against its reservations - ${remainingToConsume.toString()} remains unaccounted for. Another delivery may have consumed this sales item's reservation concurrently.`,
        );
      }
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "delivery",
      entityId: deliveryId,
      action: "delivery.confirmed",
      before: { status: existing.status },
      after: { status: row.status },
    });

    return { ...row, items };
  });
}
