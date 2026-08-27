import { eventBus } from "../../common/events/bus.js";
import type { RequestContext } from "../../common/context/request-context.js";
import { ConflictError, NotFoundError, UnauthorizedError } from "../../common/errors/index.js";
import { parseMoney, roundAmount } from "../../common/money/decimal.js";
import { insertAuditLog } from "../../core/audit/write.js";
import type { PaginatedRows } from "../../core/masters/types.js";
import { nextNumber } from "../../core/numbering/next-number.js";
import { requireAtLeastOneValidLine } from "../../core/workflow/guards.js";
import { findTransition, runGuards, type WorkflowTransition } from "../../core/workflow/transitions.js";
import { withTenantDb, type TenantTx } from "../../database/get-db.js";
import type { CreatePurchaseInput, PurchasesListQuery, UpdatePurchaseInput } from "./purchase.validator.js";
import { listAllocationsForPurchase, type PurchaseAllocationRow } from "./purchase-allocations.repository.js";
import { findCostsByPurchaseId, type PurchaseAdditionalCostsRow } from "./purchase-costs.repository.js";
import { listHedgesForPurchase, type HedgeRow } from "./purchase-hedges.repository.js";
import {
  listItemsWithPricingForPurchase,
  listOrderedQuantitiesForPurchases,
  type OrderedQuantityRow,
  type PurchaseItemWithPricing,
} from "./purchase-items.repository.js";
import {
  hasAnyBillForPurchase,
  listBillsForPurchase,
  listBillsForPurchases,
  sumBilledQuantitiesByItem,
  sumBilledQuantitiesByItemForPurchases,
  type PurchaseBillRow,
} from "./purchase-bills.repository.js";
import { listLmeRecordsForPurchase, type LmeRecordRow } from "./purchase-lme.repository.js";
import { computeBilledStatus, computePaidStatus, computeReceivedStatus, type BilledStatus, type PaidStatus, type ReceivedStatus } from "./purchase-lifecycle.js";
import { sumPaidAmountsByBill, sumPaidAmountsByBillForPurchases, type PaidAmountRowForPurchase } from "./purchase-payments.repository.js";
import {
  hasAnyReceiptForPurchase,
  listReceiptsForPurchase,
  sumConfirmedReceivedQuantitiesByItem,
  sumConfirmedReceivedQuantitiesByItemForPurchases,
  type PurchaseReceiptRow,
} from "./purchase-receipts.repository.js";
import {
  findPurchaseById,
  findShipmentByPurchaseId,
  insertPurchase,
  insertPurchaseShipment,
  listPurchases,
  transitionPurchaseStatus,
  updatePurchase,
  updatePurchaseShipment,
  type PurchaseRow,
  type PurchaseShipmentRow,
} from "./purchase.repository.js";

interface ApproveGuardContext {
  items: PurchaseItemWithPricing[];
  pricingType: PurchaseRow["pricingType"];
  hasLmeRecord: boolean;
}

/** Prompt 21 item 2, renamed for PL-3's Issue transition: under pricing_type='lme', an LME record is the source the item rate was derived from (purchase-items.service.ts) - issuing without one would lock in a rate with nothing behind it. Under 'fixed' (or a legacy purchase with pricingType unset), this guard is a no-op. */
function requireLmeRecordUnderLmePricing(context: ApproveGuardContext): void {
  if (context.pricingType === "lme" && !context.hasLmeRecord) {
    throw new ConflictError("Cannot issue: LME pricing requires at least one LME record");
  }
}

/**
 * What makes one purchase item "valid" to issue - domain-specific, so
 * it stays here rather than in core/workflow/guards.ts's reusable
 * "at least one valid line" shape. Quantity is enforced positive already
 * at addItem/updatePurchaseItem time (purchase-items.service.ts's
 * requirePositive) - re-checked here anyway as defense in depth, since
 * this guard must hold regardless of how an item got into its current
 * state (a future bulk-import path, a relaxed PATCH, direct data repair),
 * not just through today's one write path. purchaseRateUsd/exchangeRate
 * are ALSO required positive here - flagged for review with the user:
 * required for now, since an issued (soon-immutable) financial document
 * with a zero rate has no real value either.
 */
