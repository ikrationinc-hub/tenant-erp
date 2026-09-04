# Sales Module — Complete Build Guide

The module where everything converges: it consumes the stock Purchase created,
computes the gross profit the client runs the business on, and tracks who owes
money. Structurally it mirrors Purchase's 4-document lifecycle, but it adds the
three hardest things in the entire ERP — lot allocation under concurrency,
specific-lot costing, and receivables.

**Reuse everything from Purchase.** The customer master mirrors supplier, the
sales document mirrors purchase, LME/hedging is the same, the 4-doc lifecycle is
the same shape. Do NOT rebuild those patterns — extend them. This doc focuses on
what's NEW and HARD.

---

## 0. Locked decisions (client-confirmed Aug 2026)

- **Two-step stock:** Sale **Approval RESERVES** lot quantity (soft hold);
  **Delivery** consumes it as an outbound stock movement. Approval does not
  physically move stock. (Matches the sheet's `Available Quantity` vs
  `Reserved Quantity` and FR-108 "approval reserves inventory".)
- **Specific-lot costing:** the user picks the exact purchase lots; cost comes
  from those lots. NOT FIFO, NOT weighted-average.
- **Credit limit:** WARN but allow — never hard-block an over-limit sale.
- **Lifecycle:** Sales Order → Delivery (stock out) → Invoice → Payment received.
  Mirrors Purchase's PO → Receipt → Bill → Payment.

---

## 1. The three hard parts (this is where the module lives or dies)

### 1.1 Lot allocation under concurrency — THE hardest problem in the ERP

A sales line selects purchase lots (`D. Sales Item → Purchase Allocation`). Each
lot has:
```
Available Quantity = Received − already Reserved − already Delivered
Reserved Quantity  = held by approved-but-not-delivered sales
```
FR-104: quantity validation against available stock. Two salespeople can approve
sales against the same lot at the same instant. **Without row-locking, both
succeed and you've sold metal you don't have.**

The rule: reserving from a lot must `SELECT ... FOR UPDATE` the lot's stock
position, check available >= requested, then write the reservation — all in one
transaction. This is the single most important mechanism in the module. It is
also exactly the concurrency problem flagged at the very start of the project.

### 1.2 Specific-lot costing → gross profit — the number the client lives on

When a sale is allocated to lots, `F. Cost Allocation` computes:
```
Purchase Cost      = sum of (allocated qty × that lot's landed rate)   [specific-lot]
+ Freight Allocation    (allocated across lots, by qty or value)
+ Insurance Allocation
+ Customs Allocation
+ Other Charges         (user defined)
= Total Cost
Gross Profit = Sales Value − Total Cost
Profit %     = Gross Profit / Sales Value
```
Plus **Realized vs Unrealized**: unrealized until delivered/invoiced, realized
after. All decimal.js, all numeric columns, never a float (rule 1). A wrong
number here is a wrong business decision — this is the most correctness-critical
math in the system.

### 1.3 Receivables — Sub Tab 5

Invoice (amount, due date, credit days, outstanding) → Payment received (method,
bank ref, LC/TT ref, balance outstanding). Plus the customer **Credit Limit**
check: on a new sale, if it would push the customer over their limit, WARN
(show it clearly) but ALLOW. This is accounts receivable — the mirror of
Purchase's deferred payables, but more central because the client cares intensely
about who owes them.

---

## 2. Build order — prove allocation + costing FIRST

Same principle as Contracts (prove Word/PDF first) and Purchase (prove tenant
isolation first): **build the risky engine in isolation before the CRUD around
it.** If allocation + costing isn't correct and concurrency-safe, the rest is
decoration on a broken foundation.

