# Purchase Order Short-Close — Plan & Prompt

**Client requirement, verbatim intent:** *"PO raised for 10 pcs, supplier only
has/ships less — need to finalize the purchase at the lesser quantity received,
and bill only for what was actually received."*

**This is SHORT-CLOSING, not reversal.** Do not confuse with the true-reversal
work (correcting mistakes on posted documents). Short-close is for the normal,
expected case where a supplier under-delivers and everyone agrees the remainder
is not coming. Nothing is being "undone" — the PO's expected quantity is simply
being finalized downward.

---

## 1. Terminology (use these words, not "reversal")

| Term | Meaning |
|---|---|
| **Ordered Qty** | What the PO originally asked for (e.g. 10) |
| **Received Qty** | What has actually arrived so far, across one or more receipts (e.g. 7) |
| **Short-Closed Qty** | The remainder formally written off as "not coming" (e.g. 3) |
| **Short-Close** | The action of finalizing a line at less than ordered, so it stops waiting for the rest |

---

## 2. What already exists (per PL-1/PL-2) vs what's new

| Capability | Status |
|---|---|
| Receiving less than ordered (partial receipt) | Already specified in PL-1 |
| Multiple receipts against one PO until fully received | Already specified in PL-1 |
| Bill quantity defaults from Receipt, not from the original order | Specified in PL-2 — **verify, don't assume** |
| **A deliberate action to say "no more is coming" and finalize the line** | **Missing — this prompt adds it** |
| **A distinct "Short Closed" status**, separate from "Partial" | **Missing — this prompt adds it** |

Without the short-close action, a PO that's genuinely finished (supplier will
never send the rest) sits forever as "Partial, awaiting 3 more" — which is
exactly the problem the client is describing.

---

## 3. Design

### Per line item
Add to `purchase_items` (or wherever per-line receipt tracking lives):
- `ordered_qty` (existing)
- `received_qty` (existing, derived from receipts)
- `short_closed_qty` (NEW — the written-off remainder)
- `line_status`: `Open` | `Partial` | `Short Closed` | `Fully Received`

`short_closed_qty` is written once, by an explicit action, never inferred.

### The action — Short Close
- Available on a PO line once at least one receipt has happened and
  `received_qty < ordered_qty`.
- **Per line**, plus a convenience **"Short Close All Remaining"** at the PO
  level for when every open line is being finalized at once.
- Requires a **reason** (required field — mirrors the change_reason pattern
  already used elsewhere in the codebase, e.g. clause versioning). This is the
  audit trail for *why* the order was short-closed.
- Requires a dedicated permission: `purchase.line.shortclose`.
- Sets `short_closed_qty = ordered_qty − received_qty` for that line, and flips
  `line_status` to `Short Closed`.
- The **PO's overall `received_status`** (the derived field from PL-3) gains a
  new value: `Short Closed` — distinct from `Partial` and `Fully Received`. A PO
  is `Fully Received` only if every line is Fully Received; `Short Closed` if
  every open line is either Fully Received or Short Closed (i.e., nothing is
  still genuinely pending); still `Partial` if some lines are neither.

### Re-opening (default: allowed, gated by permission)
If the supplier later does send the remainder, a short-closed line can be
re-opened (`purchase.line.reopen` permission) — clears `short_closed_qty`,
returns to `Partial`, and receiving resumes normally. This is the uncommon
path; most short-closes are final. **Confirm with the client whether this
should exist at all, or whether short-close should be permanent (no
re-opening).** Easy to remove if they want it strictly final.

