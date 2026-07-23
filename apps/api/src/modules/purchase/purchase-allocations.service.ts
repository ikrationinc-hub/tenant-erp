import type { RequestContext } from "../../common/context/request-context.js";
import { NotFoundError, UnauthorizedError, ValidationError } from "../../common/errors/index.js";
import { parseMoney, roundRate } from "../../common/money/decimal.js";
import { insertAuditLog } from "../../core/audit/write.js";
import { withTenantDb } from "../../database/get-db.js";
import { insertAllocation, listAllocationsForPurchase, type PurchaseAllocationRow } from "./purchase-allocations.repository.js";
import type { AddAllocationInput } from "./purchase-allocations.validator.js";
import { findPurchaseById } from "./purchase.repository.js";
import { assertDraft } from "./purchase.service.js";

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

/** Sub Tab 2, table F. Draft only (rule 8). App-layer enforced (not a DB CHECK, which can't span rows): the sum of every non-deleted allocation for one purchase never exceeds 100%. */
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

    const existing = await listAllocationsForPurchase(tx, scope.companyId, purchaseId);
    const existingSum = existing.reduce((sum, row) => sum.plus(parseMoney(row.allocationPct)), parseMoney("0"));
    if (existingSum.plus(pct).gt(100)) {
      throw new ValidationError(`Total allocation would be ${existingSum.plus(pct).toString()}%, exceeding 100%`, {
        existingTotalPct: existingSum.toString(),
        requestedPct: pct.toString(),
      });
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