function validatePurchaseItemForApproval(item: PurchaseItemWithPricing): string | undefined {
  if (parseMoney(item.quantity).lte(0)) {
    return `Cannot issue: item ${item.id} has quantity ${item.quantity}, must be greater than 0`;
  }
  if (parseMoney(item.pricing.purchaseRateUsd).lte(0)) {
    return `Cannot issue: item ${item.id} has purchase rate ${item.pricing.purchaseRateUsd}, must be greater than 0`;
  }
  if (parseMoney(item.pricing.exchangeRate).lte(0)) {
    return `Cannot issue: item ${item.id} has exchange rate ${item.pricing.exchangeRate}, must be greater than 0`;
  }
  return undefined;
}

interface CancelGuardContext {
  hasAnyReceipt: boolean;
  hasAnyBill: boolean;
}

/** PL-3: a PO can only be cancelled before anything's been fulfilled against it - once a receipt or bill exists, the PO is no longer a dead letter, it's a real transaction in motion (rule 8's spirit: cancellation is not a correction mechanism for a partially-fulfilled order). */
function requireNothingFulfilledForCancel(context: CancelGuardContext): void {
  if (context.hasAnyReceipt) {
    throw new ConflictError("Cannot cancel: this purchase already has a receipt against it");
  }
  if (context.hasAnyBill) {
    throw new ConflictError("Cannot cancel: this purchase already has a bill against it");
  }
}

/**
 * PL-3 (docs/PURCHASE-LIFECYCLE-4DOC.md, ADR 0018): Draft -> Issued ->
 * Closed/Cancelled, each transition its own permission (core/workflow/
 * transitions.ts). "Posted" is dropped entirely - superseded ADR 0015/
 * 0016 immutability lock, now carried by the two terminal states instead.
 * Issue's guards are the SAME ones "approve" used to run (zero-item block,
 * LME/fixed validation) - only the transition's name and target status
 * changed, not what it protects: a purchase can't become an issued
 * (soon-immutable) financial document representing no goods. "Closed" has
 * NO entry here - it is never invoked via findTransition/runGuards, only
 * ever written by maybeAutoCloseIssuedPurchase below, from inside the
 * SAME transaction as a receipt confirm or bill approve.
 */
const PURCHASE_WORKFLOW: WorkflowTransition<PurchaseRow["status"], ApproveGuardContext>[] = [
  {
    name: "issue",
    from: "draft",
    to: "issued",
    permission: "purchase.po.issue",
    guards: [
      (context) =>
        requireAtLeastOneValidLine(context.items, validatePurchaseItemForApproval, "Cannot issue: purchase has no items"),
      requireLmeRecordUnderLmePricing,
    ],
  },
];

/**
 * Not expressed as a WorkflowTransition/findTransition entry: the engine
 * (core/workflow/transitions.ts) models one static from->to edge per
 * name, found by a plain name lookup - it has no way to represent "the
 * same transition, usable from either of two starting states," and
 * `transitionPurchaseStatus`'s CAS UPDATE genuinely needs the caller's
 * OWN already-fetched current status as `from`, not a value guessed from
 * a static table. cancel() below reads `existing.status` directly and
 * validates it's one of these two allowed starting states itself -
 * guards/permission stay identical to what a WorkflowTransition entry
 * would declare, just checked inline rather than through runGuards.
 */
const CANCELLABLE_FROM_STATUSES: ReadonlyArray<PurchaseRow["status"]> = ["draft", "issued"];

