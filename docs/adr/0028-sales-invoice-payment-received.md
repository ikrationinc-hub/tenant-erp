# 0028 - Sales Invoice + Payment Received (accounts receivable, S-5)

## Status

Accepted

## Context

S-1 through S-4 are built, verified, and committed (customer master, lot
allocation/costing engine, Sales Order with reserve-on-approve, Delivery
consuming reservations into stock-out). Per `docs/SALES-MODULE-PLAN.md`'s
build order, S-5 is the last document-lifecycle phase: Invoice + Payment
Received, the receivables mirror of Purchase's Bill + Payment (ADR 0017,
PL-5). This finally makes the Sales Order's own "Closed" status reachable -
both ADR 0026 and ADR 0027 documented Closed as derived once BOTH Delivered
AND Invoiced exist; S-5 is the phase that supplies the second axis.

A full audit of Purchase's Bill/Payment modules was done first - S-5
mirrors that shape field-for-field wherever sensible, diverging only where
the plan or CLAUDE.md's vocabulary explicitly requires it.

## Decisions

- **Sales Invoice mirrors Purchase Bill's status enum exactly**:
  `draft/approved/reversed/paid`, including the same auto-transition-to-
  `paid` inlined at the bottom of the payment-creation service call
  (`sales-payments-received.service.ts`'s `create()`, mirroring
  `purchase-payments.service.ts`'s own inline pattern - no separate
  `maybeAutoPayInvoice` helper). Purely financial, no stock/reservation
  interaction at all (unlike Delivery).

- **Sell-side Payment is named for CLAUDE.md's vocabulary table**: table
  `payments_received`, permission action `sales.receipt.record` (not
  `sales.payment.record`) - "Receipt of payment" is the canonical term for
  money we're paid. "Receipt" appears only in the permission/action name,
  never as a bare document noun, to avoid colliding with Purchase Receipt's
  own vocabulary (a physical goods-receipt concept, unrelated to this).

- **The Sales Invoice's own quantity ceiling is DELIVERED quantity, not
  ordered quantity - a deliberate divergence from Purchase Bill's own
  ceiling (ordered quantity).** Purchase can bill before receiving (a
  supplier's invoice often arrives before the goods do); Sales cannot
  invoice more than actually shipped - an invoice is fundamentally "what we
  billed for what we sent," and `sales-invoices.service.ts`'s `create()`
  enforces this per line via `sumDeliveredQuantitiesByItem` (CONFIRMED
  deliveries only, mirroring Purchase Receipt's own "only confirmed
  counts" precedent) versus `sumInvoicedQuantitiesByItem` (draft AND
  approved invoices both count - invoicing itself is the financial fact,
  mirroring Purchase Bill's own "no approval gate on the sum" rule).

- **"Invoice independent of delivery" (the plan's own literal required
  test) is satisfied at the SALE level, not by weakening the per-item
  ceiling above.** An invoice's `items` array is entirely optional -
  exactly like Purchase Bill's own optional-items pattern. A header-only
  invoice (no lines) can be created and approved against any
  `approved`/`closed` sale regardless of its `deliveredStatus`, satisfying
  the plan's requirement. When items ARE given, each line is still capped
  at that specific item's own delivered quantity - the two rules coexist
  without contradiction: the SALE can be invoiced with nothing delivered
  (a header-only invoice), but a specific ITEM line can never be invoiced
  past what that item actually shipped.

- **Credit-exposure warning switches to real outstanding receivables.**
  S-3's `computeCreditExposure` (ADR 0026) summed the customer's other
  *approved sales orders'* value - an explicitly-documented stopgap, since
  no invoice/payment data existed yet. Now that `sales_invoices`/
  `payments_received` are real, `sales.service.ts`'s `approve()` switches
  its exposure input to the sum of every approved, not-fully-paid
  invoice's own outstanding balance (`invoiceAmountUsd - paid`, via
  `sumOutstandingReceivablesForCustomer`) plus this sale's own value (not
  yet invoiced, so it isn't in that sum). The "not full outstanding
  receivables" caveat is dropped from the warning text since it's no
  longer true. Still WARN-never-block (the plan's locked decision,
  unchanged) - `sumApprovedSalesValueForCustomer` (the old proxy) is
  deleted outright as dead code, not kept as a fallback.

- **Payment Received allocates across MULTIPLE invoices in one
  transaction**, scoped to a CUSTOMER (not one invoice/sale) - direct
  mirror of `payments`/`payment_allocations`. Re-sums
  `sumPaidAmountsByInvoice` fresh inside the same transaction for every
  touched invoice before checking each allocation's outstanding balance,
  never trusting a stale read - same discipline
  `purchase-payments.service.ts` uses. After all allocations are written,
  every touched invoice is re-checked (fresh sum again) for auto-transition
  to `paid`, and every SALE any of those invoices belongs to is re-checked
  for `maybeAutoCloseSalesOrder` - a single payment can complete more than
  one sale's journey to Closed at once if it happens to fully settle
  invoices across multiple sales.

- **`maybeAutoCloseSalesOrder`** (new, `sales-lifecycle.ts`) mirrors
  `maybeAutoClosePurchase` exactly: a no-op unless the sale is currently
  `approved` AND both `deliveredStatus === "fully_delivered"` AND
  `invoicedStatus === "fully_invoiced"`, CAS `transitionSalesStatus(from:
  "approved", to: "closed")`, audited `sales.closed` with
  `changedBy: existing.approvedBy ?? existing.createdBy`. Called from BOTH
  `sales-invoices.service.ts`'s `approve()` (after an invoice's own
  approval changes the invoiced axis) and
  `sales-payments-received.service.ts`'s `create()` (after a payment
  might complete the paid axis) - the same "recompute from freshest
  figures, in the same transaction as whatever last changed the picture"
  pattern Purchase's own two callers (`purchase-receipts.service.ts`'s
  `confirm()` and `purchase-bills.service.ts`'s `approve()`) already
  established. Note: Closed requires fully DELIVERED and fully INVOICED,
  not fully PAID - matching Purchase's own precedent (`maybeAutoClosePurchase`
  requires Received + Billed, not Received + Billed + Paid) and the plan's
  own schema comment ("both S-4 and S-5"), not a third payment-completion
  gate.

