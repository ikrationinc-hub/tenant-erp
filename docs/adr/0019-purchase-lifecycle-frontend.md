# 0019 - Purchase lifecycle frontend: fulfilment strip, Receive/Convert to Bill, standalone Receipts/Bills lists

## Status

Accepted

## Context

PL-1/PL-2/PL-3 built the four-document lifecycle end to end on the backend
(Receipt moves stock, Bill records the liability, the PO's own status is
Draft -> Issued -> Closed/Cancelled with `receivedStatus`/`billedStatus`
derived alongside it) but the frontend never caught up: `PurchaseListScreen`
had no Received/Billed columns, `PurchaseDetailScreen` had no way to create a
Receipt at all and created Bills through a stale, pre-PL-2 "Add Invoice" flow
(no item lines, no un-billed-quantity awareness, named for the old
single-invoice-only model), and no standalone "Purchase Receipts"/"Bills" nav
screens existed to mirror Zoho's own All Purchase Orders / Purchase Receives /
Bills trio.

An audit before building surfaced three real backend gaps this prompt's own
frontend needs would immediately expose, all confirmed with the user before
writing any UI:

1. **No endpoint exposed a bill's itemized `billedQuantity` lines** - Bills
   had no equivalent of the Receipt module's already-itemized read model.
   Closed by adding `GET /purchases/:id/invoices` (`purchase-bills.controller.ts`'s
   new `list` handler, reusing the service function `getById`'s own
   `attachInvoiceVariance` already called internally).
