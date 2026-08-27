# Purchase Lifecycle Rework — Four Documents (Zoho-model, trading-native)

Adopts Zoho's document *lifecycle* while keeping every trading-specific field.
This is an architecture change: from ONE Purchase document walking through
statuses, to FOUR linked documents. It supersedes the "supplier invoice moves
stock" decision — under this model the **Receipt** moves stock.

Scope now: **PO + Receipt fully; Bill as a document; Payment deferred** — but the
model is designed for all four so nothing needs re-architecting later.

---

## 1. The model

```
PURCHASE ORDER ──(receive goods)──> PURCHASE RECEIPT ──> [stock moves here]
      │
      └────────────(bill)──────────> BILL / SUPPLIER INVOICE ──> [liability]
                                            │
                                            └──(pay)──> PAYMENT  (deferred)
```

Four documents, each its own entity, its own number, its own lifecycle. The two
middle ones are **independent axes** — exactly Zoho's Received ● / Billed ●
dots:

- A PO can be **received but not billed** (goods arrived, invoice hasn't)
- A PO can be **billed but not received** (invoice arrived first)
- Either can be **partial** (received 60 of 100 MT; billed 40 of 100)

This is why they must be separate documents, not statuses on one record. A single
status field cannot represent "60% received AND 40% billed" — two independent
progress axes need two independent documents.

### Why the Receipt moves stock (not the PO, not the Bill)

Stock is a *physical* fact — it changes when metal arrives, which is the Receipt.
Billing is a *financial* fact — it changes when the invoice is processed, which
is the Bill. Tying stock to the Bill (the earlier decision) breaks the moment
goods arrive before the invoice. The Receipt is the correct trigger.

### What stays trading-native (NOT in Zoho)

All of this lives inside these documents — it's what makes Ikration a trading
ERP and not a generic one:

| Document | Trading fields it carries |
|---|---|
| **Purchase Order** | division, pricing_type (LME/fixed), LME record (price, agreed%, type, fixing date, final rate), broker (D) + commission, shipment (lot/BL/container/vessel/voyage/ports/incoterm), items, pricing, customer allocation, hedging |
| **Purchase Receipt** | which items/quantities actually arrived, warehouse, receipt date, condition, the stock movements it generates |
| **Bill** | supplier invoice no, invoice date, amounts, link to PO + Receipt, tax (per client's multi-country model — NOT Zoho's TDS/TCS) |
| **Payment** | *(deferred — accounts payable phase)* |

### What we are NOT copying from Zoho

- **TDS/TCS / Indian GST tax handling** — Ikration's tax is multi-country and
  still an open client question. Do not inherit Zoho's India assumptions.
- **Payments Made / Record Payment** — accounts payable, a whole module.
  Deferred. Model the Payment link now; build it later.
- **Zoho's generic item model** — keep the trading item + lot + grade model.

---

## 2. Status model per document

Each document has its own workflow through the existing workflow engine.

**Purchase Order:** Draft → Issued (was "Approved") → then tracked by fulfilment.
A PO is never "Posted" in the old sense anymore — its downstream state is
"how much is received / billed", derived from the child documents. Terminal
state **Closed** when fully received AND fully billed (Zoho's CLOSED), or
**Cancelled**.

**Purchase Receipt:** Draft → Confirmed. Confirming moves stock (append-only
ledger, in-transaction — the mechanism already works, just re-triggered here).

**Bill:** Draft → Approved → (later: Paid, when Payment exists). Approving
records the liability. Does NOT move stock.

**Derived on the PO** (computed, never stored as mutable truth):
- received_status: not_received / partial / fully_received  (SUM of receipts)
- billed_status: not_billed / partial / fully_billed  (SUM of bills)

---

## 3. What this changes in the existing build

The audit earlier established: stock currently moves at PO **approve**, via a
synchronous in-transaction event handler. This rework:

1. **Removes** the stock side-effect from PO approval.
2. **Adds** a Purchase Receipt document; confirming it moves stock (reusing the
   exact atomic mechanism that works today).
3. **Adds** a Bill document (the old "supplier invoice" concept, now formalized
   and decoupled from stock).
4. **Renames** PO's "Approved/Posted" toward "Issued" + derived fulfilment
   state.
5. **Keeps** every trading field already built on the PO.

Nothing about tenancy, RBAC, numbering, audit, or the field engine changes —
this is purely the purchase domain's document model.

---

## 4. Build order (prompts)

Sequenced smallest-risk first. Each is audit-first (the recurring lesson: things
may be half-built or unreachable).

### PL-1 (BE) — Purchase Receipt document + move stock to it

```
Adopt the four-document purchase lifecycle. This prompt builds the RECEIPT and
moves stock onto it. Read CLAUDE.md (rules 1,6,7,8), the earlier stock audit
(AUDIT-reversal-and-post-to-stock.md), and section 1-3 of
PURCHASE-LIFECYCLE-4DOC.md first.

AUDIT FIRST — report before building:
- Confirm current stock trigger (earlier audit: PO approve → purchase.approved
  event → insertStockMovement, synchronous in-txn). Cite current file:line.
- Confirm PO status enum and transition definitions as they stand now.

BUILD:
1. New entity purchase_receipts:
   - receipt_number (numbering engine, gapless, own doc_type, per company+FY)
   - purchase_id (FK)
   - receipt_date, warehouse_id, received_by
   - status enum ['draft','confirmed'] (+ 'reversed' for corrections)
   - standard scope + audit columns
2. purchase_receipt_items: which items + quantities actually arrived (a receipt
   can be PARTIAL — received qty <= ordered qty; and there can be MULTIPLE
   receipts per PO until fully received). Link each to the purchase_item it
   fulfils.
3. MOVE STOCK FROM PO-APPROVE TO RECEIPT-CONFIRM:
   - REMOVE the stock side-effect from the PO approval path. Grep to confirm
     nothing else depends on stock moving at PO approve. Keep the
     purchase.approved event if other code uses it; only remove the stock write.
   - ADD: on receipt Draft→Confirmed, emit receipt.confirmed; the inventory
     subscriber writes stock_movements — one signed inbound row per receipt
     item, SAME synchronous in-transaction pattern that works today. A handler
     throw rolls back the receipt confirmation. movementType stays
     'purchase_receipt'. The movement references the receipt AND the PO.
   - Net: approving a PO moves NO stock; confirming a receipt moves stock.
4. Derived received_status on the PO (not_received/partial/fully_received),
   computed by summing confirmed receipt quantities vs ordered. Never stored as
   mutable truth — computed on read or maintained via the receipt events.
5. Guard: cannot receive more than ordered (per item, across all receipts).
   Cannot confirm a receipt with zero items.
6. Permission: purchase.receipt.create / .confirm — seed + assign to defaults.

TESTS (heavy — this touches the ledger):
- Approving a PO moves NO stock (regression: old behaviour gone)
- Confirming a receipt moves stock, one signed row per item, in-txn
- Forced failure in the receipt stock write rolls back the confirmation (no
  orphan stock, no orphan confirmed receipt)
- Partial receipt: receive 60 of 100 → received_status=partial, balance=60;
  second receipt of 40 → fully_received, balance=100
- Cannot receive 101 of 100 (over-receipt blocked)
- Balance still = SUM(movements); no movement ever UPDATEd/DELETEd
- Gapless receipt numbering under concurrency

Acceptance:
- Audit reported before building
- Stock moves at receipt confirmation and NOWHERE else
- ADR written: the 4-doc lifecycle, receipt moves stock
```

### PL-2 (BE) — Bill / Supplier Invoice document

```
Add the Bill document (formalizes the supplier invoice, decoupled from stock).
Read section 1-2 of PURCHASE-LIFECYCLE-4DOC.md. Audit first (confirm no bill
entity exists yet).

BUILD:
1. New entity bills (or purchase_bills):
   - bill_number (numbering engine, gapless, own doc_type)
   - purchase_id (FK), and optional link to specific receipt(s)
   - supplier_invoice_no (supplier's own ref — free text), invoice_date, due_date
   - amounts (numeric, decimal — rule 1)
   - status enum ['draft','approved'] (+ 'paid' reserved for the deferred
     Payment phase; do NOT build payment now)
   - the uploaded invoice file via the storage service
   - standard scope + audit columns
2. bill_items: which items/quantities are billed (a bill can be PARTIAL;
   MULTIPLE bills per PO until fully billed). Approving a bill does NOT move
   stock.
3. Derived billed_status on the PO (not_billed/partial/fully_billed).
4. PO terminal state: when received_status=fully_received AND
   billed_status=fully_billed → PO auto-moves to Closed (mirrors Zoho CLOSED).
5. Tax: leave a clean seam for tax but do NOT implement Zoho's TDS/TCS — tax is
   multi-country and an open client question. A single nullable tax_amount +ADR
   noting "tax engine pending client answer" is enough for now.
6. Permission: purchase.bill.create / .approve.

TESTS:
- Bill can be created and approved without any stock movement
- Partial billing: bill 40 of 100 → billed_status=partial
- PO reaches Closed only when fully received AND fully billed
- Gapless bill numbering
- Bill approval is audited

Acceptance:
- Receipt and Bill are independent — a PO can be received-not-billed and
  billed-not-received (test both orders)
- No stock effect from billing
```

### PL-3 (BE) — PO status refactor + derived fulfilment

```
Refactor the PO's own status to fit the 4-doc model. Audit the current
Draft→Approved→Posted enum and every place it's referenced first, and report
before changing — this touches existing data.

BUILD:
1. PO status becomes: Draft → Issued → Closed/Cancelled. "Issued" replaces the
   old "Approved" (commitment sent to supplier). Drop "Posted" as a PO status —
   fulfilment is now tracked by derived received_status/billed_status, not a PO
   status.
2. Migrate existing POs: map old 'approved'/'posted' to 'issued' (or 'closed'
   if they already have full receipts+bills — but in prototype data they
   won't). Report how many rows migrate and to what.
3. Expose received_status + billed_status on the PO read model (the Zoho
   Received ●/Billed ● dots).
4. Keep every trading field on the PO untouched — this is a status refactor
   only, not a field change.
5. Update the workflow guards from earlier (zero-item block, LME/fixed
   validation, allocation-soft) to fire at Draft→Issued instead of the old
   transition.

TESTS:
- Old statuses migrated correctly (report the mapping)
- A PO shows correct received/billed derived state as receipts/bills are
  confirmed
- Existing guards still fire at the new Issued transition
- No trading field lost in the refactor

Acceptance:
- Audit + migration report before changes
- PO lifecycle is Draft→Issued→Closed with derived fulfilment axes
```

### PL-4 (FE) — Purchase lifecycle UI

```
Build the frontend for the 4-doc lifecycle. Read the 7 frontend rules in
CLAUDE.md. Audit what PO screens exist first.

BUILD:
1. PO list (like Zoho's All Purchase Orders): columns incl. status, and the two
   derived axes Received / Billed as distinct indicators. Server-side paging/
   filter (rule 10). Filter by status, received, billed, division, supplier.
2. PO detail view: the trading PO (all sections — header/shipment/items/pricing/
   LME/broker/allocation/hedging, all schema-driven per rule 1). Plus a
   fulfilment strip showing the lifecycle: Order → Receive → Bill (→ Pay, shown
   but disabled/"coming soon"), with each stage's state — mirrors Zoho's
   Order/Receive/Bill status block.
3. Actions on the PO, permission-gated (<Can/>): Issue, Receive (opens a receipt
   form prefilled with outstanding quantities), Convert to Bill (opens a bill
   form prefilled), Cancel.
4. Receipt form: item lines defaulting to outstanding qty, editable down (for
   partial), warehouse, receipt date. Confirming calls PL-1's confirm endpoint.
5. Bill form: item lines defaulting to un-billed qty, supplier invoice no,
   invoice date, file upload. Approving calls PL-2's approve endpoint.
6. Receipts and Bills each get their own list screens too (like Zoho's Purchase
   Receives and Bills nav items) — reachable via menu nodes in BOTH
   DEFAULT_MENU_TREE and mockMenuTree (the recurring drift bug).
7. Money displays as API strings, never parseFloat (rule 3). Quantities too.

TESTS:
- PO list shows received/billed axes from mocked data
- Receive action creates a partial receipt; PO reflects partial received
- Convert to Bill creates a bill; PO reflects partial billed
- Full receipt + full bill drives PO to Closed in the UI
- All new screens reachable by CLICKING (both menu trees wired)
- No hardcoded labels in purchase modules (grep clean)

Acceptance:
- The lifecycle is visible and operable end-to-end in the browser:
  create PO → Issue → Receive (stock moves) → Bill → PO Closed
- Receipt and Bill are independently operable
```

---

## 5. What stays open (client questions, non-blocking)

- **Tax model** — PL-2 leaves a seam; the real tax engine waits on the
  multi-country answer (already on the master question list, section D).
- **Partial receipt/bill in practice** — the model supports partial; confirm
  Ikration actually does partial shipments/invoicing, or whether it's always
  all-or-nothing (simplifies the UI defaults, not the model).
- **Payment / accounts payable** — deferred to the accounting phase entirely.
- **Can a PO be edited after Issue / after partial receipt?** — decide the edit
  rule (likely: freely in Draft, restricted after Issue, and any change to
  already-received lines blocked). Confirm with client; PL-3 can enforce
  whatever they choose.

---

## 6. Why this is worth the rework now, not later

You're at the one moment this is cheap. Sales doesn't exist yet, so nothing
allocates against receipts. No real data exists, so migrations are trivial. The
document boundaries you set here are the ones Sales will mirror (Sales Order →
Delivery → Invoice → Receipt-of-payment is the exact same four-document shape on
the sell side). Getting the buy-side lifecycle right now means the sell-side is
a known pattern, not a fresh design. Doing it after Sales is built means
reworking two modules and migrating live inventory — the expensive version.
