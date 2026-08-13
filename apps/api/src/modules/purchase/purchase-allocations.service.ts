import type { RequestContext } from "../../common/context/request-context.js";
import { NotFoundError, UnauthorizedError, ValidationError } from "../../common/errors/index.js";
import { parseMoney, roundRate } from "../../common/money/decimal.js";
import { insertAuditLog } from "../../core/audit/write.js";
import { withTenantDb } from "../../database/get-db.js";
import {
  findAllocationById,
  insertAllocation,
  softDeleteAllocation,
  updateAllocation,
  type PurchaseAllocationRow,
} from "./purchase-allocations.repository.js";
import type { AddAllocationInput, UpdateAllocationInput } from "./purchase-allocations.validator.js";
import { findPurchaseById } from "./purchase.repository.js";
import { assertDraft } from "./purchase.service.js";

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

/**
 * Sub Tab 2, table F. Draft only (rule 8). Prompt 21 item 6: allocation is
 * a SOFT reservation - the client confirmed the eventual sale is NOT
 * bound to it and may go to a different customer entirely. There is
 * deliberately no sum-to-100/over-allocation block (an earlier prompt's
 * hard >100% rejection was relaxed here) - the running total is still
 * computed and returned so the UI can show it, but it never rejects a
 * request. A single allocation still can't exceed 100% or be <= 0 on its
 * own (a basic sanity bound on one row, not the cross-row constraint that
 * was removed). See docs/adr/0013-allocation-is-soft-reservation.md -
 * Sales must never treat an allocation as binding.
 */
export async function addAllocation(ctx: RequestContext, purchaseId: string, input: AddAllocationInput): Promise<PurchaseAllocationRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const purchase = await findPurchaseById(tx, scope.companyId, purchaseId);
    if (!purchase) {
      throw new NotFoundError("Purchase not found");
    }
    assertDraft(purchase);

    const pct = parseMoney(input.allocationPct);
    if (pct.lte(0) || pct.gt(100)) {
      throw new ValidationError("allocationPct must be greater than 0 and at most 100");
    }

    const row = await insertAllocation(tx, {
      purchaseId,
      companyId: scope.companyId,
      reservedCustomerId: input.reservedCustomerId,
      allocationPct: roundRate(pct),
      createdBy: scope.userId,
    });

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "purchase_allocation",
      entityId: row.id,
      action: "purchase_allocation.created",
      after: { reservedCustomerId: row.reservedCustomerId, allocationPct: row.allocationPct },
    });

    return row;
  });
}

/** Prompt 23. Draft only (rule 8), same guard as add - no downstream consumption concern (allocation is a soft reservation, ADR 0014), so no analogous "used" lock. */
export async function updateAllocationEntry(
  ctx: RequestContext,
  purchaseId: string,
  allocationId: string,
  input: UpdateAllocationInput,
): Promise<PurchaseAllocationRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const purchase = await findPurchaseById(tx, scope.companyId, purchaseId);
    if (!purchase) {
      throw new NotFoundError("Purchase not found");
    }
    assertDraft(purchase);

    const existing = await findAllocationById(tx, scope.companyId, purchaseId, allocationId);
    if (!existing) {
      throw new NotFoundError("Allocation not found");
    }

    if (input.allocationPct !== undefined) {
      const pct = parseMoney(input.allocationPct);
      if (pct.lte(0) || pct.gt(100)) {
        throw new ValidationError("allocationPct must be greater than 0 and at most 100");
      }
    }

    const row = await updateAllocation(tx, scope.companyId, allocationId, {
      ...(input.reservedCustomerId !== undefined ? { reservedCustomerId: input.reservedCustomerId } : {}),
      ...(input.allocationPct !== undefined ? { allocationPct: roundRate(parseMoney(input.allocationPct)) } : {}),
      updatedBy: scope.userId,
    });
    if (!row) {
      throw new NotFoundError("Allocation not found");
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "purchase_allocation",
      entityId: allocationId,
      action: "purchase_allocation.updated",
      before: { reservedCustomerId: existing.reservedCustomerId, allocationPct: existing.allocationPct },
      after: { reservedCustomerId: row.reservedCustomerId, allocationPct: row.allocationPct },
    });

    return row;
  });
}

/** Prompt 23. Soft delete only (rule: no hard deletes), Draft only - same guard as add/update. */
export async function removeAllocationEntry(ctx: RequestContext, purchaseId: string, allocationId: string): Promise<void> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const purchase = await findPurchaseById(tx, scope.companyId, purchaseId);
    if (!purchase) {
      throw new NotFoundError("Purchase not found");
    }
    assertDraft(purchase);

    const existing = await findAllocationById(tx, scope.companyId, purchaseId, allocationId);
    if (!existing) {
      throw new NotFoundError("Allocation not found");
    }

    const row = await softDeleteAllocation(tx, scope.companyId, allocationId, scope.userId);
    if (!row) {
      throw new NotFoundError("Allocation not found");
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "purchase_allocation",
      entityId: allocationId,
      action: "purchase_allocation.removed",
      before: { deletedAt: null },
      after: { deletedAt: row.deletedAt },
    });
  });
}
