import { and, asc, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "../../database/get-db.js";
import { incoterms, purchaseItems, purchasePricing, purchaseShipments, purchases } from "../../database/tenant/schema.js";

/**
 * C-3b item 3 (docs/CONTRACT-MODULE-BUILD.md Part 2): resolves a
 * source_type/source_id link to the prefill values a new contract copies
 * once, at create time, into its OWN real columns - never re-read live
 * afterward (contracts.service.ts's own doc comment on `create`).
 * "sale" is a declared enum value (contract_source_type) with no
 * resolver yet - the Sales module doesn't exist. A contract linked to a
 * "sale" source is accepted by the schema but this function has nothing
 * to resolve it against yet; contracts.service.ts's create() already
 * 404s on a missing prefill either way, so linking to a not-yet-buildable
 * sale fails loudly, not silently.
 */
export interface LinkedSourceSummary {
  materialType: string | undefined;
  weightKg: string | undefined;
  rateUsd: string | undefined;
  deliveryTerms: string | undefined;
}

async function findPurchaseSummary(tx: TenantTx, companyId: string, purchaseId: string): Promise<LinkedSourceSummary | undefined> {
  const [purchase] = await tx
    .select({ id: purchases.id })
    .from(purchases)
    .where(and(eq(purchases.id, purchaseId), eq(purchases.companyId, companyId), isNull(purchases.deletedAt)))
    .limit(1);
  if (!purchase) {
    return undefined;
  }

  // The first (by creation order) item + its pricing - a purchase can have
  // several items, but a contract's own commercial fields are a single
  // rate/quantity pair (C-3a's placeholder Scrap field set); prefilling
  // from the first item is a pragmatic default for THIS field set, stays
  // fully editable afterward, and is not a claim that a multi-item
  // purchase's other items are somehow represented too.
  const [itemWithPricing] = await tx
    .select({ quantity: purchaseItems.quantity, purchaseRateUsd: purchasePricing.purchaseRateUsd })
    .from(purchaseItems)
    .innerJoin(purchasePricing, eq(purchasePricing.purchaseItemId, purchaseItems.id))
    .where(and(eq(purchaseItems.purchaseId, purchaseId), eq(purchaseItems.companyId, companyId), isNull(purchaseItems.deletedAt)))
    .orderBy(asc(purchaseItems.createdAt))
    .limit(1);

  const [shipmentWithIncoterm] = await tx
    .select({ incotermName: incoterms.name })
    .from(purchaseShipments)
    .innerJoin(incoterms, eq(incoterms.id, purchaseShipments.incotermId))
    .where(and(eq(purchaseShipments.purchaseId, purchaseId), eq(purchaseShipments.companyId, companyId), isNull(purchaseShipments.deletedAt)))
    .limit(1);

  return {
    materialType: undefined,
    weightKg: itemWithPricing?.quantity,
    rateUsd: itemWithPricing?.purchaseRateUsd,
    deliveryTerms: shipmentWithIncoterm?.incotermName,
  };
}

export async function findLinkedSourceSummary(
  tx: TenantTx,
  companyId: string,
  sourceType: "purchase" | "sale" | null,
  sourceId: string | null,
): Promise<LinkedSourceSummary | null> {
  if (!sourceType || !sourceId) {
    return null;
  }
  if (sourceType === "purchase") {
    return (await findPurchaseSummary(tx, companyId, sourceId)) ?? null;
  }
  // sourceType === "sale": no Sales module yet - see this file's own doc comment.
  return null;
}