export interface PurchaseWithShipment extends PurchaseRow {
  shipment: PurchaseShipmentRow;
  /** Session (b): populated on getById, omitted (undefined) on create/update's response - those return before any item exists yet or without re-querying the full item list. PL-4: each item also carries its own receivedQuantity/billedQuantity (attachItemFulfilment) so the frontend's Receive/Convert-to-Bill forms can default to outstanding quantity without a dedicated endpoint. */
  items?: PurchaseItemWithFulfilment[];
  /** Session (c): same convention as `items` - populated on getById only. */
  allocations?: PurchaseAllocationRow[];
  /** Session (c): undefined until the first PATCH .../costs (no row exists yet), not just an empty/zeroed object. */
  additionalCosts?: PurchaseAdditionalCostsRow | undefined;
  /** Session (d): same convention as `items`/`allocations` - populated on getById only. */
  lmeRecords?: LmeRecordWithUsage[];
  hedges?: HedgeRow[];
  /** Prompt 22: same convention as `items`/`allocations`/`lmeRecords`/`hedges` - populated on getById only. Wire shape only (invoiceNumber/invoiceDate/invoiceAmountUsd) - see attachInvoiceVariance's doc comment for why this doesn't match the renamed internal purchase_bills columns. */
  invoices?: PurchaseInvoiceWithVariance[];
  /** PL-1: same convention - populated on getById only. */
  receipts?: PurchaseReceiptRow[];
  /** PL-1 §4: derived, never stored - not_received/partial/fully_received, computed by summing CONFIRMED receipt quantities against each item's ordered quantity. */
  receivedStatus?: ReceivedStatus;
  /** PL-2 §4: derived, never stored - not_billed/partial/fully_billed, computed by summing every bill's (draft+approved) billed quantities against each item's ordered quantity. Mirrors receivedStatus exactly. */
  billedStatus?: BilledStatus;
  /** PL-5: derived, never stored - not_paid/partial/fully_paid, computed by summing every payment allocation against each of this purchase's own bills' amounts. Unlike received/billed (per-item), this is per-bill - a purchase with no bills yet is "not_paid", same "nothing to derive from" treatment as zero items being "not_received". */
  paidStatus?: PaidStatus;
}


/**
 * Prompt 22 follow-up (client-confirmed): the supplier's invoice amount
 * is manually entered - it's an external document's own total, not
 * something this system computes. What the system CAN do is show the
 * user how far it lands from the purchase's own computed total, so a
 * mistyped or genuinely-different supplier figure is visible at a
 * glance. Informational only, same spirit as ADR 0014's allocation
 * total: never blocks create/update/approve, never persisted - computed
 * fresh on every getById from the purchase's current items and the
 * bill's own stored amount.
 *
 * PL-2: this is the WIRE shape, deliberately still Prompt 22's field
 * names (invoiceNumber/invoiceDate/invoiceAmountUsd) - the REST surface
 * and field-definitions entity ("invoice") are unrenamed in this prompt
 * (PL-4 does the coordinated cutover), even though the internal
 * PurchaseBillRow now has billNumber/billDate/billAmountUsd. This
 * function is the ONE place that translates between the two - nowhere
 * else in the response pipeline needs to know about the rename.
 */
export interface PurchaseInvoiceWithVariance {
  id: string;
  invoiceNumber: string;
  supplierInvoiceNo: string | null;
  invoiceDate: string;
  dueDate: string | null;
  invoiceAmountUsd: string;
  taxAmount: string | null;
  status: PurchaseBillRow["status"];
  purchaseItemsAmountUsd: string;
  varianceUsd: string;
  variancePct: string | null;
}