- **Tax is a clean, unenforced seam** - a single nullable
  `taxAmount numeric(18,2)` column on `sales_invoices` only, never
  computed/summed/validated, round-trips via `roundAmount(parseMoney(...))`
  exactly like `invoiceAmountUsd`. No tax master, no line-level tax.
  Mirrors Purchase Bill's own stance exactly (ADR 0017's "leave a seam"
  decision, referenced by the plan itself as "same stance as Purchase
  Bill").

- **No bespoke file upload code.** Any future "receipt upload" or invoice
  attachment need goes through the existing generic `core/storage`/
  `modules/attachments` module (entity-agnostic `POST /:entity/:entityId/
  :fieldKey`), registered via new `entity` strings if/when actually needed
  - same as Purchase Bill/Payment, which have zero bespoke attachment code
  themselves. Nothing was built for this in S-5, matching Purchase's own
  precedent of not needing new code for FR-110.

## Consequences

- Approving a Sales Invoice and recording a Payment Received are the
  first two real, non-test paths that can transition a Sales Order all the
  way to `Closed` - both S-3's `reserveFromLot` and S-4's
  `consumeReservation` calls now sit underneath a document lifecycle that
  can actually terminate, not just accumulate reservations/deliveries
  forever.
- `sales_invoices`, `sales_invoice_items`, `payments_received`,
  `sales_payment_allocations` are four new tables, mirroring Purchase's
  own `purchase_bills`/`purchase_bill_items`/`payments`/
  `payment_allocations` field-for-field except where a deliberate
  divergence is documented above.
- `sales.service.ts`'s `getById`/`list` now attach `invoicedStatus`/
  `paidStatus` alongside the existing `deliveredStatus`/`realized`, and
  each item in `getById`'s response carries its own `deliveredQty`/
  `invoicedQty` (mirroring the existing `reservedQty`/`consumedQty`
  precedent) so the frontend's Invoice form can cap its outstanding-qty
  input without a second round trip.
- No S-6 (Dashboard) - explicitly deferred, gated on this phase per the
  plan's own build order.
- `sumApprovedSalesValueForCustomer` (S-3's credit-exposure proxy) is
  fully removed from the codebase, not deprecated - there is no reason to
  keep a stopgap once the real mechanism it stood in for exists.
