import { eventBus } from "../../common/events/bus.js";
import type { RequestContext } from "../../common/context/request-context.js";
import { ConflictError, NotFoundError, UnauthorizedError } from "../../common/errors/index.js";
import { insertAuditLog } from "../../core/audit/write.js";
import type { PaginatedRows } from "../../core/masters/types.js";
import { nextNumber } from "../../core/numbering/next-number.js";
import { findTransition, type WorkflowTransition } from "../../core/workflow/transitions.js";
import { withTenantDb } from "../../database/get-db.js";
import type { CreatePurchaseInput, PurchasesListQuery, UpdatePurchaseInput } from "./purchase.validator.js";
import { listAllocationsForPurchase, type PurchaseAllocationRow } from "./purchase-allocations.repository.js";
import { findCostsByPurchaseId, type PurchaseAdditionalCostsRow } from "./purchase-costs.repository.js";
import { listHedgesForPurchase, type HedgeRow } from "./purchase-hedges.repository.js";
import { listItemsWithPricingForPurchase, type PurchaseItemWithPricing } from "./purchase-items.repository.js";
import { listLmeRecordsForPurchase, type LmeRecordRow } from "./purchase-lme.repository.js";
import {
  findPurchaseById,
  findShipmentByPurchaseId,
  insertPurchase,
  insertPurchaseShipment,
  listPurchases,
  transitionPurchaseStatus,
  updatePurchase,
  updatePurchaseShipment,
  type PurchaseRow,
  type PurchaseShipmentRow,
} from "./purchase.repository.js";

/** FR-107/FR-108: Draft -> Approved -> Posted, each transition its own permission (core/workflow/transitions.ts). */
const PURCHASE_WORKFLOW: WorkflowTransition<PurchaseRow["status"]>[] = [
  { name: "approve", from: "draft", to: "approved", permission: "purchase.po.approve" },
  { name: "post", from: "approved", to: "posted", permission: "purchase.po.post" },
];

export interface PurchaseWithShipment extends PurchaseRow {
  shipment: PurchaseShipmentRow;
  /** Session (b): populated on getById, omitted (undefined) on create/update's response - those return before any item exists yet or without re-querying the full item list. */
  items?: PurchaseItemWithPricing[];
  /** Session (c): same convention as `items` - populated on getById only. */
  allocations?: PurchaseAllocationRow[];
  /** Session (c): undefined until the first PATCH .../costs (no row exists yet), not just an empty/zeroed object. */
  additionalCosts?: PurchaseAdditionalCostsRow | undefined;
  /** Session (d): same convention as `items`/`allocations` - populated on getById only. */
  lmeRecords?: LmeRecordRow[];
  hedges?: HedgeRow[];
}

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

/** Open question #7, resolved: never user-entered, always the calendar year of Loading Date. A plain substring, not `new Date(...).getFullYear()` - `loadingDate` is already a validated "YYYY-MM-DD" string and slicing it avoids any timezone-parsing risk entirely. */
function deriveShipmentYear(loadingDate: string): number {
  return Number(loadingDate.slice(0, 4));
}

/** Rule 8, enforced now even though nothing in this session can move a purchase off "draft" yet - the workflow engine (session (e)) adds the transitions, this guard is what makes them actually immutable-after-post from day one. Exported: purchase-items.service.ts (session (b)'s item/pricing edits) enforces the exact same guard against the item's parent purchase. */
export function assertDraft(purchase: PurchaseRow): void {
  if (purchase.status !== "draft") {
    throw new ConflictError(`Purchase ${purchase.purchaseNumber} is ${purchase.status} and can no longer be edited`);
  }
}

export async function list(ctx: RequestContext, params: PurchasesListQuery): Promise<PaginatedRows<PurchaseRow>> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, (tx) => listPurchases(tx, scope.companyId, params));
}

export async function getById(ctx: RequestContext, id: string): Promise<PurchaseWithShipment> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, async (tx) => {
    const purchase = await findPurchaseById(tx, scope.companyId, id);
    if (!purchase) {
      throw new NotFoundError("Purchase not found");
    }
    const shipment = await findShipmentByPurchaseId(tx, scope.companyId, id);
    if (!shipment) {
      throw new Error(`Purchase ${id} has no shipment row - the 1:1 invariant was violated`);
    }
    const items = await listItemsWithPricingForPurchase(tx, scope.companyId, id);
    const allocations = await listAllocationsForPurchase(tx, scope.companyId, id);
    const additionalCosts = await findCostsByPurchaseId(tx, scope.companyId, id);
    const lmeRecords = await listLmeRecordsForPurchase(tx, scope.companyId, id);
    const hedges = await listHedgesForPurchase(tx, scope.companyId, id);
    return { ...purchase, shipment, items, allocations, additionalCosts, lmeRecords, hedges };
  });
}

