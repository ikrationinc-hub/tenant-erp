import type { Decimal } from "decimal.js";
import type { RequestContext } from "../../common/context/request-context.js";
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from "../../common/errors/index.js";
import { parseMoney, roundRate } from "../../common/money/decimal.js";
import { insertAuditLog } from "../../core/audit/write.js";
import { getPriceSource } from "../../core/pricing/manual-entry-adapter.js";
import { withTenantDb, type TenantTx } from "../../database/get-db.js";
import {
  findLmeRecordById,
  insertLmeRecord,
  isLmeRecordUsedByAnyItem,
  softDeleteLmeRecord,
  updateLmeRecord,
  type LmeRecordRow,
} from "./purchase-lme.repository.js";
import type { AddLmeRecordInput, UpdateLmeRecordInput } from "./purchase-lme.validator.js";
import { findPurchaseById } from "./purchase.repository.js";

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

/** FR-203, full precision (ADR 0012): lmePrice x (agreedPremiumPct / 100) - client-confirmed correction: a DIRECT multiplier of the LME price, not a markup added on top. LME 100, agreed 98% -> 98 (not 104). A value below 100 is valid and normal - it means the final rate lands BELOW the LME price, not an error. */
function computeFinalRate(lmePrice: Decimal, agreedPct: Decimal): Decimal {
  return lmePrice.mul(agreedPct.div(100));
}

/** Shared by addLmeRecord and update(): once any item has snapshotted this purchase's rate from SOME lme_record, that record - and any earlier one - stops being safely correctable in place. Only relevant for update/delete; create is never gated by it. */
async function assertLmeRecordNotUsed(tx: TenantTx, companyId: string, record: LmeRecordRow): Promise<void> {
  const used = await isLmeRecordUsedByAnyItem(tx, companyId, record.id);
  if (used) {
    throw new ConflictError(
      "This LME record has already been used to price an item and can no longer be edited or removed - add a new, corrected record instead",
    );
  }
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

    const finalRate = computeFinalRate(lmePrice, premiumPct);

    const row = await insertLmeRecord(tx, {
      purchaseId,
      companyId: scope.companyId,
      lmeExchangeId: input.lmeExchangeId,
      marketPriceId: marketPrice.id,
      metal: input.metal,
      lmeType: input.lmeType,
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
        metal: row.metal,
        lmeType: row.lmeType,
        lmePriceUsd: row.lmePriceUsd,
        fixingDate: row.fixingDate,
        agreedPremiumPct: row.agreedPremiumPct,
        finalPurchaseRateUsd: row.finalPurchaseRateUsd,
      },
    });

    return row;
  });
}

/**
 * Prompt 23. Same "record into market_prices first" discipline as create
 * (never a raw client number written straight onto lme_records) - an
 * edit re-records a fresh market_prices row and repoints marketPriceId
 * at it, rather than mutating the original ledger row. Only reachable
 * while isLmeRecordUsedByAnyItem is false for this record.
 */
export async function updateLmeRecordEntry(
  ctx: RequestContext,
  purchaseId: string,
  lmeRecordId: string,
  input: UpdateLmeRecordInput,
): Promise<LmeRecordRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const existing = await findLmeRecordById(tx, scope.companyId, purchaseId, lmeRecordId);
    if (!existing) {
      throw new NotFoundError("LME record not found");
    }
    await assertLmeRecordNotUsed(tx, scope.companyId, existing);

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

    const finalRate = computeFinalRate(lmePrice, premiumPct);

    const row = await updateLmeRecord(tx, scope.companyId, lmeRecordId, {
      lmeExchangeId: input.lmeExchangeId,
      marketPriceId: marketPrice.id,
      metal: input.metal,
      lmeType: input.lmeType,
      lmePriceUsd: roundRate(lmePrice),
      fixingDate: input.fixingDate,
      agreedPremiumPct: roundRate(premiumPct),
      finalPurchaseRateUsd: roundRate(finalRate),
      updatedBy: scope.userId,
    });
    if (!row) {
      throw new NotFoundError("LME record not found");
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "lme_record",
      entityId: row.id,
      action: "lme_record.updated",
      before: {
        marketPriceId: existing.marketPriceId,
        metal: existing.metal,
        lmeType: existing.lmeType,
        lmePriceUsd: existing.lmePriceUsd,
        fixingDate: existing.fixingDate,
        agreedPremiumPct: existing.agreedPremiumPct,
        finalPurchaseRateUsd: existing.finalPurchaseRateUsd,
      },
      after: {
        marketPriceId: row.marketPriceId,
        metal: row.metal,
        lmeType: row.lmeType,
        lmePriceUsd: row.lmePriceUsd,
        fixingDate: row.fixingDate,
        agreedPremiumPct: row.agreedPremiumPct,
        finalPurchaseRateUsd: row.finalPurchaseRateUsd,
      },
    });

    return row;
  });
}

/** Prompt 23. Soft delete only (rule: no hard deletes) - same isLmeRecordUsedByAnyItem gate as update. */
export async function removeLmeRecord(ctx: RequestContext, purchaseId: string, lmeRecordId: string): Promise<void> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const existing = await findLmeRecordById(tx, scope.companyId, purchaseId, lmeRecordId);
    if (!existing) {
      throw new NotFoundError("LME record not found");
    }
    await assertLmeRecordNotUsed(tx, scope.companyId, existing);

    const row = await softDeleteLmeRecord(tx, scope.companyId, lmeRecordId, scope.userId);
    if (!row) {
      throw new NotFoundError("LME record not found");
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "lme_record",
      entityId: lmeRecordId,
      action: "lme_record.removed",
      before: { deletedAt: null },
      after: { deletedAt: row.deletedAt },
    });
  });
}
