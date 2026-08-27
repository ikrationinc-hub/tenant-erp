# 0017 - The Bill: renamed from Supplier Invoice, partial billing, billed_status

## Status

Accepted

## Context

ADR 0016 (PL-1) built the Purchase Receipt and moved stock off invoice
approval, but deliberately left `purchase_invoices` untouched as a table name
- "Bill unchanged as a document... Vocabulary rename... deferred to PL-2."
CLAUDE.md's Vocabulary section is explicit: **Bill** is the canonical term for
the document a supplier sends; "supplier invoice" is Prompt 22's name for the
same thing and must not persist as the domain's actual vocabulary.

An audit before this build confirmed `purchase_invoices` already covers most
of what the four-document lifecycle's Bill needs (own gapless number, `draft/
approved` status, `purchase_id` FK, file upload via the generic attachments
service) - so PL-2 is a **rename + extension** of the existing table, not a
new parallel entity. Building a second Bill table alongside `purchase_invoices`
would create two competing documents for one concept, which nothing in the
four-document model calls for.

Two things the audit also surfaced as blockers to building PL-2 exactly as
specified:

1. **No `Closed` PO status exists.** `purchaseStatusEnum` is still `[draft,
   approved, posted]` - ADR 0016 already scoped the `Draft -> Issued ->
   Closed` rework to PL-3, its own audited migration since it touches
   existing data. PL-2 cannot auto-move a PO to `Closed` without either
   preempting that migration or bolting `closed` onto an enum that's about to
   be reworked anyway.
2. **No Bill-side line items exist.** `purchase_invoices` carried only a
   single header-level `invoiceAmountUsd` - there was no way to bill a
   *subset* of a purchase's items, and `ALLOW_PARTIAL_INVOICING = false`
   blocked a second invoice per purchase outright. PL-2's own build order
   ("a bill can be PARTIAL; MULTIPLE bills per PO until fully billed") is a
   hard requirement, not a flag to flip later.

## Decisions

- **`purchase_invoices` is renamed to `purchase_bills` in place** (`ALTER
  TABLE ... RENAME TO`, migration 0031), preserving any existing rows and
  their data exactly - not a drop-and-recreate. Columns renamed to match:
  `invoice_number -> bill_number`, `invoice_date -> bill_date`,
  `invoice_amount_usd -> bill_amount_usd`. `purchase_invoice_status` enum
  renamed to `purchase_bill_status`, with `'paid'` added as a new reserved
  value (deferred Payment phase - PL-2 does not build payment, same
  "add the value now, wire it up later" precedent as every other reserved
  enum value in this schema). `due_date` and `tax_amount` (nullable,
  reference-only - no TDS/TCS mechanics, tax stays an open client question
  per CLAUDE.md's "Do NOT import from Zoho") are new columns.

- **`purchase_bill_items` is a new table**, mirroring `purchase_receipt_items`
  exactly: `bill_id` FK, `purchase_item_id` FK, `billed_quantity`,
  `billed_amount_usd`. A bill's `items` array is **optional** on create - an
  omitted or empty array preserves the old header-only create flow
  unchanged; a bill *with* items is how partial billing and `billed_status`
  actually get tracked. Over-billing (summed across every existing bill,
  draft or approved) is rejected at bill-create time, same discipline as the
  receipt's own over-receipt guard.

- **Billing itself is the financial fact - unlike receiving, both draft AND
  approved bills count toward `billed_status` and the over-billing sum.**
  A receipt only counts once *confirmed* (the physical fact hasn't happened
  until then); a bill recording what's owed is already meaningful the moment
  it exists, before approval formalizes it. `sumBilledQuantitiesByItem`
  (`purchase-bills.repository.ts`) does not filter by status, deliberately
  unlike `sumConfirmedReceivedQuantitiesByItem`.

- **`billed_status` mirrors `received_status` exactly** -
  `computeBilledStatus(orderedItems, Map<purchaseItemId, billedQuantity>)`,
  a pure function, wired into `purchase.service.ts`'s `getById` the same way.
  Not stored; always computed fresh from current bills and items.

- **No PO auto-close in this prompt.** `billed_status` is exposed
  independently; the PO's own status is untouched. The `Draft -> Issued ->
  Closed` refactor, including "auto-close when fully received AND fully
  billed," is PL-3's job as previously scoped by ADR 0016 - building it here
  would require adding `closed` to `purchaseStatusEnum` twice (once now,
  once properly in PL-3's own migration).

- **The REST surface, field-definitions entity key, and attachment entity
  string are all deliberately left unrenamed.** PL-2 is scoped backend-only;
  PL-4 does the coordinated API-surface + frontend cutover to Bill
  vocabulary (route paths `/invoices`, the `:invoiceId` param, the
  `purchase.invoice.*` permission keys, field-definitions entity `"invoice"`,
  attachment entity `"purchase_invoice"` are all unchanged). Internally,
  `purchase-bills.service.ts` is the one seam that translates: every
  response (`create`/`update`/`approve`/`list`, and
  `purchase.service.ts`'s `attachInvoiceVariance`) is shaped through a
  `toWireShape`/wire-type function that maps the renamed columns
  (`billNumber`/`billDate`/`billAmountUsd`) back onto the field names the
  existing frontend already reads (`invoiceNumber`/`invoiceDate`/
  `invoiceAmountUsd`). No other layer needs to know about the rename.

- **A new `BILL` numbering series (`BILL-{FY}-{seq}`), not a reuse of
  `SUPPLIER_INVOICE`.** The old series is left alone, untouched, forever -
  any historical `SINV`-numbered bill keeps its number (rule 8's spirit:
  numbering is never rewritten). Two idempotent backfill scripts sync
  already-provisioned tenants (`backfill-purchase-receipt-number-series.ts`,
  extended to also seed `BILL` since `seedDefaultNumberSeries` walks its
  whole list; permission keys are unchanged so no permission backfill was
  needed this time).

- **The `stock_movements.purchase_invoice_id` legacy FK now points at
  `purchase_bills`** (same physical column, same physical rows - Postgres
  updates the FK target automatically on table rename; the constraint name
  was renamed for clarity, nothing else changed). Still nullable, still
  unwritten by any current path - only historical Prompt-22-era rows
  (written before ADR 0016's rework) resolve through it.

## Consequences

- Approving a PO has no inventory or billing side effect. Confirming a
  receipt moves stock. Approving a bill records a liability. All three are
  now fully independent - a PO can be received-not-billed, billed-not-
  received, or both/neither, matching the client's actual expected UI
  (Zoho's Received ●/Billed ● dots), each axis computed independently on
  `GET /purchases/:id`.
- The rename is invisible to the existing frontend - `PurchaseDetailScreen
  .tsx`'s "Supplier Invoices" panel keeps working against the same
  `/invoices` endpoints and the same field names, unaware the backend
  domain vocabulary changed underneath it. This was a deliberate scope
  boundary, not an oversight - PL-4 is where the frontend gets rebuilt for
  the four-document lifecycle, including finally renaming this panel to
  "Bills" and speaking `billNumber`/`billDate`/`billAmountUsd` directly.
- `purchaseStatusEnum` still has no `Closed` value - any future work reading
  "is this PO fully done" must combine `receivedStatus === "fully_received"`
  and `billedStatus === "fully_billed"` itself until PL-3 lands the derived
  terminal state.
- Tax remains a pure schema seam (`tax_amount`, nullable, informational) -
  no computation, no validation, no multi-country logic. The real tax engine
  is still blocked on the client's answer.
