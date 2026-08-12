# 0015 - Stock moves on supplier invoice approval, not purchase approval

## Status

Accepted

## Context

Prior to this change, approving a purchase order (`purchase.approved`) wrote
`stock_movements` rows directly - the inventory subscriber listened for
that event and posted a `purchase_receipt` for every item. The client
confirmed this models the business wrong: a purchase order is **intent**
only. Physical stock does not exist in the warehouse, and must not be
recorded as available, until the **supplier invoice** for that purchase
has actually been received, uploaded, and approved. The purchase and the
supplier invoice are two different documents with two different
lifecycles; conflating them meant the ledger could show stock on hand for
goods that hadn't shipped yet.

A second, harder problem falls out of the first: once stock is tied to
invoice approval, editing a purchase's items *after* its invoice is
already approved must not silently leave stale stock on the books. The
ledger is append-only (`stock_movements` rows are never UPDATEd or
DELETEd - ADR 0007's numbering/audit discipline and CLAUDE.md rule 8
extend the same "never mutate a posted record" principle here), so a
correction can only ever be a new offsetting row, never a rewrite.

## Decisions

- **`purchase_invoices` is a new, first-class document**, not a field on
  `purchases`. It has its own gapless number (`SINV-{FY}-{seq}`, reusing
  the existing `number_series` + `SELECT ... FOR UPDATE` mechanism from
  ADR 0007), its own `draft -> approved` workflow, and its own
  `purchase.invoice.create/update/approve` permissions - distinct from
  `purchase.po.*`. `PURCHASE_INVOICE_WORKFLOW`'s single `approve`
  transition is guarded so an invoice cannot be approved while its parent
  purchase is still Draft (a PO must itself be approved before the goods
  it describes can be invoiced).

- **One invoice per purchase, enforced, for now.** The schema
  (`purchase_invoices.purchase_id`) is one-to-many so multi-invoice
  (partial/split invoicing) is not precluded, but `purchase-invoices
  .service.ts` currently rejects a second `create` against a purchase
  that already has one via a module constant, `ALLOW_PARTIAL_INVOICING =
  false`. Flipping that constant is the intended extension point if the
  client later confirms partial invoicing is needed - no schema change
  required.

- **`invoice.approved` is the only event that writes a stock movement for
  a purchase.** `purchase.approved` no longer has an inventory
  subscriber at all. `handleInvoiceApproved` (inventory-subscriber.ts)
  writes one `purchase_receipt` row per invoice's purchase item, in the
  same transaction as the approval (ADR 0007's "audit/side-effects share
  the business transaction" pattern, extended to inventory).

- **Editing items after invoice approval forces re-approval, which
  reconciles stock via reverse-then-reissue - never mutation.** Only two
  edits are "stock-relevant" (the client confirmed this scope explicitly,
  declining to guess more broadly): adding an item, and changing an
  existing item's quantity. Either one flips any `approved` invoice for
  that purchase back to `draft` (`flipApprovedInvoicesToDraft`), which is
  why `assertItemsEditable` allows edits through Draft *and* Approved
  purchase status (items only lock once the purchase is `posted`) -
  without that, the re-approval path this decision depends on would be
  unreachable.

  Re-approving runs the exact same `handleInvoiceApproved` code path as a
  first approval: it first reverses every currently-active receipt for
  that invoice (an "active" receipt is one with no existing row pointing
  back at it via `reversal_of_movement_id` - a self-referencing FK, not a
  mutable "reversed" flag, so the original receipt itself is never
  touched), writing a negative-quantity `purchase_reversal` row for each;
  then it writes fresh `purchase_receipt` rows for the purchase's
  *current* items. A first approval has nothing active to reverse, so the
  same code degenerates correctly to pure receipt-writing - there is no
  separate "first approve" vs. "re-approve" branch anywhere.

- **The ledger enforces its own sign discipline at the database level.**
  A CHECK constraint (`stock_movements_sign_matches_type`) requires
  `purchase_receipt` rows to be positive and `purchase_reversal` rows to
  be negative, cast to `::text` in the constraint to sidestep Postgres's
  restriction on referencing an enum value added in the same migration
  transaction. Balance is still `SUM(quantity) GROUP BY (item, grade,
  warehouse, uom)`, per ADR - no stored running total, so an incorrect
  reconciliation can never silently drift the on-hand number away from
  what the movement rows actually say.

## Consequences

- Approving a purchase order is now purely a workflow-status change; it
  has no inventory side effect. Any future module that needs to know
  "has stock actually arrived for this purchase" must check for an
  approved `purchase_invoices` row, not the purchase's own status.
- The reconciliation trail is fully auditable and append-only: for a
  purchase invoice re-approved N times, every historical receipt and
  reversal remains in `stock_movements` exactly as originally written:
  only the *set of currently-active* rows (those with no reversal
  pointing at them) changes what they sum to.
- A future Sales/dispatch module must read on-hand balance the same way
  (`SUM(quantity)` over active-and-reversal rows together, since a
  reversal's own negative quantity already cancels its target) rather
  than trusting any single purchase's or invoice's status flag in
  isolation.