2. **No cross-purchase list endpoints existed** for the two new standalone
   screens - `purchase.routes.ts`'s existing `/:id` param route would collide
   with a literal `/receipts` or `/bills` path on the same router, so these
   ship as two new top-level routers (`purchaseReceiptsListRouter`,
   `purchaseBillsListRouter`) mounted directly in `app.ts` at
   `/api/v1/purchase-receipts` / `/api/v1/purchase-bills`, gated by the same
   `purchase.po.read` permission the PO list already uses (no dedicated
   `purchase.receipt.read`/`purchase.invoice.read` exist, and adding them for
   two read-only screens that are really views over the same underlying
   purchase data wasn't judged worth a new permission tier).
3. **`getById`'s own item rows carried no per-item received/billed quantity**
   - the Receive and Convert to Bill forms both need to default (and cap)
   each line at its own outstanding quantity, and the only place that
   arithmetic already happened was inside `list()`'s batched fulfilment-status
   computation, never exposed per-item on a single purchase's own read.
   Closed by a new `attachItemFulfilment` in `purchase.service.ts`, reusing
   the exact `receivedByItemId`/`billedByItemId` maps `getById` already built
   for `computeReceivedStatus`/`computeBilledStatus` - no new query, just
   attaching what was already computed onto each item.

Two frontend build decisions were also confirmed before writing code:

- **The Receipt/Bill line-item grids are hand-built React** (an AntD `Table`
  with an inline `NumericStringInput` per row, capped at that row's own
  outstanding quantity), not forced through SchemaForm - a per-item,
  outstanding-qty-capped repeating grid isn't one of the 13 field types the
  form engine describes, the same category `PurchaseItemsPanel`'s own
  read-only Items table already is. Only each form's header fields
  (`receiptDate`/`warehouseId`; `supplierInvoiceNo`/`invoiceDate`/`dueDate`/
  `invoiceAmountUsd`/`taxAmount`/`invoiceFile`) render through a real
  SchemaForm against the `receipt`/`invoice` field-definitions entities,
  using `SchemaForm`'s existing `footer` slot pattern (same mechanism
  Supplier's contacts/banks sub-tables already use) to host the grid inside
  the same submit.
- **The old free-form "Add Invoice" creation path is removed**, not kept
  alongside the new "Convert to Bill" action - having two divergent ways to
  create the same document (one blank, one prefilled with item lines and
  un-billed quantities) was judged worse than a single path, even though it
  means `PurchaseInvoicesPanel` (renamed "Bills" on screen, canonical
  vocabulary) is now list + Edit(draft only) + Approve, with all creation
  routed through the PO's own Convert to Bill action.

## Decisions

- **`purchase.service.ts`'s `getById` now returns
  `PurchaseItemWithFulfilment[]`** - each item gains `receivedQuantity`/
  `billedQuantity` (defaulting to `"0"`), computed by the new
  `attachItemFulfilment` from the same per-item Maps already built for the
  purchase-level derived statuses. The frontend's `OutstandingQtyTable`
  (`PurchaseFulfilmentPanels.tsx`) subtracts these from each item's ordered
  `quantity` to show and cap the outstanding amount - display-only
  arithmetic (`Number`, not `decimal.js`), re-verified for real by the
  server's own over-receipt/over-bill guards regardless, same spirit as the
  existing allocation-total and invoice-variance display-only computations.

- **Two new cross-purchase list endpoints** (`GET /purchase-receipts`,
  `GET /purchase-bills`) back the two new standalone screens
  (`PurchaseReceiptsListScreen.tsx`, `PurchaseBillsListScreen.tsx`), each a
  flat, paginated, filterable `SchemaTable` over `entity: "receipt"` /
  `entity: "invoice"` field-definitions, with an extra `purchaseNumber`
  column (via each row's inner join back to `purchases`) and a row action
  that navigates to the parent PO - neither screen has its own create
  action, since a Receipt/Bill is always created FROM its parent PO.

- **`purchase.repository.ts` gained `receivedStatusCondition`/
  `billedStatusCondition`** - concrete, separately-written SQL fragments
  (not a shared generic builder - considered and discarded as too hard to
  verify without being able to test it interactively) so the PO list's new
  `receivedStatus`/`billedStatus`/`divisionId` filters classify at the
  WHERE-clause level, keeping pagination/counts correct across the whole
  matching set rather than post-fetch filtering a page. `purchase.service.ts`'s
  `list()` separately batches the two axes' computed values onto each
  returned row (3 extra queries per PAGE, not per row) for the list's own
  Received/Billed columns - the SQL filter and the display column are
  deliberately two different code paths computing the same thresholds, since
  one needs to run inside a WHERE clause and the other needs a per-row value.

- **`PurchaseFulfilmentStrip`** (`PurchaseFulfilmentPanels.tsx`) renders
  Zoho's own Order -> Receive -> Bill -> Pay block via AntD `Steps`, sourced
  entirely from `receivedStatus`/`billedStatus` plus the PO's own `status` -
  no new state of its own. Pay always renders `disabled`, matching Payment's
  explicit four-document-lifecycle deferral. The Order step's own description
  text is deliberately NOT the bare status word ("Issued") - that's already
  shown by the page's own `StatusTag` next to the title, and duplicating it
  would render the identical string twice on screen (and did break several
  existing `findByText("Issued")` assertions in `PurchaseFlow.test.tsx`,
  caught by the full suite run before considering this done).

- **`PurchaseFulfilmentActions`** renders Receive/Convert to Bill, each
  permission-gated (`<Can permission="purchase.receipt.create">` /
  `purchase.invoice.create`) and only shown once Issued, and only while
  something is actually outstanding on that axis (hidden once
  `fully_received`/`fully_billed`) - both open `PurchaseFulfilmentDrawer`,
  which hosts `PurchaseReceiptForm`/`PurchaseBillForm`. Each form is a single
  user action end to end: POST the receipt/bill as `draft` with its item
  lines, then immediately PATCH confirm/approve - PL-1/PL-2 never built (or
  intended) a "save as draft, confirm later" UI step, and the prompt's own
  acceptance criteria ("Receive action creates a partial receipt", "Convert
  to Bill creates a bill") describe one action, not two.

## Consequences

- A bill or receipt can still exist as `draft` in the data model (e.g. if a
  browser tab closes between the POST and the PATCH), but the UI's only path
  to create one always attempts both steps together - there is deliberately
  no "resume this draft and confirm it later" screen; `PurchaseInvoicesPanel`'s
  surviving Edit/Approve actions are the only way to act on a bill that ended
  up stuck in `draft` this way, and no equivalent exists for a stuck-draft
  Receipt (matching PL-1's own "no receipt correction" scope - ADR 0016).
- The Receipt/Bill line-item grids duplicate `OutstandingQtyTable`'s render
  logic across two call sites via one shared component parameterized by
  `axis: "received" | "billed"` rather than two near-identical tables -
  judged the right level of abstraction since the two forms differ only in
  which quantity axis they cap against, not in shape.
- `PurchaseInvoicesPanel` no longer has a single "the one invoice's"
  attachment query - now that multiple bills can exist per purchase (partial
  billing, PL-2), its Document column resolves each row's own attachment
  independently (`BillDocumentLink`), one query per rendered row rather than
  one for the whole panel - acceptable at today's per-purchase bill counts,
  revisit if a purchase ever accumulates enough bills for this to matter.
- The standalone Receipts/Bills list screens reuse `purchase.po.read` rather
  than a dedicated permission - a role that can read purchase orders can read
  every receipt/bill against them today; if field-level or per-document
  read permissions are ever needed here, this reuse is the first thing to
  revisit.
