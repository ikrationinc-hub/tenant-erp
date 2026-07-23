import type { RequestContext } from "../../common/context/request-context.js";
import { NotFoundError, UnauthorizedError } from "../../common/errors/index.js";
import { parseMoney, roundAmount } from "../../common/money/decimal.js";
import { insertAuditLog } from "../../core/audit/write.js";
import { withTenantDb } from "../../database/get-db.js";
import { findCostsByPurchaseId, insertCosts, updateCosts, type PurchaseAdditionalCostsRow } from "./purchase-costs.repository.js";
import type { UpsertAdditionalCostsInput } from "./purchase-costs.validator.js";
import { findPurchaseById } from "./purchase.repository.js";
import { assertDraft } from "./purchase.service.js";

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

/** Rounds only the keys actually present in `input` - callers that only send one field must not clobber the others with a re-round of an unrelated value. */
function roundProvidedAmounts(input: UpsertAdditionalCostsInput): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      result[key] = roundAmount(parseMoney(value));
    }
  }
  return result;
}

/** Sub Tab 2, table G. Draft only (rule 8). Upsert: a purchase's first cost entry inserts the row, every one after that updates it - there's only ever one additional-costs row per purchase. */
export async function setAdditionalCosts(
  ctx: RequestContext,
  purchaseId: string,
  input: UpsertAdditionalCostsInput,
): Promise<PurchaseAdditionalCostsRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const purchase = await findPurchaseById(tx, scope.companyId, purchaseId);
    if (!purchase) {
      throw new NotFoundError("Purchase not found");
    }
    assertDraft(purchase);

    const values = roundProvidedAmounts(input);
    const existing = await findCostsByPurchaseId(tx, scope.companyId, purchaseId);

    let row: PurchaseAdditionalCostsRow;
    let action: string;
    if (!existing) {
      row = await insertCosts(tx, { purchaseId, companyId: scope.companyId, ...values, createdBy: scope.userId });
      action = "purchase_additional_costs.created";
    } else {
      const updated = await updateCosts(tx, scope.companyId, purchaseId, { ...values, updatedBy: scope.userId });
      if (!updated) {
        throw new Error(`Purchase ${purchaseId}'s additional-costs row disappeared mid-update`);
      }
      row = updated;
      action = "purchase_additional_costs.updated";
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "purchase_additional_costs",
      entityId: row.id,
      action,
      after: values,
    });

    return row;
  });
}