function attachInvoiceVariance(items: PurchaseItemWithPricing[], bills: PurchaseBillRow[]): PurchaseInvoiceWithVariance[] {
  const purchaseItemsAmount = items.reduce((sum, item) => sum.plus(parseMoney(item.pricing.purchaseAmountUsd)), parseMoney("0"));
  const purchaseItemsAmountUsd = roundAmount(purchaseItemsAmount);

  return bills.map((bill) => {
    const varianceUsd = roundAmount(parseMoney(bill.billAmountUsd).minus(purchaseItemsAmount));
    const variancePct = purchaseItemsAmount.isZero() ? null : roundAmount(parseMoney(varianceUsd).dividedBy(purchaseItemsAmount).times(100));
    return {
      id: bill.id,
      invoiceNumber: bill.billNumber,
      supplierInvoiceNo: bill.supplierInvoiceNo,
      invoiceDate: bill.billDate,
      dueDate: bill.dueDate,
      invoiceAmountUsd: bill.billAmountUsd,
      taxAmount: bill.taxAmount,
      status: bill.status,
      purchaseItemsAmountUsd,
      varianceUsd,
      variancePct,
    };
  });
}

/**
 * Prompt 23: whether any item has snapshotted this record's rate
 * (purchase_pricing.lme_record_id) - purchase-lme.service.ts's own
 * update/remove enforce the actual lock server-side; this is purely so
 * the UI can greyed-out/disable the Edit/Delete buttons with an
 * explanation instead of letting the user hit a 409 blind. Computed from
 * the SAME items list getById already fetched - no extra query.
 */
export interface LmeRecordWithUsage extends LmeRecordRow {
  isUsed: boolean;
}

function attachLmeRecordUsage(items: PurchaseItemWithPricing[], lmeRecords: LmeRecordRow[]): LmeRecordWithUsage[] {
  const usedIds = new Set(items.map((item) => item.pricing.lmeRecordId).filter((id): id is string => id !== null));
  return lmeRecords.map((record) => ({ ...record, isUsed: usedIds.has(record.id) }));
}

/**
 * PL-4: each item's own running received/billed quantity (defaulting to
 * "0" when nothing's been received/billed against it yet) - the same
 * per-item Maps getById already builds for computeReceivedStatus/
 * computeBilledStatus, just also attached to the item row itself so the
 * frontend's Receive form can default a line to (quantity - receivedQuantity)
 * and the Convert to Bill form to (quantity - billedQuantity), without a
 * separate "outstanding quantities" endpoint.
 */
export interface PurchaseItemWithFulfilment extends PurchaseItemWithPricing {
  receivedQuantity: string;
  billedQuantity: string;
}

function attachItemFulfilment(
  items: PurchaseItemWithPricing[],
  receivedByItemId: Map<string, string>,
  billedByItemId: Map<string, string>,
): PurchaseItemWithFulfilment[] {
  return items.map((item) => ({
    ...item,
    receivedQuantity: receivedByItemId.get(item.id) ?? "0",
    billedQuantity: billedByItemId.get(item.id) ?? "0",
  }));
}

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

/** Open question #7, resolved: never user-entered, always the calendar year of Loading Date. A plain substring, not `new Date(...).getFullYear()` - `loadingDate` is already a validated "YYYY-MM-DD" string and slicing it avoids any timezone-parsing risk entirely. */
function deriveShipmentYear(loadingDate: string): number {
  return Number(loadingDate.slice(0, 4));
}

/** Rule 8, enforced now even though nothing in this session can move a purchase off "draft" yet - the workflow engine (session (e)) adds the transitions, this guard is what makes them actually immutable-after-post from day one. Exported: purchase-items.service.ts (session (b)'s item/pricing edits) enforces the exact same guard against the item's parent purchase. */
export function assertDraft(purchase: PurchaseRow): void {
  if (purchase.status !== "draft") {
    throw new ConflictError(`Purchase ${purchase.purchaseNumber} is ${purchase.status} and can no longer be edited`);
  }
}