/** FR-101/FR-102/FR-103. */
export async function create(ctx: RequestContext, input: CreatePurchaseInput): Promise<PurchaseWithShipment> {
  const scope = requireTenantScope(ctx);
  const { shipment: shipmentInput, ...header } = input;

  return withTenantDb(ctx, async (tx) => {
    // Company-wide series (core/provisioning/seed-number-series.ts seeds "PO"
    // with no branch_id) - deliberately not scoped by the purchase's own
    // branchId, which is a data field on the document, not a numbering axis.
    const purchaseNumber = await nextNumber(tx, {
      companyId: scope.companyId,
      docType: "PO",
      date: new Date(header.purchaseDate),
    });

    const purchase = await insertPurchase(tx, {
      ...header,
      purchaseNumber,
      companyId: scope.companyId,
      createdBy: scope.userId,
    });

    const shipment = await insertPurchaseShipment(tx, {
      ...shipmentInput,
      shipmentYear: deriveShipmentYear(shipmentInput.loadingDate),
      purchaseId: purchase.id,
      companyId: scope.companyId,
      createdBy: scope.userId,
    });

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "purchase",
      entityId: purchase.id,
      action: "purchase.created",
      after: { ...header, purchaseNumber, shipment: shipmentInput },
    });

    return { ...purchase, shipment };
  });
}

/** FR-103 (edit shipment info)/general header edits - Draft only (rule 8). */
export async function update(ctx: RequestContext, id: string, input: UpdatePurchaseInput): Promise<PurchaseWithShipment> {
  const scope = requireTenantScope(ctx);
  const { shipment: shipmentInput, ...header } = input;

  return withTenantDb(ctx, async (tx) => {
    const existing = await findPurchaseById(tx, scope.companyId, id);
    if (!existing) {
      throw new NotFoundError("Purchase not found");
    }
    assertDraft(existing);

    let purchase = existing;
    if (Object.keys(header).length > 0) {
      const updated = await updatePurchase(tx, scope.companyId, id, { ...header, updatedBy: scope.userId });
      if (!updated) {
        throw new NotFoundError("Purchase not found");
      }
      purchase = updated;
    }

    let shipment = await findShipmentByPurchaseId(tx, scope.companyId, id);
    if (!shipment) {
      throw new Error(`Purchase ${id} has no shipment row - the 1:1 invariant was violated`);
    }
    if (shipmentInput && Object.keys(shipmentInput).length > 0) {
      const loadingDate = shipmentInput.loadingDate ?? shipment.loadingDate;
      const updatedShipment = await updatePurchaseShipment(tx, scope.companyId, id, {
        ...shipmentInput,
        shipmentYear: deriveShipmentYear(loadingDate),
        updatedBy: scope.userId,
      });
      if (!updatedShipment) {
        throw new Error(`Purchase ${id} has no shipment row - the 1:1 invariant was violated`);
      }
      shipment = updatedShipment;
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "purchase",
      entityId: id,
      action: "purchase.updated",
      before: pick(existing, Object.keys(header)),
      after: pick(purchase, Object.keys(header)),
    });

    return { ...purchase, shipment };
  });
}

/**
 * FR-107/FR-108. Resolved open question #10: stock moves at Approved, not
 * Posted - `purchase.approved` fires (and the inventory subscriber writes
 * stock_movements) in the SAME transaction as this status change
 * (common/events/bus.ts). `transitionPurchaseStatus`'s conditional UPDATE
 * is what makes "two concurrent approvals -> exactly one succeeds" true:
 * the loser's UPDATE matches zero rows (status has already moved on) and
 * this function reports that as a 409, never a silent no-op success.
 */
export async function approve(ctx: RequestContext, id: string): Promise<PurchaseRow> {
  const scope = requireTenantScope(ctx);
  const transition = findTransition(PURCHASE_WORKFLOW, "approve");

  return withTenantDb(ctx, async (tx) => {
    const existing = await findPurchaseById(tx, scope.companyId, id);
    if (!existing) {
      throw new NotFoundError("Purchase not found");
    }

    const shipment = await findShipmentByPurchaseId(tx, scope.companyId, id);
    if (!shipment) {
      throw new Error(`Purchase ${id} has no shipment row - the 1:1 invariant was violated`);
    }
    const items = await listItemsWithPricingForPurchase(tx, scope.companyId, id);

    const row = await transitionPurchaseStatus(tx, scope.companyId, id, {
      from: transition.from,
      to: transition.to,
      extra: { approvedBy: scope.userId, approvedAt: new Date() },
    });
    if (!row) {
      throw new ConflictError(`Purchase ${existing.purchaseNumber} is "${existing.status}", not "${transition.from}" - cannot approve`);
    }

    await eventBus.emit(tx, "purchase.approved", {
      purchaseId: id,
      companyId: scope.companyId,
      branchId: row.branchId,
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
      entity: "purchase",
      entityId: id,
      action: "purchase.approved",
      before: { status: existing.status },
      after: { status: row.status },
    });

    return row;
  });
}

/** FR-107's third state. Resolved open question #10: purely an accounting lock (rule 8) on top of Approved - no inventory effect of its own. */
export async function post(ctx: RequestContext, id: string): Promise<PurchaseRow> {
  const scope = requireTenantScope(ctx);
  const transition = findTransition(PURCHASE_WORKFLOW, "post");

  return withTenantDb(ctx, async (tx) => {
    const existing = await findPurchaseById(tx, scope.companyId, id);
    if (!existing) {
      throw new NotFoundError("Purchase not found");
    }

    const row = await transitionPurchaseStatus(tx, scope.companyId, id, { from: transition.from, to: transition.to });
    if (!row) {
      throw new ConflictError(`Purchase ${existing.purchaseNumber} is "${existing.status}", not "${transition.from}" - cannot post`);
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "purchase",
      entityId: id,
      action: "purchase.posted",
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
