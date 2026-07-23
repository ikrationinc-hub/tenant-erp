import type { Decimal } from "decimal.js";
import type { RequestContext } from "../../common/context/request-context.js";
import { NotFoundError, UnauthorizedError, ValidationError } from "../../common/errors/index.js";
import { parseMoney, roundAmount, roundRate } from "../../common/money/decimal.js";
import { insertAuditLog } from "../../core/audit/write.js";
import { withTenantDb } from "../../database/get-db.js";
import {
  findItemById,
  findPricingByItemId,
  insertItem,
  insertPricing,
  updateItem,
  updatePricing,
  type PurchaseItemWithPricing,
} from "./purchase-items.repository.js";
import type { AddPurchaseItemInput, UpdatePurchaseItemInput } from "./purchase-items.validator.js";
import { assertDraft } from "./purchase.service.js";
import { findPurchaseById } from "./purchase.repository.js";

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

function requirePositive(value: Decimal, fieldName: string): void {
  if (value.lte(0)) {
    throw new ValidationError(`${fieldName} must be a positive number`);
  }
}

/**
 * FR-105/FR-106, full precision (ADR 0012) - both amounts derive from the
 * SAME unrounded `quantity x rate` product; `amountAed` is never computed
 * from a previously-rounded `amountUsd`. Rounding to each column's own
 * scale happens only where the caller persists the result.
 */
function calculateAmounts(quantity: Decimal, rateUsd: Decimal, exchangeRate: Decimal): { amountUsd: Decimal; amountAed: Decimal } {
  const amountUsd = quantity.mul(rateUsd);
  const amountAed = amountUsd.mul(exchangeRate);
  return { amountUsd, amountAed };
}

/** FR-104: user can add one or multiple purchase items. Draft only (rule 8). */
export async function addItem(ctx: RequestContext, purchaseId: string, input: AddPurchaseItemInput): Promise<PurchaseItemWithPricing> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const purchase = await findPurchaseById(tx, scope.companyId, purchaseId);
    if (!purchase) {
      throw new NotFoundError("Purchase not found");
    }
    assertDraft(purchase);

    const quantity = parseMoney(input.quantity);
    const rateUsd = parseMoney(input.purchaseRateUsd);
    const exchangeRate = parseMoney(input.exchangeRate);
    requirePositive(quantity, "quantity");
    requirePositive(rateUsd, "purchaseRateUsd");
    requirePositive(exchangeRate, "exchangeRate");

    const item = await insertItem(tx, {
      purchaseId,
      companyId: scope.companyId,
      itemId: input.itemId,
      ...(input.gradeId ? { gradeId: input.gradeId } : {}),
      quantity: roundRate(quantity),
      uomId: input.uomId,
      createdBy: scope.userId,
    });

    const { amountUsd, amountAed } = calculateAmounts(quantity, rateUsd, exchangeRate);
    const pricing = await insertPricing(tx, {
      purchaseItemId: item.id,
      companyId: scope.companyId,
      purchaseRateUsd: roundRate(rateUsd),
      purchaseAmountUsd: roundAmount(amountUsd),
      exchangeRate: roundRate(exchangeRate),
      purchaseAmountAed: roundAmount(amountAed),
      createdBy: scope.userId,
    });

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "purchase_item",
      entityId: item.id,
      action: "purchase_item.created",
      after: { ...input, purchaseAmountUsd: pricing.purchaseAmountUsd, purchaseAmountAed: pricing.purchaseAmountAed },
    });

    return { ...item, pricing };
  });
}

/** FR-103's edit reach extended to line items - Draft only (rule 8). Recomputes FR-105/FR-106 whenever quantity/rate/exchangeRate changes. */
export async function updatePurchaseItem(
  ctx: RequestContext,
  purchaseId: string,
  itemId: string,
  input: UpdatePurchaseItemInput,
): Promise<PurchaseItemWithPricing> {
  const scope = requireTenantScope(ctx);
  const { quantity: quantityInput, purchaseRateUsd: rateInput, exchangeRate: exchangeRateInput, ...itemFields } = input;

  return withTenantDb(ctx, async (tx) => {
    const purchase = await findPurchaseById(tx, scope.companyId, purchaseId);
    if (!purchase) {
      throw new NotFoundError("Purchase not found");
    }
    assertDraft(purchase);

    const existingItem = await findItemById(tx, scope.companyId, purchaseId, itemId);
    if (!existingItem) {
      throw new NotFoundError("Purchase item not found");
    }
    const existingPricing = await findPricingByItemId(tx, scope.companyId, itemId);
    if (!existingPricing) {
      throw new Error(`Purchase item ${itemId} has no pricing row - the 1:1 invariant was violated`);
    }

    let item = existingItem;
    const quantity = quantityInput !== undefined ? parseMoney(quantityInput) : parseMoney(existingItem.quantity);
    if (quantityInput !== undefined) {
      requirePositive(quantity, "quantity");
    }
    if (Object.keys(itemFields).length > 0 || quantityInput !== undefined) {
      const updated = await updateItem(tx, scope.companyId, itemId, {
        ...itemFields,
        ...(quantityInput !== undefined ? { quantity: roundRate(quantity) } : {}),
        updatedBy: scope.userId,
      });
      if (!updated) {
        throw new NotFoundError("Purchase item not found");
      }
      item = updated;
    }

    let pricing = existingPricing;
    if (rateInput !== undefined || exchangeRateInput !== undefined || quantityInput !== undefined) {
      const rateUsd = rateInput !== undefined ? parseMoney(rateInput) : parseMoney(existingPricing.purchaseRateUsd);
      const exchangeRate = exchangeRateInput !== undefined ? parseMoney(exchangeRateInput) : parseMoney(existingPricing.exchangeRate);
      if (rateInput !== undefined) {
        requirePositive(rateUsd, "purchaseRateUsd");
      }
      if (exchangeRateInput !== undefined) {
        requirePositive(exchangeRate, "exchangeRate");
      }

      const { amountUsd, amountAed } = calculateAmounts(quantity, rateUsd, exchangeRate);
      const updatedPricing = await updatePricing(tx, scope.companyId, itemId, {
        purchaseRateUsd: roundRate(rateUsd),
        purchaseAmountUsd: roundAmount(amountUsd),
        exchangeRate: roundRate(exchangeRate),
        purchaseAmountAed: roundAmount(amountAed),
        updatedBy: scope.userId,
      });
      if (!updatedPricing) {
        throw new Error(`Purchase item ${itemId} has no pricing row - the 1:1 invariant was violated`);
      }
      pricing = updatedPricing;
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "purchase_item",
      entityId: itemId,
      action: "purchase_item.updated",
      before: { quantity: existingItem.quantity, ...existingPricing },
      after: { quantity: item.quantity, ...pricing },
    });

    return { ...item, pricing };
  });
}