/**
 * Items specifically stay editable past Draft, through Issued - unlike
 * the header/costs/allocation lock `assertDraft` above enforces. PL-3:
 * "Posted" is gone - the terminal states Closed and Cancelled are now
 * what locks items (rule 8's immutability moved from a manual step to
 * the two states a PO actually ends its life in). PL-1: additionally
 * locks the moment ANY receipt (draft or confirmed) exists against the
 * purchase - a receipt's over-receipt guard (purchase-receipts.service.ts)
 * is checked against the item's ordered quantity at the receipt's OWN
 * create time; letting an ordered quantity change afterward would
 * silently invalidate that check with no reconciliation mechanism to
 * catch it (unlike the superseded invoice-reconciliation design this
 * replaces - see ADR 0016).
 */
export async function assertItemsEditable(tx: TenantTx, companyId: string, purchase: PurchaseRow): Promise<void> {
  if (purchase.status === "closed" || purchase.status === "cancelled") {
    throw new ConflictError(`Purchase ${purchase.purchaseNumber} is ${purchase.status} and can no longer be edited`);
  }
  if (await hasAnyReceiptForPurchase(tx, companyId, purchase.id)) {
    throw new ConflictError(`Purchase ${purchase.purchaseNumber} already has a receipt against it - items can no longer be edited`);
  }
}

/** PL-4/PL-5: the PO list's own row shape - every PurchaseRow field plus the three derived fulfilment axes (Zoho's Received ●/Billed ●/Paid ● dots), so the list screen can show them as columns without a second round trip per row. */
export interface PurchaseRowWithFulfilment extends PurchaseRow {
  receivedStatus: ReceivedStatus;
  billedStatus: BilledStatus;
  paidStatus: PaidStatus;
}

/**
 * PL-4: batched, not per-row - ONE extra query each for received-sums,
 * billed-sums, and ordered quantities, scoped to just the purchase IDs on
 * THIS page (never all purchases in the company), then computeReceivedStatus/
 * computeBilledStatus run per row from an in-memory Map lookup. Bounded
 * cost regardless of page size: 3 extra queries per page load, not 3 per
 * row - the N+1 this exists to avoid.
 */
export async function list(ctx: RequestContext, params: PurchasesListQuery): Promise<PaginatedRows<PurchaseRowWithFulfilment>> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, async (tx) => {
    const page = await listPurchases(tx, scope.companyId, params);
    const purchaseIds = page.items.map((row) => row.id);

    const orderedRows = await listOrderedQuantitiesForPurchases(tx, scope.companyId, purchaseIds);
    const orderedByPurchase = new Map<string, OrderedQuantityRow[]>();
    for (const row of orderedRows) {
      const bucket = orderedByPurchase.get(row.purchaseId) ?? [];
      bucket.push(row);
      orderedByPurchase.set(row.purchaseId, bucket);
    }

    const receivedRows = await sumConfirmedReceivedQuantitiesByItemForPurchases(tx, scope.companyId, purchaseIds);
    const receivedByPurchase = new Map<string, Map<string, string>>();
    for (const row of receivedRows) {
      const bucket = receivedByPurchase.get(row.purchaseId) ?? new Map<string, string>();
      bucket.set(row.purchaseItemId, row.receivedQuantity);
      receivedByPurchase.set(row.purchaseId, bucket);
    }

    const billedRows = await sumBilledQuantitiesByItemForPurchases(tx, scope.companyId, purchaseIds);
    const billedByPurchase = new Map<string, Map<string, string>>();
    for (const row of billedRows) {
      const bucket = billedByPurchase.get(row.purchaseId) ?? new Map<string, string>();
      bucket.set(row.purchaseItemId, row.billedQuantity);
      billedByPurchase.set(row.purchaseId, bucket);
    }

    const bills = await listBillsForPurchases(tx, scope.companyId, purchaseIds);
    const billsByPurchase = new Map<string, PurchaseBillRow[]>();
    for (const bill of bills) {
      const bucket = billsByPurchase.get(bill.purchaseId) ?? [];
      bucket.push(bill);
      billsByPurchase.set(bill.purchaseId, bucket);
    }

    const paidRows: PaidAmountRowForPurchase[] = await sumPaidAmountsByBillForPurchases(tx, scope.companyId, purchaseIds);
    const paidByPurchase = new Map<string, Map<string, string>>();
    for (const row of paidRows) {
      const bucket = paidByPurchase.get(row.purchaseId) ?? new Map<string, string>();
      bucket.set(row.billId, row.paidAmountUsd);
      paidByPurchase.set(row.purchaseId, bucket);
    }

    return {
      ...page,
      items: page.items.map((row) => {
        const orderedItems = orderedByPurchase.get(row.id) ?? [];
        return {
          ...row,
          receivedStatus: computeReceivedStatus(orderedItems, receivedByPurchase.get(row.id) ?? new Map<string, string>()),
          billedStatus: computeBilledStatus(orderedItems, billedByPurchase.get(row.id) ?? new Map<string, string>()),
          paidStatus: computePaidStatus(billsByPurchase.get(row.id) ?? [], paidByPurchase.get(row.id) ?? new Map<string, string>()),
        };
      }),
    };
  });
}