### Billing
Verify (don't assume) that the Bill's default line quantities pull from
`received_qty`, never `ordered_qty`. This is the second half of the client's
ask — "invoice with less qty only" — and it should fall out naturally from
PL-2's design (Bill links to Receipt), but must be checked, not assumed,
since it's the exact requirement being solved here.

### Audit
Every short-close and re-open is a normal audited write (existing audit
engine) — who, when, reason, before/after quantities.

---

## 4. The prompt

```
Build purchase-order short-closing: finalizing a PO line at less than the
ordered quantity when a supplier under-delivers and won't send the rest.

TERMINOLOGY: this is SHORT-CLOSING, not reversal. Do not reuse any reversal/
undo mechanism for this — nothing is being corrected or undone. A short-close
finalizes a line at a lower quantity going forward; it does not touch or
reverse the receipt(s) that already happened.

Read CLAUDE.md and PURCHASE-LIFECYCLE-4DOC.md (PL-1, PL-2, PL-3) first. Audit
before building — report:
1. Does purchase_items (or equivalent) already track received_qty derived
   from receipts, per line?
2. Does the Bill's default line quantity pull from received_qty or from
   ordered_qty? This is the crux of the client's requirement — verify exactly,
   cite the code.
3. Confirm there is currently NO short-close or equivalent "finalize as
   partial" action anywhere in the purchase module.

BUILD:
1. Add short_closed_qty (numeric, default 0) and line_status (enum: Open,
   Partial, Short Closed, Fully Received) to the per-line receipt tracking
   introduced in PL-1. line_status is derived/maintained, not free-entry.

2. POST /purchase-orders/:id/lines/:lineId/short-close
   Body: { reason: string (REQUIRED) }
   - Only valid when received_qty < ordered_qty and at least one receipt exists
     against the line.
   - Sets short_closed_qty = ordered_qty − received_qty, line_status =
     'Short Closed'. Write in a transaction with the audit entry (before/after,
     reason, who, when — existing audit engine).
   - Does NOT touch existing stock_movements or receipts. Nothing is reversed.
   - Reject with a clear error if received_qty already equals ordered_qty
     (nothing to short-close) or if no receipt has happened yet (short-closing
     an order with zero receipts is a cancellation, not a short-close — a
     different, existing action).

3. POST /purchase-orders/:id/short-close-remaining
   Convenience: applies the same action to every line on the PO that is
   currently Partial. Same reason requirement, same audit.

4. Extend the PO's derived received_status (from PL-3) with a 'Short Closed'
   value: the PO is Short Closed when every line is either Fully Received or
   Short Closed (nothing genuinely still pending), Fully Received only if
   every line is Fully Received, otherwise still Partial. Update wherever
   received_status is computed/displayed.

5. POST /purchase-orders/:id/lines/:lineId/reopen (permission-gated,
   purchase.line.reopen) — clears short_closed_qty, line_status back to
   Partial. This is the exception path; most short-closes are final. Flag in
   your response whether the client should confirm this is wanted, or whether
   short-close should be permanent instead.

6. VERIFY (and fix if wrong) that Bill line quantities default from
   received_qty (specifically: received_qty − already_billed_qty), never from
   ordered_qty. This is the actual client requirement — "invoice with less
   qty only" — get it right.

7. Permissions: purchase.line.shortclose, purchase.line.reopen. Seed and
   assign sensibly in the provisioning defaults.

8. FRONTEND: on a PO with a partially-received line, a "Short Close" button
   next to that line (and a PO-level "Short Close All Remaining" button).
   Clicking opens a small form: shows ordered/received/would-be-short-closed
   quantities, requires a reason, confirms. After short-close, the line shows
   a clear "Short Closed — 3 of 10 not received" style label, distinct from
   "Partial." The PO's status badge reflects the new Short Closed state where
   applicable. Reachable by clicking, both menu trees unaffected (no new
   screen, just new actions on the existing PO detail page).

TESTS:
- Short-close on a line with received 7 of ordered 10 → short_closed_qty=3,
  line_status=Short Closed, audited with reason
- Short-close rejected without a reason
- Short-close rejected if received_qty already equals ordered_qty
- Short-close rejected if zero receipts exist against the line
- PO received_status becomes 'Short Closed' when all lines are Fully Received
  or Short Closed; stays 'Partial' if any line is still genuinely open
- Creating a Bill against a short-closed PO defaults its line quantity to the
  RECEIVED qty (7), never the ordered qty (10) — this is the core test
- Re-open clears short_closed_qty and returns the line to Partial (if this
  path is kept)
- Short-close does NOT alter any existing stock_movement or receipt record

Acceptance:
- Audit report delivered first, especially item 2 (Bill quantity source)
- A PO can be finalized at less than ordered without touching what already
  happened, and its Bill reflects only what was truly received
- Terminology in all code, labels, and messages says "Short Close" — not
  "reversal," "cancel," or "close" alone (which already means something else
  in the PO lifecycle)
```

---

## 5. One thing to confirm with the client, not to guess

**Should a short-closed line ever be re-opened** if the supplier later sends
the rest, or is short-close meant to be final and permanent once done? I've
built it as reversible-with-permission by default (the safer, more flexible
choice), but if their process treats a short-close as a hard finalization —
matching what "convert purchase in less received qty" sounds like — drop
step 5 from the prompt and it becomes permanent. Cheap to decide either way
before building; costly to relitigate after.
