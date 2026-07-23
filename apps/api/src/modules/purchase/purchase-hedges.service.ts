import type { RequestContext } from "../../common/context/request-context.js";
import { NotFoundError, UnauthorizedError, ValidationError } from "../../common/errors/index.js";
import { parseMoney, roundRate } from "../../common/money/decimal.js";
import { insertAuditLog } from "../../core/audit/write.js";
import { withTenantDb } from "../../database/get-db.js";
import { findHedgeById, insertHedge, updateHedgeStatus, type HedgeRow } from "./purchase-hedges.repository.js";
import type { AddHedgeInput, UpdateHedgeStatusInput } from "./purchase-hedges.validator.js";
import { findPurchaseById } from "./purchase.repository.js";

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

/** FR-204. NOT gated by the purchase's draft/approved/posted status (resolved open question #8, same reasoning as LME records) - hedging commonly happens across a purchase's whole lifecycle, staged across multiple positions. */
export async function addHedge(ctx: RequestContext, purchaseId: string, input: AddHedgeInput): Promise<HedgeRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const purchase = await findPurchaseById(tx, scope.companyId, purchaseId);
    if (!purchase) {
      throw new NotFoundError("Purchase not found");
    }

    const quantity = parseMoney(input.quantity);
    const rate = parseMoney(input.rate);
    if (quantity.lte(0)) {
      throw new ValidationError("quantity must be a positive number");
    }
    if (rate.lte(0)) {
      throw new ValidationError("rate must be a positive number");
    }

    const row = await insertHedge(tx, {
      purchaseId,
      companyId: scope.companyId,
      hedgePlatformId: input.hedgePlatformId,
      contractNumber: input.contractNumber,
      position: input.position,
      quantity: roundRate(quantity),
      rate: roundRate(rate),
      hedgeDate: input.hedgeDate,
      createdBy: scope.userId,
    });

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "hedge",
      entityId: row.id,
      action: "hedge.created",
      after: { contractNumber: row.contractNumber, position: row.position, quantity: row.quantity, rate: row.rate, hedgeDate: row.hedgeDate },
    });

    return row;
  });
}

/** The position's own open->closed lifecycle - not a correction, so it's exempt from any draft-only guard (there isn't one here to begin with) and it's the one field on this table that's ever patched. */
export async function updateStatus(
  ctx: RequestContext,
  purchaseId: string,
  hedgeId: string,
  input: UpdateHedgeStatusInput,
): Promise<HedgeRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const existing = await findHedgeById(tx, scope.companyId, purchaseId, hedgeId);
    if (!existing) {
      throw new NotFoundError("Hedge not found");
    }

    const row = await updateHedgeStatus(tx, scope.companyId, hedgeId, { status: input.status, updatedBy: scope.userId });
    if (!row) {
      throw new NotFoundError("Hedge not found");
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "hedge",
      entityId: hedgeId,
      action: "hedge.status_changed",
      before: { status: existing.status },
      after: { status: row.status },
    });

    return row;
  });
}