export async function getById(ctx: RequestContext, id: string): Promise<PurchaseWithShipment> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, async (tx) => {
    const purchase = await findPurchaseById(tx, scope.companyId, id);
    if (!purchase) {
      throw new NotFoundError("Purchase not found");
    }
    const shipment = await findShipmentByPurchaseId(tx, scope.companyId, id);
    if (!shipment) {
      throw new Error(`Purchase ${id} has no shipment row - the 1:1 invariant was violated`);
    }
    const items = await listItemsWithPricingForPurchase(tx, scope.companyId, id);
    const allocations = await listAllocationsForPurchase(tx, scope.companyId, id);
    const additionalCosts = await findCostsByPurchaseId(tx, scope.companyId, id);
    const lmeRecords = await listLmeRecordsForPurchase(tx, scope.companyId, id);
    const hedges = await listHedgesForPurchase(tx, scope.companyId, id);
    const bills = await listBillsForPurchase(tx, scope.companyId, id);
    const receipts = await listReceiptsForPurchase(tx, scope.companyId, id);
    const receivedSums = await sumConfirmedReceivedQuantitiesByItem(tx, scope.companyId, id);
    const receivedByItemId = new Map(receivedSums.map((row) => [row.purchaseItemId, row.receivedQuantity]));
    const billedSums = await sumBilledQuantitiesByItem(tx, scope.companyId, id);
    const billedByItemId = new Map(billedSums.map((row) => [row.purchaseItemId, row.billedQuantity]));
    const paidSums = await sumPaidAmountsByBill(
      tx,
      scope.companyId,
      bills.map((bill) => bill.id),
    );
    const paidByBillId = new Map(paidSums.map((row) => [row.billId, row.paidAmountUsd]));
    return {
      ...purchase,
      shipment,
      items: attachItemFulfilment(items, receivedByItemId, billedByItemId),
      allocations,
      additionalCosts,
      lmeRecords: attachLmeRecordUsage(items, lmeRecords),
      hedges,
      invoices: attachInvoiceVariance(items, bills),
      receipts,
      receivedStatus: computeReceivedStatus(items, receivedByItemId),
      billedStatus: computeBilledStatus(items, billedByItemId),
      paidStatus: computePaidStatus(bills, paidByBillId),
    };
  });
}

