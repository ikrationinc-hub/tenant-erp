import type { RequestContext } from "../../common/context/request-context.js";
import { NotFoundError, UnauthorizedError } from "../../common/errors/index.js";
import { parseMoney, roundAmount } from "../../common/money/decimal.js";
import { insertAuditLog } from "../../core/audit/write.js";
import { withTenantDb } from "../../database/get-db.js";
import { findCostsBySalesId, insertCosts, updateCosts, type SalesAdditionalCostsRow } from "./sales-costs.repository.js";
import type { UpsertSalesAdditionalCostsInput } from "./sales-costs.validator.js";
import { findSalesById } from "./sales.repository.js";
import { assertDraft } from "./sales.service.js";

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

/** Rounds only the keys actually present - mirrors purchase-costs.service.ts's roundProvidedAmounts. */
function roundProvidedAmounts(input: UpsertSalesAdditionalCostsInput): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      result[key] = roundAmount(parseMoney(value));
    }
  }
  return result;
}

/** The sale's own freight/insurance/customs/other - Draft only (rule 8). Upsert: first entry inserts, every one after updates. */
export async function setAdditionalCosts(
  ctx: RequestContext,
  salesId: string,
  input: UpsertSalesAdditionalCostsInput,
): Promise<SalesAdditionalCostsRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const salesOrder = await findSalesById(tx, scope.companyId, salesId);
    if (!salesOrder) {
      throw new NotFoundError("Sales order not found");
    }
    assertDraft(salesOrder);

    const values = roundProvidedAmounts(input);
    const existing = await findCostsBySalesId(tx, scope.companyId, salesId);

    let row: SalesAdditionalCostsRow;
    let action: string;
    if (!existing) {
      row = await insertCosts(tx, { salesId, companyId: scope.companyId, ...values, createdBy: scope.userId });
      action = "sales_additional_costs.created";
    } else {
      const updated = await updateCosts(tx, scope.companyId, salesId, { ...values, updatedBy: scope.userId });
      if (!updated) {
        throw new Error(`Sales order ${salesId}'s additional-costs row disappeared mid-update`);
      }
      row = updated;
      action = "sales_additional_costs.updated";
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "sales_additional_costs",
      entityId: row.id,
      action,
      after: values,
    });

    return row;
  });
}