| Phase | What | Risk | Gate |
|---|---|---|---|
| **S-1** | Customer master (mirror of supplier) | Low | Customer CRUD |
| **S-2** | **Allocation + costing engine — isolated, concurrency-tested** ⚠️ | **HIGHEST** | Overselling is impossible; profit math exact |
| **S-3** | Sales Order document (header/shipment/items/pricing/LME) + reserve-on-approve | Medium | Create → approve → lot reserved |
| **S-4** | Delivery document (consumes reservation → outbound stock) | Medium | Deliver → stock leaves |
| **S-5** | Invoice + Payment (receivables) + credit-limit warning | Medium | Invoice → payment → outstanding tracked |
| **S-6** | Sales Performance Dashboard | Low | KPIs, profit analysis |

---

## 3. The prompts

### S-1 (BE) — Customer master

```
Build the Customer master — it mirrors the Supplier master almost exactly. Read
CLAUDE.md (vocabulary: Customer never "Client"). Audit the supplier master first
and REUSE its pattern; don't reinvent.

Fields (Sub Tab 1): customer_code (gapless), customer_name (unique per company,
soft-delete-aware), customer_type (Local/Export, configurable enum), contact
person/mobile/email (validated), country, city (cascading), address, vat_trn,
payment_terms (master), credit_limit (numeric, decimal), default_currency,
salesperson (user), status, remarks. Plus customer_banks + customer_contacts
sub-tables mirroring supplier.

FR-001..005: create, auto code, duplicate-name block, available in sales,
activate/deactivate. Through the module registry with a manifest. Menu node in
BOTH trees.

Tests: mirror the supplier master's test suite; credit_limit stored as decimal;
duplicate name blocked; code gapless.

Acceptance: audit reported; supplier pattern reused, not duplicated.
```

### S-2 (BE) — Allocation + costing engine ⚠️ THE CRITICAL ONE

```
Build the lot allocation + specific-lot costing engine, ISOLATED, before any
sales document UI. This is the highest-risk code in the ERP. Read section 1 of
SALES-MODULE-PLAN.md, CLAUDE.md rules 1 and 6, and the stock ledger code from the
Purchase side first. Audit the existing stock_movements + any reservation
concept, report before building.

BUILD:
1. Stock position per lot, DERIVED from the append-only ledger:
   available = received − reserved − delivered, per (item, lot, warehouse).
   Reserved is a state, not a physical movement.
2. reserveFromLot(tx, {lotId, qty}):
   - SELECT ... FOR UPDATE on the lot's stock position (rule: lock before check)
   - compute available; if available < qty → reject (FR-104)
   - write a reservation record (links sale + lot + qty)
   - ALL in the caller's transaction. NEVER check-then-write without the lock —
     that's the overselling bug.
3. releaseReservation / consumeReservation (consume = convert reserved → outbound
   stock movement at delivery; a signed negative 'sale_issue' movement).
4. Specific-lot costing: cost(saleAllocation) = sum over allocated lots of
   (allocated_qty × lot_landed_rate). Landed rate = the lot's purchase rate +
   its share of freight/insurance/customs (from the purchase side). Add
   freight/insurance/customs allocation across the sale's lots (by qty or value —
   make it configurable, default by qty). All decimal.js.
5. Gross profit = sales_value − total_cost; profit % ; realized flag (unrealized
   until delivered, realized after). Pure functions where possible so they're
   property-testable.

TESTS (over-test this — it's the riskiest code in the system):
- THE CONCURRENCY TEST: 100 parallel reserve attempts against a lot with only
  enough for 50 → exactly 50 succeed, 50 rejected, available never goes negative.
  Run it 10× reliably.
- Reserve → available decreases; release → available restores
- Deliver → reservation becomes an outbound movement; balance = SUM(movements)
- Specific-lot cost: allocate across 3 lots at different rates → cost is the exact
  weighted sum of THOSE lots (not FIFO, not average of all stock)
- The money test: a realistic sale (qty × rate, minus specific-lot cost + spread
  charges) → gross profit exact to the fils, hand-verified
- No float anywhere in the math; grep clean
- A reservation never exceeds available even under interleaved transactions

Acceptance:
- Audit reported first
- The 100-parallel concurrency test passes 10× — overselling is IMPOSSIBLE
- Specific-lot costing proven exact
- ADR: the reserve-lock mechanism, the cost-allocation basis (default by qty)
- This engine is standalone and fully tested BEFORE S-3 builds the document on top
```