/** FR-101/FR-102/FR-103. */
export async function create(ctx: RequestContext, input: CreatePurchaseInput): Promise<PurchaseWithShipment> {
  const scope = requireTenantScope(ctx);
  const { shipment: shipmentInput, brokerCommission: brokerCommissionInput, ...header } = input;

  return withTenantDb(ctx, async (tx) => {
    // Company-wide series (core/provisioning/seed-number-series.ts seeds "PO"
    // with no branch_id) - deliberately not scoped by the purchase's own
    // branchId, which is a data field on the document, not a numbering axis.
    const purchaseNumber = await nextNumber(tx, {
      companyId: scope.companyId,
      docType: "PO",
      date: new Date(header.purchaseDate),
    });

    const purchase = await insertPurchase(tx, {
      ...header,
      // Money (rule 1): never the raw client string straight onto a numeric
      // column - parsed to Decimal and rounded to the column's own scale
      // here, at the repository boundary, same as every other amount field.
      ...(brokerCommissionInput ? { brokerCommission: roundAmount(parseMoney(brokerCommissionInput)) } : {}),
      purchaseNumber,
      companyId: scope.companyId,
      createdBy: scope.userId,
    });

    const shipment = await insertPurchaseShipment(tx, {
      ...shipmentInput,
      shipmentYear: deriveShipmentYear(shipmentInput.loadingDate),
      purchaseId: purchase.id,
      companyId: scope.companyId,
      createdBy: scope.userId,
    });

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "purchase",
      entityId: purchase.id,
      action: "purchase.created",
      after: { ...header, brokerCommission: purchase.brokerCommission, purchaseNumber, shipment: shipmentInput },
    });

    return { ...purchase, shipment };
  });
}

/** FR-103 (edit shipment info)/general header edits - Draft only (rule 8). */
export async function update(ctx: RequestContext, id: string, input: UpdatePurchaseInput): Promise<PurchaseWithShipment> {
  const scope = requireTenantScope(ctx);
  const { shipment: shipmentInput, brokerCommission: brokerCommissionInput, ...header } = input;

  return withTenantDb(ctx, async (tx) => {
    const existing = await findPurchaseById(tx, scope.companyId, id);
    if (!existing) {
      throw new NotFoundError("Purchase not found");
    }
    assertDraft(existing);

    let purchase = existing;
    if (Object.keys(header).length > 0 || brokerCommissionInput !== undefined) {
      const updated = await updatePurchase(tx, scope.companyId, id, {
        ...header,
        // Money (rule 1): parsed to Decimal and rounded at the repository
        // boundary, same as create() - never the raw client string.
        ...(brokerCommissionInput !== undefined ? { brokerCommission: roundAmount(parseMoney(brokerCommissionInput)) } : {}),
        updatedBy: scope.userId,
      });
      if (!updated) {
        throw new NotFoundError("Purchase not found");
      }
      purchase = updated;
    }

    let shipment = await findShipmentByPurchaseId(tx, scope.companyId, id);
    if (!shipment) {
      throw new Error(`Purchase ${id} has no shipment row - the 1:1 invariant was violated`);
    }
    if (shipmentInput && Object.keys(shipmentInput).length > 0) {
      const loadingDate = shipmentInput.loadingDate ?? shipment.loadingDate;
      const updatedShipment = await updatePurchaseShipment(tx, scope.companyId, id, {
        ...shipmentInput,
        shipmentYear: deriveShipmentYear(loadingDate),
        updatedBy: scope.userId,
      });
      if (!updatedShipment) {
        throw new Error(`Purchase ${id} has no shipment row - the 1:1 invariant was violated`);
      }
      shipment = updatedShipment;
    }

    const changedKeys = brokerCommissionInput !== undefined ? [...Object.keys(header), "brokerCommission"] : Object.keys(header);
    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "purchase",
      entityId: id,
      action: "purchase.updated",
      before: pick(existing, changedKeys),
      after: pick(purchase, changedKeys),
    });

    return { ...purchase, shipment };
  });
}

/**
 * PL-3 (renamed from "approve"): commits the PO to the supplier. No
 * inventory or financial effect of its own - `purchase.approved` still
 * fires for any future subscriber (none listens today - PL-1/ADR 0016
 * moved stock to receipt confirm), same event name kept for continuity
 * rather than invented churn. `transitionPurchaseStatus`'s conditional
 * UPDATE is what makes "two concurrent issues -> exactly one succeeds"
 * true: the loser's UPDATE matches zero rows (status has already moved
 * on) and this function reports that as a 409, never a silent no-op
 * success.
 */
