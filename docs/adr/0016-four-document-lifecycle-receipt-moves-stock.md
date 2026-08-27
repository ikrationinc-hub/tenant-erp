# 0016 - Four-document purchase lifecycle: the Receipt moves stock, not the invoice

## Status

Accepted

## Context

ADR 0015 moved stock off Purchase Order approval and onto supplier invoice
approval, on the reasoning that a PO is intent and stock shouldn't move until
the supplier's invoice is received. Building the client's actual expected
workflow (`docs/PURCHASE-LIFECYCLE-4DOC.md`, benchmarked against Zoho) surfaced
a problem with that model: it conflates two independent facts. Whether goods
have **physically arrived** and whether they've been **invoiced** are separate
questions with separate timelines - a shipment can land before its invoice, or
the invoice can arrive before the goods (pre-invoicing). Tying stock to invoice
approval breaks the first case entirely: goods sitting in a warehouse aren't
reflected as available stock until a financial document, which may not exist
yet, gets approved.

Zoho's model - and every mainstream trading/inventory system - solves this
with four linked documents, each its own lifecycle: **Purchase Order → Receipt
→ Bill → Payment**. The Receipt is the physical-arrival record; the Bill is the
financial-liability record. Only the Receipt moves stock, because stock is a
physical fact.

PL-1 (this change) builds the Receipt and the second half of the correction:
scope is PO + Receipt fully, Bill unchanged as a document (still called
`purchase_invoices` in code - the Vocabulary rename to "Bill," per
CLAUDE.md's Vocabulary section, is deferred to PL-2), Payment deferred
entirely (not modeled yet).

## Decisions

- **`purchase_receipts` / `purchase_receipt_items` are new, first-class
  documents.** A receipt has its own gapless number (`PR-{FY}-{seq}`,
  `docType: "PURCHASE_RECEIPT"` - `PR-` per CLAUDE.md's Vocabulary section,
  "Purchase Receipt" being the provisional canonical term until the client
  confirms GRN), its own `draft -> confirmed` workflow, and its own
  `purchase.receipt.create` / `purchase.receipt.confirm` permissions. A
  purchase can have **multiple** receipts (`purchase_id` is a plain FK, not
  unique) - partial shipments are a first-class case, not an edge case.

- **`receipt.confirmed` is now the only event that writes a stock movement.**
  `handleReceiptConfirmed` (`modules/inventory/inventory-subscriber.ts`)
  replaces the superseded `handleInvoiceApproved`, in the same synchronous,
  transaction-scoped dispatch pattern ADR 0007/0015 established (a subscriber
  throw rolls back the confirmation). Neither `purchase.approved` nor
  `invoice.approved` writes stock anymore - approving either is now a pure
  status change.

- **No reconciliation cycle - a confirmed receipt is immutable.** ADR 0015's
  reverse-then-reissue mechanism existed only because invoice approval
  re-derived stock from the purchase's *current* items on every re-approval,
  so an item edit after approval had to force a re-approval that reconciled
  the difference. A receipt has its own explicit line items
  (`purchase_receipt_items`), captured once at creation, and once confirmed
  it never changes (rule 8: posted documents are immutable, corrections are
  reversal + re-entry - PL-1 does not build receipt reversal; the
  `purchase_receipt_status` enum reserves a `'reversed'` value for that
  future work, same "add the value now, wire it up later" precedent as
  `purchase_invoice_status`'s own `reversed`). `stock_movements.receipt_id`
  and the still-present `reversal_of_movement_id` self-FK are ready for that
  later flow without a further migration.

- **The invoice becomes purely financial.** `purchase-invoices.service.ts`'s
  `approve()` no longer emits any event or touches `stock_movements` - it is
  now exactly what ADR 0015 originally undersold it as: a liability record.
  `purchase-items.service.ts`'s `triggerInvoiceReapprovalIfNeeded` and
  `purchase-invoices.repository.ts`'s `flipApprovedInvoicesToDraft` are
  deleted outright - there is nothing left for an item edit to reconcile.

- **Item edits now lock the moment ANY receipt exists against the purchase,
  not just at Posted.** `assertItemsEditable` (`purchase.service.ts`)
  previously allowed edits through Draft and Approved specifically to support
  the reconciliation cycle above; that rationale is gone. Its replacement
  rationale: a receipt's over-receipt guard
  (`purchase-receipts.service.ts`'s `create`) is checked against each item's
  ordered `quantity` at the receipt's own create time - letting that ordered
  quantity change afterward, with no reconciliation mechanism to catch it,
  would silently invalidate a guard that already ran. This is a genuinely new
  rule PL-1 introduces beyond what the lifecycle doc's build prompt asked for
  outright; confirmed as the right call rather than guessed.

- **`received_status` is derived, never stored as mutable truth.** Computed
  on every `GET /purchases/:id` by summing **confirmed** receipt item
  quantities against each purchase item's ordered quantity
  (`sumConfirmedReceivedQuantitiesByItem` + `computeReceivedStatus`, both in
  `purchase-receipts.service.ts`, shared with `purchase.service.ts` so there
  is exactly one implementation). A draft receipt's quantities don't count -
  only a confirmed receipt has actually moved stock. `billed_status` (the
  other Zoho-style fulfilment axis) is PL-2's job, over the Bill.

- **Guards enforced at receipt CREATE time, not only confirm.** Over-receipt
  (cannot receive more than ordered, summed across every confirmed receipt)
  and zero-item rejection both fire on `POST .../receipts`, so a user gets
  the rejection immediately rather than after filling in a whole draft that
  could never be confirmed. `confirm()` still re-runs the zero-item guard
  (a receipt's items can't be edited after creation in PL-1's scope, so this
  is defense-in-depth, not a reachable path today - matching the same
  "re-checked here anyway" discipline `purchase.service.ts`'s own approve
  guards use).

- **`stock_movements` gains `receipt_id`, keeps `purchase_invoice_id`.** The
  invoice FK is left in place, nullable, unwritten by any current path -
  historical Prompt-22-era rows (written before this rework, on any
  environment that had them) still resolve correctly; no backfill or
  migration touches existing rows. New rows are written with `receipt_id`
  set and `purchase_invoice_id` null.

- **RBAC: `confirm` joins `approve` at the Manager permission tier.**
  `core/provisioning/seed-roles.ts`'s `ROLE_PERMISSION_FILTERS` gates
  `purchase.receipt.confirm` the same way it gates every `approve` action -
  an irreversible, ledger-affecting transition is a manager-level decision,
  same reasoning as invoice/PO approval. Two backfill scripts
  (`backfill-purchase-receipt-number-series.ts`,
  `backfill-purchase-receipt-permissions.ts`, mirroring Prompt 22's own
  `backfill-supplier-invoice-number-series.ts` /
  `backfill-purchase-invoice-permissions.ts`) sync already-provisioned
  tenants, since `seedDefaultNumberSeries`/`seedPermissionCatalogue` only run
  at (re)provisioning time.

## Consequences

- Approving a PO has no inventory side effect. Approving an invoice has no
  inventory side effect. **Only confirming a receipt moves stock**, and it
  does so exactly once per receipt (no reconciliation, no reissue) - the
  simplest possible mapping from "goods physically arrived" to "the ledger
  reflects it."
- A PO can now be received-not-billed or billed-not-received, matching the
  client's actual expected UI (Zoho's Received ●/Billed ● dots) - `invoices`
  and `receipts` are independent sub-resources on the purchase, computed and
  exposed independently on `GET /purchases/:id`.
- The existing append-only ledger discipline (signed quantity + DB CHECK
  constraint, `reference_type`/`reference_id` polymorphic linkage, no
  UPDATE/DELETE ever) is untouched - PL-1 adds a new writer and a new FK
  column, not a new mechanism.
- `purchase_invoices` still needs its Vocabulary rename to `purchase_bills` /
  "Bill" (PL-2) and its own `billed_status` derivation (PL-2) before the
  4-document model is fully realized. The PO's own status enum
  (`draft/approved/posted`) is unchanged by PL-1 - `Issued` replacing
  `Approved` and dropping `Posted` in favor of derived fulfilment state is
  PL-3's job, done as its own audited migration since it touches existing
  data.