### S-3 (BE + FE) — Sales Order document + reserve-on-approve

```
Build the Sales Order document and wire approval to the S-2 engine. Only after
S-2's concurrency test is green. Mirror the Purchase Order 4-doc pattern. Read
the 7 frontend rules. Audit first.

BACKEND:
1. sales header + customer_details + shipment + items + pricing tables per Sub
   Tab 2 sections A-E. sales_number gapless. status Draft/Approved/Closed/
   Cancelled (mirror PO). Division + pricing_type (LME/Fixed) like Purchase.
2. Sales pricing (E): Final Sales Rate = LME Sales Price × (agreed% / 100) — the
   SAME formula as Purchase (already built; reuse it). Sales Amount USD = qty ×
   rate; AED = USD × exchange rate. Calculated fields server-side.
3. Sales items (D): each line selects purchase lots via the S-2 engine. Show
   Available Quantity + Reserved Quantity (from S-2). FR-103: multiple lots per
   sales line. FR-104: block qty > available.
4. Cost allocation (F) + profit: call the S-2 costing engine; display gross
   profit / profit %. This is where FR-106 "profit calculated automatically"
   lands.
5. RESERVE ON APPROVE (FR-108): Draft → Approved calls reserveFromLot for each
   allocation, in the approval transaction. If any reservation fails (lot no
   longer has stock), the whole approval rolls back with a clear error. This is
   the two-step model's first step.
6. Credit limit: on approve, if the sale pushes the customer over credit_limit,
   WARN (return a warning the UI shows) but ALLOW. Never block.
7. LME + hedging sub-tab (Sub Tab 3) — mirror Purchase.

FRONTEND:
8. Sales list mirroring the Purchase Orders list: status + derived Delivered/
   Invoiced/Paid axes, filters. Schema-driven (rule 1).
9. Sales form: sections A-F schema-driven. The lot-allocation UI is the new
   piece — picking lots per item, live Available/Reserved display, block
   over-allocation, show computed cost + gross profit.
10. Credit-limit warning shown clearly at approval, non-blocking.
11. Menu nodes both trees.

TESTS:
- Approve reserves lots via S-2, in-transaction; a failed reservation rolls back
  the approval
- Over-available allocation blocked (FR-104)
- Multiple lots per line (FR-103)
- Profit shows correctly from the S-2 engine
- Credit-limit warning appears but does not block
- Sales pricing uses the same LME formula as Purchase
- No hardcoded labels; reachable by clicking

Acceptance: create → allocate lots → approve → lots reserved; profit correct;
credit warning non-blocking
```

### S-4 (BE + FE) — Delivery (consumes reservation → stock out)

```
Build the Delivery document (Sub Tab 4). Delivery is where reserved stock
physically leaves. Mirror the Purchase Receipt pattern (Receipt = stock in;
Delivery = stock out). Audit first.

1. deliveries + delivery items per Sub Tab 4: delivery_order_no (gapless),
   dispatch date, vehicle/container, transport company, driver, gate_pass_no,
   delivery qty, remaining qty, delivery status (Pending/Partial/Complete), POD
   received, customer acknowledgement.
2. Confirming a delivery CONSUMES the reservation via S-2's consumeReservation:
   reserved → outbound 'sale_issue' stock movement, in-transaction. Partial
   deliveries allowed (deliver 60 of 100 reserved → partial). Extend
   stockMovementTypeEnum with 'sale_issue'.
3. Derived delivery_status on the sale (not_delivered/partial/fully_delivered).
   Realized profit flips true on delivery.
4. FE: delivery form prefilled with reserved quantities; delivery list; the
   sale's Delivered axis reflects progress.

TESTS:
- Confirming delivery converts reservation to an outbound movement, in-txn;
  balance = SUM(movements)
- Partial delivery → partial status, remaining reserved stays reserved
- Cannot deliver more than reserved
- Realized profit flips on delivery
- No stock_movement ever mutated

Acceptance: reserve (S-3) → deliver (S-4) → stock physically leaves; the
two-step model is complete and correct end to end
```

