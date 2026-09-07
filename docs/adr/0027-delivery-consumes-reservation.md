# 0027 - Delivery consumes reservation, stock actually leaves (S-4)

## Status

Accepted

## Context

S-3 (ADR 0026) built the Sales Order document and its Draft->Approved
transition, which calls S-2's `reserveFromLot` to hold stock (a real,
row-locked reservation - no stock movement yet). `docs/SALES-MODULE-PLAN.md`'s
own two-step model requires a second, separate step to actually move stock
out: S-4 builds the Delivery document, whose Draft->Confirmed transition
calls S-2's already-built `consumeReservation` to convert a reservation into
a genuine outbound `stock_movements` row - the same mechanism S-2 already
concurrency-proved, now exercised by a real business transaction for the
first time on the sell side (mirroring how S-3's approve() was the first
real caller of `reserveFromLot`).

## Decisions

- **Delivery mirrors Purchase Receipt's shape exactly**: its own
  `delivery_status` enum (`draft/confirmed/reversed`), its own Draft->
  Confirmed one-way workflow (no re-confirm, no edit after Confirmed - rule
  8), its own gapless number series (`DELIVERY`, `DEL-{FY}-{0000}`), its own
  permission namespace (`sales.delivery.{create,confirm}`). A sale can have
  MULTIPLE deliveries (partial fulfilment), so - like Purchase Receipts -
  there is both a nested `GET/POST /sales/:id/deliveries` and a standalone,
  cross-sale `GET /sales-deliveries` for the "Deliveries" list screen.

- **The denominator for "how much is left to deliver" is RESERVED quantity,
  not ordered quantity - a deliberate divergence from Purchase's own
  `computeReceivedStatus`.** Purchase compares received-so-far against each
  item's ordered quantity, because a PO's ordered quantity is itself the
  ceiling on what can ever be received. Sales is different: an item's
  ordered `quantity` may exceed what actually got reserved at Approve time
  (a partial-pick scenario S-3 already allows), and only reserved stock can
  ever be delivered - `consumeReservation` enforces this at the mechanism
  level regardless. `sales-lifecycle.ts`'s `computeDeliveredStatus` therefore
  takes `reservedQty` per item as its ceiling, sourced from
  `stock_lot_reservations.qty` (summed per sales item, excluding released
  reservations) rather than from `sales_items.quantity`.

- **"Delivered so far" is read from `stock_lot_reservations.consumedQty`,
  never re-derived by summing `delivery_items`.** `consumeReservation` is
  already the sole writer of `consumedQty` and already enforces "cannot
  over-consume" at the row-lock level (S-2, ADR 0025). Both the create-time
  over-delivery guard (`deliveries.service.ts`'s `create()`) and the
  `deliveredStatus`/`realized` figures `sales.service.ts` attaches to
  `getById`/`list` read this same authoritative counter via
  `deliveries.repository.ts`'s `sumReservedAndConsumedBySalesItem[ForSalesOrders]`
  - avoiding two sources of truth for the same fact.

- **A single delivery line may span multiple reservations.** A sales item
  can have several lot picks (several `sales_item_lots` rows, each with its
  own `stock_lot_reservations` row) backing one line. `confirm()` consumes
  across them in reservation-creation order (oldest first) until the
  delivery line's own `deliveredQuantity` is exhausted, all inside the same
  transaction as the Draft->Confirmed status change - if any single
  `consumeReservation` call fails partway (only possible if a concurrent
  delivery against the same sale raced past the create-time check), the
  whole confirm rolls back: no partial consumption, no partial status
  change. This mirrors S-3's own approve() "all-or-nothing across a loop of
  lot operations" contract exactly.

- **`realized` is a derived field, never stored** - `realized =
  deliveredStatus !== "not_delivered"`, computed on every `GET`
  (`sales.service.ts`'s `getById`/`list`), exactly like Purchase's own
  `receivedStatus`/`billedStatus`/`paidStatus`. There is no
  `sales.realizedProfit` column and never will be one; storing a derived
  boolean would immediately go stale the moment a reservation changes
  underneath it.

- **No auto-close.** `docs/SALES-MODULE-PLAN.md`'s S-4 section, read
  verbatim, contains no auto-close instruction - only `computeDeliveredStatus`.
  The `sales` status enum's own schema comment already anticipates this:
  Closed is derived and automatic once **both** S-4 and S-5 exist (mirroring
  Purchase's own `maybeAutoClosePurchase`, which requires both Received AND
  Billed) - S-5 (Invoice/Payment) doesn't exist yet, so Sales has no
  "Closed" transition at all in this phase, same as S-3 left it.

- **New Delivery-specific fields are Tier-1 typed columns, not Tier-2.**
  `deliveryOrderNo`, `dispatchDate`, `vehicleNumber`, `transportCompany`,
  `driverName`, `gatePassNo`, `podReceived`, `customerAcknowledgement` are
  all real, typed columns on the `deliveries` table with matching
  `field_definitions` rows for label/order only - mirroring Purchase
  Receipt's own precedent exactly. Nothing in the plan asks for per-company
  relabeling of these fields.

## Consequences

- Confirming a Delivery is the first real, non-test caller of S-2's
  `consumeReservation` - the same row-locked mechanism ADR 0025 already
  proved safe under 100-way concurrency now moves real stock for a real
  sale, not just its own test fixtures.
- `deliveries` and `delivery_items` are two new tables, mirroring
  `purchase_receipts`/`purchase_receipt_items` field-for-field except for
  the sell-side-specific header fields listed above.
- No Invoice/Payment, no Dashboard, no reversal/correction flow for a
  confirmed delivery (the `"reversed"` enum value stays reserved-but-unwired,
  same as Purchase Receipt's own history) - all explicitly out of scope,
  gated on S-5/S-6 per the plan's own build order.
- `sales.service.ts`'s `getById` now attaches `reservedQty`/`consumedQty` to
  each item in its response (not just the sale-level `deliveredStatus`
  aggregate) so the frontend's Deliver form can cap its outstanding-qty
  input without a second round trip - a small, deliberate widening of
  `SalesItemWithLots` beyond what S-3 originally shipped.
