# 0026 - Sales Order lifecycle and lot reservation (S-3)

## Status

Accepted

## Context

`docs/SALES-MODULE-PLAN.md`'s own build order requires S-2 (lot allocation +
specific-lot costing, ADR 0025) to be built and concurrency-proven in
isolation before any Sales Order document goes on top. That gate passed
(30/30 runs of the 100-concurrent-reservation test, zero flakiness). S-3
builds the Sales Order document itself: header/shipment/items/pricing,
mirroring Purchase Order's own 4-doc pattern, with its Draft->Approved
transition calling S-2's `reserveFromLot` to actually lock stock - the
plan's own "Approval RESERVES lot quantity (soft hold)" decision, where
"soft" describes the two-step model (approval reserves, delivery consumes),
not the strength of the lock itself - the reservation is a real, row-locked
hold, identical in mechanism to everything ADR 0025 already proved safe.

## Decisions

- **Status enum is `draft/approved/closed/cancelled`, a deliberate
  divergence from Purchase's `draft/issued/closed/cancelled`.** Purchase's
  own history (ADR 0018) renamed "Approved" away to "Issued" because
  Purchase has no concept the old "Approved" name still described once
  Posted was dropped. Sales is different: Draft->Approved is exactly the
  moment lot reservation happens, and "Approved" is the term
  `docs/SALES-MODULE-PLAN.md`'s own S-3 prompt uses throughout. Confirmed
  with the user explicitly rather than defaulting to a literal mirror of
  Purchase's enum values.

- **`sales_item_lots` is NOT `purchase_allocations`' sibling, despite the
  shared word "allocation" in the spec's own vocabulary.** `purchase_
  allocations` (ADR 0014) is a soft, purely informational "which customer
  might eventually buy this stock" marker - no lock, no `stock_lots`
  interaction, no enforcement across rows. `sales_item_lots` is a real lot
  PICK: one row per (sales item, stock lot, qty), created at Draft time via
  a live but UNLOCKED availability read (`receivedQty - reservedQty -
  deliveredQty`), and converted into a genuine `stock_lot_reservations` hold
  only when Draft->Approved actually calls `reserveFromLot` for each pick,
  in the same transaction as the status change. The Draft-time pick and the
  Approve-time reservation are deliberately two different moments: a picker
  can race past the Draft-time check (another sale reserves the same lot in
  between) and get a clear `ConflictError` from `reserveFromLot` itself at
  Approve - this is expected, not a bug, and is exactly what ADR 0025's own
  concurrency guarantee is for.

- **Reserve-on-approve is all-or-nothing, in one transaction.** `approve()`
  runs guards, performs the CAS status transition
  (`transitionSalesStatus`), then loops every `sales_item_lots` row calling
  `reserveFromLot` - if any single reservation throws `ConflictError`
  (insufficient capacity on that specific lot), the whole transaction rolls
  back: the status change AND every reservation already made earlier in the
  same loop. No partial reservation, no partially-approved sale, matching
  the plan's own explicit requirement.

- **Cancel is reservation-release's mirror.** Draft or Approved ->
  Cancelled releases every reservation the sale's lot picks are holding
  (`releaseReservation`, per pick, same transaction as the status change) -
  what Approve reserves, Cancel gives back. A pick that was never reserved
  (still Draft, `reservationId` null) has nothing to release, so this is a
  no-op loop in that case. A reserved pick (`sales_item_lots.reservationId`
  set) cannot be removed directly via the lot-picker's own delete endpoint -
  only Cancel's release path can unwind it, since a soft-delete on the pick
  row would silently leave a real, unaccounted-for hold on `stock_lots.
  reservedQty`.

- **Credit-limit check is "open order exposure," explicitly not
  "outstanding receivables."** `docs/SALES-MODULE-PLAN.md` §4 lists the
  scope of this check (outstanding receivables vs. outstanding + open
  orders) as an unresolved client question, and there is no receivables
  data of any kind until S-5 (Invoice/Payment) exists. Confirmed with the
  user: S-3's check sums the customer's OTHER currently-`approved` sales
  orders' value plus this sale's own value, compares against
  `customers.creditLimit`, and - if over - attaches a `warnings: string[]`
  entry to the `approve()` response. It never throws, never blocks
  (`docs/SALES-MODULE-PLAN.md`'s locked "WARN but allow" decision), and the
  warning text itself says "open order value," not "outstanding," so it
  cannot be mistaken for a receivables figure once S-5 actually adds one.

- **`sales-lifecycle.ts` does not exist yet - deferred to S-4.** Purchase's
  own `purchase-lifecycle.ts` (computeReceivedStatus/computeBilledStatus/
  maybeAutoClosePurchase) has nothing to mirror yet: there is no
  `sales_deliveries`/`sales_invoices` table to query. Building empty stub
  functions now would be speculative code with nothing real behind it -
  confirmed with the user to defer this file's real content to S-4, when
  Delivery exists to give it something to compute. S-3 therefore has no
  "Closed" transition at all (no route, no permission) - Closed remains
  entirely undefined until S-4/S-5 exist to derive it, exactly as
  Purchase's own "Closed" is never a manually-invoked transition.

- **`pricingType` accepts only `"fixed"` in this phase - LME sales pricing
  is out of scope for S-3.** Discovered during implementation, not planned
  up front: Purchase's `lme_records` table is hard-FK'd to `purchases.id`
  and named around the buy side (`finalPurchaseRateUsd`) - it cannot be
  reused for Sales as-is, and building a genuine LME-sales-pricing mirror
  (its own table, its own "Agreed % of LME Sales Price" formula) is real
  new scope this phase did not budget for. `salesPricingTypeEnum` keeps
  both `"lme"`/`"fixed"` values at the schema level (so a later phase can
  add LME sales pricing without a migration), but `sales.validator.ts`
  only accepts `"fixed"` today, rejecting `"lme"` with a clear "not yet
  supported" message rather than silently mishandling it. This is a scope
  narrowing flagged explicitly, not a silent omission.

## Consequences

- Approving a Sales Order is the first real, non-test caller of S-2's
  `reserveFromLot`/`releaseReservation` - the engine's own concurrency
  guarantee (ADR 0025) now protects a genuine business transaction, not
  just its own test fixtures.
- `sales`, `sales_shipments`, `sales_items`, `sales_pricing`,
  `sales_item_lots`, `sales_additional_costs` are six new tables, all
  mirroring Purchase's own equivalents field-for-field except where a
  deliberate divergence is documented above.
- No LME sales pricing, no Delivery, no Invoice/Payment, no Dashboard - all
  explicitly out of scope, gated on later phases per the plan's own build
  order.
- The credit-limit warning's scope will need a real revision once S-5
  ships real receivables data - this ADR's "open order exposure" framing
  is a deliberate, labeled stopgap, not a permanent design.