### S-5 (BE + FE) — Invoice + Payment (receivables)

```
Build invoicing and payment tracking (Sub Tab 5) — accounts receivable. Mirror
the Purchase Bill pattern where sensible. Audit first.

1. sales_invoices: invoice_number (gapless), invoice_date, currency, amount,
   due_date, credit_days, outstanding_amount (derived). Links to the sale +
   delivery. Independent axis like Purchase's Bill (a sale can be delivered-not-
   invoiced or invoiced-not-delivered).
2. payments_received: amount, date, method (Cash/Bank/LC/TT), bank_reference,
   lc_number, tt_reference, receipt upload, balance_outstanding (derived).
   Multiple payments per invoice (partial). All money decimal.
3. Outstanding = invoiced − received, per customer and overall (feeds the
   dashboard's Outstanding Receivables + the credit-limit calc in S-3).
4. Tax: leave a seam, do NOT build a specific tax regime (multi-country, open
   client question) — same stance as Purchase Bill.
5. FE: invoice + payment screens; outstanding visible; the sale's Invoiced/Paid
   axes reflect progress.

TESTS:
- Invoice created; outstanding = amount until paid
- Partial payment → balance decreases correctly (decimal-exact)
- Outstanding per customer aggregates correctly (feeds credit-limit warning)
- Invoice independent of delivery (test both orders)

Acceptance: deliver → invoice → receive payment → outstanding tracked; customer
outstanding feeds the S-3 credit warning
```

### S-6 (BE + FE) — Sales Performance Dashboard

```
Build the dashboard (Sub Tab 6). Read-heavy aggregates — do NOT run these against
OLTP tables under load (rule from the original plan). Audit first.

KPIs: Total/Monthly Sales, Customer-wise, Item-wise, Country-wise, Gross Profit,
Net Profit, Outstanding Receivables, Shipment Pending, Open/Completed Contracts,
Sales vs Purchase Analysis.

1. Back with materialized views refreshed by a BullMQ job (reuse the repeatable-
   job pattern built for the contract scheduler), OR tenant-scoped cached
   aggregates. Never live aggregate over transaction tables on every dashboard
   load.
2. FE: dashboard cards + charts. Use the app's existing chart approach.
3. Gross/Net profit come from the S-2 costing engine's stored results, not
   recomputed in the dashboard.

Tests: KPIs compute correctly from seeded data; dashboard doesn't query OLTP
directly; refresh job updates the views.

Acceptance: dashboard shows correct KPIs from the aggregate layer, not live OLTP
```

---

## 4. Open client questions this module raises

- **Cost allocation basis:** freight/insurance/customs spread across lots by
  quantity or by value? (S-2 defaults to quantity — confirm.)
- **Realized vs unrealized trigger:** does profit realize on delivery, on invoice,
  or on payment? (Plan assumes delivery — confirm.)
- **Reservation expiry:** if an approved sale is never delivered, does the
  reservation ever auto-release? (Otherwise stock stays locked forever.)
- **Partial everything:** confirm partial delivery/invoice/payment are all real
  (the sheet implies yes via the Pending/Partial/Complete statuses).
- **Credit limit scope:** is the limit checked against outstanding receivables,
  or outstanding + open orders? (Affects the S-3 warning calc.)
- **Can a sale allocate lots across different divisions/warehouses**, or must all
  lots on one sale share a division? (Affects the allocation UI.)

---

## 5. The one-line sequence

S-1 (customer master, reuse supplier) → **S-2 (allocation + costing engine,
concurrency-proven in isolation — STOP if overselling is possible)** → S-3 (sales
order + reserve-on-approve) → S-4 (delivery consumes → stock out) → S-5 (invoice +
payment, receivables) → S-6 (dashboard). Prove S-2 before building anything on it,
exactly as C-2 was proven before the contract UI and tenant-isolation before the
Purchase module.
```
