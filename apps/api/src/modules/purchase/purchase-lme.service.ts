import type { RequestContext } from "../../common/context/request-context.js";
import { NotFoundError, UnauthorizedError, ValidationError } from "../../common/errors/index.js";
import { parseMoney, roundRate } from "../../common/money/decimal.js";
import { insertAuditLog } from "../../core/audit/write.js";
import { getPriceSource } from "../../core/pricing/manual-entry-adapter.js";
import { withTenantDb } from "../../database/get-db.js";
import { insertLmeRecord, type LmeRecordRow } from "./purchase-lme.repository.js";
import type { AddLmeRecordInput } from "./purchase-lme.validator.js";
import { findPurchaseById } from "./purchase.repository.js";

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

/**
 * FR-201/FR-202/FR-203. NOT gated by the purchase's draft/approved/posted
 * status (resolved open question #6) - a purchase can already be
 * Approved or Posted when its price gets fixed. The price is recorded
 * into market_prices FIRST via the PriceSource (this task's own
 * instruction: "never straight onto a transaction"), and only the
 * resulting row's id/value is snapshotted onto the lme_record - never a
 * raw client-supplied number written directly to lme_records without
 * having passed through that ledger.
 */
export async function addLmeRecord(ctx: RequestContext, purchaseId: string, input: AddLmeRecordInput): Promise<LmeRecordRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const purchase = await findPurchaseById(tx, scope.companyId, purchaseId);
    if (!purchase) {
      throw new NotFoundError("Purchase not found");
    }

    const lmePrice = parseMoney(input.lmePriceUsd);
    const premiumPct = parseMoney(input.agreedPremiumPct);
    if (lmePrice.lte(0)) {
      throw new ValidationError("lmePriceUsd must be a positive number");
    }

    const marketPrice = await getPriceSource().recordPrice(tx, {
      companyId: scope.companyId,
      lmeExchangeId: input.lmeExchangeId,
      metal: input.metal,
      price: roundRate(lmePrice),
      effectiveDate: input.fixingDate,
      createdBy: scope.userId,
    });

    // FR-203, full precision (ADR 0012): lmePrice x (1 + premiumPct / 100).
    const finalRate = lmePrice.mul(premiumPct.div(100).plus(1));

    const row = await insertLmeRecord(tx, {
      purchaseId,
      companyId: scope.companyId,
      lmeExchangeId: input.lmeExchangeId,
      marketPriceId: marketPrice.id,
      lmePriceUsd: roundRate(lmePrice),
      fixingDate: input.fixingDate,
      agreedPremiumPct: roundRate(premiumPct),
      finalPurchaseRateUsd: roundRate(finalRate),
      createdBy: scope.userId,
    });

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "lme_record",
      entityId: row.id,
      action: "lme_record.created",
      after: {
        marketPriceId: row.marketPriceId,
        lmePriceUsd: row.lmePriceUsd,
        fixingDate: row.fixingDate,
        agreedPremiumPct: row.agreedPremiumPct,
        finalPurchaseRateUsd: row.finalPurchaseRateUsd,
      },
    });

    return row;
  });
}
