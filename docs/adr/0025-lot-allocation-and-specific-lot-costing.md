# 0025 - Lot allocation + specific-lot costing engine (S-2)

## Status

Accepted

## Context

`docs/SALES-MODULE-PLAN.md` §1.1/§1.2 flags specific-lot allocation and
costing as the highest-risk code in the entire ERP: a Sales Order line must
be able to reserve real, physical inventory against one specific incoming
lot (not a generic item/warehouse balance), the reservation must never
oversell that lot under concurrent access, and the eventual sale's cost of
goods must be the exact landed cost of the specific lot(s) it drew from -
not an average cost across all stock of that item. Getting the concurrency
control wrong here means either overselling physical stock the company
does not have, or silently corrupting the specific-lot cost figures that
feed gross profit.

S-2 builds this engine in isolation, with no Sales Order document on top
(that is S-3, a separate future phase gated on this one). `stock_lots` rows
are seeded now purely from Purchase Receipt confirmation, so S-2 has real
data to reserve against in its own tests.

Note on terminology: ADR 0014 established that `purchase_allocations`
("Customer Allocation") is a *soft* reservation - non-binding intent that
never locks inventory. `stock_lot_reservations` in this ADR is a
completely different, unrelated concept despite the shared word
"reservation" - it is a *hard*, inventory-affecting lock that genuinely
prevents overselling a specific lot. Do not conflate the two; ADR 0014's
"soft reservation" guidance about the Sales module not being bound to a
customer's allocation is orthogonal to this engine.

## Decisions

- **`stock_lots` is a new, lockable counter row - one per confirmed
  Purchase Receipt LINE.** `stock_movements` (the existing append-only
  ledger) is deliberately left untouched as the permanent, immutable audit
  trail of every physical quantity that ever moved - it has no per-lot
  balance row to lock, and locking it directly would mean locking an
  unbounded, ever-growing table with no natural row per "this specific
  lot's remaining capacity." `stock_lots` exists purely to make "is there
  enough of THIS lot left" a single row-locked read: `receivedQty` is
  fixed once at creation (the physical fact, from the receipt line);
  `reservedQty`/`deliveredQty` are cached counters mutated ONLY under this
  row's own `SELECT ... FOR UPDATE` lock. This is the same division of
  labor `number_series` already has with the documents it numbers: a
  small, fast, lockable counter row alongside a separate, permanent
  history.

- **A receipt line IS a lot - no separate "lot creation" step.** PL-1's
  `receipt.confirmed` event already fires exactly once, synchronously, in
  the same transaction as the stock_movements write; `stock_lots` is
  inserted in the same loop, same transaction, by the same subscriber
  (`inventory-subscriber.ts`). There was no reason to invent a distinct
  lot concept when a confirmed receipt line already is one - unique
  physical goods, a fixed quantity, a fixed rate, arriving together.

- **The row lock IS the concurrency control - identical contract to
  `core/numbering`'s `nextNumber`.** `reserveFromLot`/`releaseReservation`/
  `consumeReservation` all take a `tx` already open on the caller's
  transaction and never open their own; each locks the lot row FIRST
  (`findLotForUpdate`), then reads availability from the just-locked row -
  never check-then-lock. Two concurrent callers against the same lot
  serialize on this lock: the loser blocks until the winner's transaction
  commits or rolls back, then re-reads the now-current counters. The
  `stock_lots_counters_within_received` CHECK constraint
  (`reservedQty + deliveredQty <= receivedQty`) is defense-in-depth only,
  never the primary mechanism - exactly the same division `stock_movements
  _sign_matches_type` already established for that table.

- **Cost allocation is one pure function, reused for two distinct
  callers.** `core/inventory-lots/cost-allocation.ts`'s `costAllocation`
  takes a set of `{lotId, qty, landedRate}` lines plus a shared-charge pool
  (freight/insurance/customs/other) and a basis (`"qty"` default, `"value"`
  available) and returns each line's total cost. It is called once at
  receipt-confirm time (`purchase-receipts.service.ts`'s `confirm()`) with
  the purchase's own `purchase_additional_costs` (one row per PURCHASE, no
  `purchase_item_id` column) spread pro-rata across that receipt's own
  lines, using each line's raw `purchaseRateUsd` as the starting
  `landedRate` - the result's per-lot cost, divided back down by
  `landedRatePerUnit`, becomes `stock_lots.landedRate`. The same function
  is reserved for reuse by a future sale's own additional-charge spreading
  (S-3), called instead with each allocated lot's REAL `landedRate` (which
  already has the purchase's shared charges folded in) and the sale's own
  charges, if any - never double-allocating the purchase's own pool a
  second time. Rounding uses a "last line absorbs the remainder" allocation
  so per-line shares always sum exactly to the shared-charge total, never
  drifting by a rounding cent.

- **Landed rate is computed once, at receipt-confirm time, and never
  recomputed.** `stock_lots.landedRate` is fixed the moment the lot is
  created (from `ReceiptConfirmedEvent.items[].landedRate`, itself computed
  by the publisher before emitting). A later edit to
  `purchase_additional_costs` (if the codebase ever allows editing costs
  after receipt - it does not today; `purchase-costs.service.ts` blocks
  non-draft purchases) has no retroactive effect on lots that already
  exist - matching rule 8's "posted documents are immutable" spirit
  extended to derived-at-creation-time figures.

- **No basis defaults changed, no double allocation.** `"qty"` is the
  explicit default basis (S-2's own instruction), matching the simplest,
  most defensible default for a trading company where landed cost per
  physical unit is the natural mental model. `"value"` basis exists in the
  same function for a future case where a shared charge should track value
  rather than volume (e.g. insurance, which realistically scales with
  cargo value more than weight) - not wired up as a user-facing choice
  anywhere yet; that is a future UI decision, not this ADR's.

- **`grossProfit` is a separate pure function**, decimal.js throughout,
  2dp-rounded (`roundAmount`, matching every other amount column in this
  codebase) for both the profit figure and the percent - guarded against
  division-by-zero on a genuinely $0 sale rather than throwing.

- **No Sales Order table, no FK from `stock_lot_reservations` to one.**
  `referenceType`/`referenceId` mirror `stock_movements`' own polymorphic
  convention deliberately, so S-3's eventual Sales Order line can reserve
  against a lot with zero schema changes here - just a new
  `referenceType` value (`"sales_order_item"` or similar) alongside S-2's
  own test-only `"test_reservation"`.

## Consequences

- Reserving, releasing, and consuming against a specific lot are each a
  single-row-locked read-then-write, proven safe under real concurrent
  Postgres transactions (Testcontainers, never mocked) at 100 concurrent
  callers against one lot, 10 consecutive runs, zero flakiness observed.
- `stock_movements` gains exactly one new movement type
  (`sale_delivery`, negative/outbound) and one new CHECK-constraint clause,
  written the same `ALTER TYPE ... ADD VALUE` + later `::text`-cast CHECK
  re-add sequencing 0027 already established for `purchase_reversal` -
  Postgres's "unsafe use of new value" restriction on a bare enum value
  added earlier in the same transaction never applies to the `::text` cast,
  so both statements can safely live in the same migration file even
  though the whole file runs inside one transaction
  (`migration-runner.ts`'s `applyPendingMigrationsWithDb`).
- `stock_lots`/`stock_lot_reservations` are entirely new tables with no
  consumers outside S-2's own tests yet - S-3 (the Sales Order document)
  is the first real caller, and is explicitly out of scope here.
- `ReceiptConfirmedEvent` grows one field (`landedRate` per item) - a
  backward-compatible addition to an event only one subscriber
  (`modules/inventory`) currently listens to.