export async function issue(ctx: RequestContext, id: string): Promise<PurchaseRow> {
  const scope = requireTenantScope(ctx);
  const transition = findTransition(PURCHASE_WORKFLOW, "issue");

  return withTenantDb(ctx, async (tx) => {
    const existing = await findPurchaseById(tx, scope.companyId, id);
    if (!existing) {
      throw new NotFoundError("Purchase not found");
    }

    const shipment = await findShipmentByPurchaseId(tx, scope.companyId, id);
    if (!shipment) {
      throw new Error(`Purchase ${id} has no shipment row - the 1:1 invariant was violated`);
    }
    const items = await listItemsWithPricingForPurchase(tx, scope.companyId, id);
    const lmeRecordsForPurchase = await listLmeRecordsForPurchase(tx, scope.companyId, id);

    runGuards(transition, { items, pricingType: existing.pricingType, hasLmeRecord: lmeRecordsForPurchase.length > 0 });

    const row = await transitionPurchaseStatus(tx, scope.companyId, id, {
      from: transition.from,
      to: transition.to,
      extra: { issuedBy: scope.userId, issuedAt: new Date() },
    });
    if (!row) {
      throw new ConflictError(`Purchase ${existing.purchaseNumber} is "${existing.status}", not "${transition.from}" - cannot issue`);
    }

    await eventBus.emit(tx, "purchase.approved", {
      purchaseId: id,
      companyId: scope.companyId,
      branchId: row.branchId,
      warehouseId: shipment.warehouseId,
      approvedBy: scope.userId,
      items: items.map((item) => ({
        purchaseItemId: item.id,
        itemId: item.itemId,
        gradeId: item.gradeId,
        quantity: item.quantity,
        uomId: item.uomId,
      })),
    });

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "purchase",
      entityId: id,
      action: "purchase.issued",
      before: { status: existing.status },
      after: { status: row.status },
    });

    return row;
  });
}

/**
 * PL-3: a PO the buyer calls off before it's fulfilled. Draft or Issued
 * only, and only while nothing's been received or billed against it
 * (requireNothingFulfilledForCancel) - a partially-fulfilled PO is a real
 * transaction in motion, not a dead letter. Not modeled as a
 * WorkflowTransition/findTransition entry - see CANCELLABLE_FROM_STATUSES'
 * doc comment for why the engine's static from->to lookup doesn't fit a
 * transition reachable from two different starting states.
 */
export async function cancel(ctx: RequestContext, id: string): Promise<PurchaseRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const existing = await findPurchaseById(tx, scope.companyId, id);
    if (!existing) {
      throw new NotFoundError("Purchase not found");
    }
    if (!CANCELLABLE_FROM_STATUSES.includes(existing.status)) {
      throw new ConflictError(`Purchase ${existing.purchaseNumber} is "${existing.status}" - cannot cancel`);
    }

    const hasAnyReceipt = await hasAnyReceiptForPurchase(tx, scope.companyId, id);
    const hasAnyBill = await hasAnyBillForPurchase(tx, scope.companyId, id);
    requireNothingFulfilledForCancel({ hasAnyReceipt, hasAnyBill });

    const row = await transitionPurchaseStatus(tx, scope.companyId, id, {
      from: existing.status,
      to: "cancelled",
      extra: { cancelledBy: scope.userId, cancelledAt: new Date() },
    });
    if (!row) {
      throw new ConflictError(`Purchase ${existing.purchaseNumber} is "${existing.status}" - cannot cancel`);
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "purchase",
      entityId: id,
      action: "purchase.cancelled",
      before: { status: existing.status },
      after: { status: row.status },
    });

    return row;
  });
}

function pick(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    result[key] = source[key];
  }
  return result;
}
