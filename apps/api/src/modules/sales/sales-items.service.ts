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
  type SalesItemWithPricing,
} from "./sales-items.repository.js";
import type { AddSalesItemInput, UpdateSalesItemInput } from "./sales-items.validator.js";
import { assertItemsEditable } from "./sales.service.js";
import { findSalesById } from "./sales.repository.js";

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

/** FR-105/FR-106 mirror, full precision (ADR 0012) - both amounts derive from the SAME unrounded quantity x rate product; amountAed never computed from a previously-rounded amountUsd. */
function calculateAmounts(quantity: Decimal, rateUsd: Decimal, exchangeRate: Decimal): { amountUsd: Decimal; amountAed: Decimal } {
  const amountUsd = quantity.mul(rateUsd);
  const amountAed = amountUsd.mul(exchangeRate);
  return { amountUsd, amountAed };
}

/** FR-104: one or multiple items per sale. Draft or Approved (assertItemsEditable), mirroring purchase-items.service.ts's addItem - only pricingType='fixed' is supported in this phase (see sales.validator.ts's own doc comment), so salesRateUsd is always required/manual, never LME-derived. */
export async function addItem(ctx: RequestContext, salesId: string, input: AddSalesItemInput): Promise<SalesItemWithPricing> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const salesOrder = await findSalesById(tx, scope.companyId, salesId);
    if (!salesOrder) {
      throw new NotFoundError("Sales order not found");
    }
    assertItemsEditable(tx, scope.companyId, salesOrder);

    const quantity = parseMoney(input.quantity);
    const rateUsd = parseMoney(input.salesRateUsd);
    const exchangeRate = parseMoney(input.exchangeRate);
    requirePositive(quantity, "quantity");
    requirePositive(rateUsd, "salesRateUsd");
    requirePositive(exchangeRate, "exchangeRate");

    const item = await insertItem(tx, {
      salesId,
      companyId: scope.companyId,
      itemId: input.itemId,
      ...(input.gradeId ? { gradeId: input.gradeId } : {}),
      quantity: roundRate(quantity),
      uomId: input.uomId,
      createdBy: scope.userId,
    });

    const { amountUsd, amountAed } = calculateAmounts(quantity, rateUsd, exchangeRate);
    const pricing = await insertPricing(tx, {
      salesItemId: item.id,
      companyId: scope.companyId,
      salesRateUsd: roundRate(rateUsd),
      salesAmountUsd: roundAmount(amountUsd),
      exchangeRate: roundRate(exchangeRate),
      salesAmountAed: roundAmount(amountAed),
      createdBy: scope.userId,
    });

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "sales_item",
      entityId: item.id,
      action: "sales_item.created",
      after: { ...input, salesAmountUsd: pricing.salesAmountUsd, salesAmountAed: pricing.salesAmountAed },
    });

    return { ...item, pricing };
  });
}

/** Recomputes FR-105/FR-106 whenever quantity/rate/exchangeRate changes - mirrors purchase-items.service.ts's updatePurchaseItem. */
export async function updateSalesItem(
  ctx: RequestContext,
  salesId: string,
  itemId: string,
  input: UpdateSalesItemInput,
): Promise<SalesItemWithPricing> {
  const scope = requireTenantScope(ctx);
  const { quantity: quantityInput, salesRateUsd: rateInput, exchangeRate: exchangeRateInput, ...itemFields } = input;

  return withTenantDb(ctx, async (tx) => {
    const salesOrder = await findSalesById(tx, scope.companyId, salesId);
    if (!salesOrder) {
      throw new NotFoundError("Sales order not found");
    }
    assertItemsEditable(tx, scope.companyId, salesOrder);

    const existingItem = await findItemById(tx, scope.companyId, salesId, itemId);
    if (!existingItem) {
      throw new NotFoundError("Sales item not found");
    }
    const existingPricing = await findPricingByItemId(tx, scope.companyId, itemId);
    if (!existingPricing) {
      throw new Error(`Sales item ${itemId} has no pricing row - the 1:1 invariant was violated`);
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
        throw new NotFoundError("Sales item not found");
      }
      item = updated;
    }

    let pricing = existingPricing;
    if (rateInput !== undefined || exchangeRateInput !== undefined || quantityInput !== undefined) {
      const rateUsd = rateInput !== undefined ? parseMoney(rateInput) : parseMoney(existingPricing.salesRateUsd);
      const exchangeRate = exchangeRateInput !== undefined ? parseMoney(exchangeRateInput) : parseMoney(existingPricing.exchangeRate);
      if (rateInput !== undefined) {
        requirePositive(rateUsd, "salesRateUsd");
      }
      if (exchangeRateInput !== undefined) {
        requirePositive(exchangeRate, "exchangeRate");
      }

      const { amountUsd, amountAed } = calculateAmounts(quantity, rateUsd, exchangeRate);
      const updatedPricing = await updatePricing(tx, scope.companyId, itemId, {
        salesRateUsd: roundRate(rateUsd),
        salesAmountUsd: roundAmount(amountUsd),
        exchangeRate: roundRate(exchangeRate),
        salesAmountAed: roundAmount(amountAed),
        updatedBy: scope.userId,
      });
      if (!updatedPricing) {
        throw new Error(`Sales item ${itemId} has no pricing row - the 1:1 invariant was violated`);
      }
      pricing = updatedPricing;
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "sales_item",
      entityId: itemId,
      action: "sales_item.updated",
      before: { quantity: existingItem.quantity, ...existingPricing },
      after: { quantity: item.quantity, ...pricing },
    });

    return { ...item, pricing };
  });
}
