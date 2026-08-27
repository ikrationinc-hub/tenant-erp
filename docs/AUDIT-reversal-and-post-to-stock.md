# Prompt — Audit: Reversal Path + Post→Stock Integrity

Pure audit. Change NOTHING. Report findings, then stop for review before any
build prompt. Two entangled questions: does reversal exist, and does Post
reliably move stock in-transaction. Same audit-first pattern as Prompt 17.

```
Investigate two things in the Purchase + inventory code and report back. Do
NOT fix anything in this prompt — audit and report only. If you find a bug,
describe it; do not patch it yet.

=== QUESTION 1: POST → STOCK INTEGRITY ===
Trace exactly what happens when a purchase is Posted.

  1. Find the Post transition handler (core/workflow + the purchase module).
  2. Does Posting write to stock_movements? Follow the path: transition →
     event (purchase.posted?) → inventory subscriber → insert. Or is it a
     direct repository call? Report which.
  3. THE CRITICAL QUESTION: does the stock write happen INSIDE the same
     database transaction as the status change to Posted? Or is it a separate
     transaction / a fire-and-forget event handler that could fail
     independently?
     - If the event bus is in-process and synchronous within the txn: good.
     - If it's fire-and-forget or runs after commit: that's the bug — a
       purchase can be Posted with no stock movement, and Sales would later
       allocate against inventory that isn't there.
  4. Is stock_movements append-only (no UPDATE/DELETE in its repository), and
     is the movement signed/directional (a purchase = positive/in)?
  5. Report: does Post reliably move stock atomically — yes / no / can't tell,
     and cite the files + lines.

=== QUESTION 2: REVERSAL PATH ===
Determine whether reversal/re-entry exists at all.

  1. Search for any reversal concept: a status like Reversed/Cancelled/Void, a
     reversal_of / reversed_by link column on purchases, an endpoint like
     POST /purchases/:id/reverse, or any handler that generates an opposite
     document.
  2. If NOTHING exists: state that plainly — reversal is not built, a Posted
     purchase currently has no correction path, and rule 8 (immutability) is
     therefore only half-implemented (immutable, but with no legal way to
     correct).
  3. If SOMETHING exists: describe exactly what it does. Specifically —
     - Does it leave the original Posted document intact (correct) or does it
       edit/delete it (a rule-8 violation)?
     - Does it generate a linked opposite stock movement (−qty) to un-move the
       inventory the original moved?
     - Is the reversal itself a proper document (numbered, audited, linked to
       the original)?
     - Can a purchase be reversed unconditionally, or is there any guard about
       downstream documents?

=== ALSO REPORT (context for the build decision) ===
  - How are stock balances currently derived — summing movements, or is there
    a mutable quantity column somewhere that Post decrements in place? (The
    latter would be a design violation per the append-only-ledger rule.)
  - Does the audit engine capture the Post transition with before/after?

Deliver a plain report structured as:
  1. Post→stock: atomic yes/no, with evidence
  2. Reversal: exists/doesn't; if it does, correct/violating, with evidence
  3. Balance model: ledger-derived / mutable-column, with evidence
  4. The single most important gap to close before Sales, in one sentence

Then STOP. Do not build. We decide the fix based on what you find.
```

---

## What the report will tell you, and what each outcome means

You're looking for one of a few combinations, and they point to different next steps:

**Post→stock atomic + no reversal** — the likely case. Foundation is sound; you just need to build reversal. Clean, bounded next prompt.

**Post→stock NOT atomic (fire-and-forget)** — this is the one that matters. It means a purchase can post while stock silently fails to move. Fix this *before* anything else and before Sales — it's the exact failure the prototype existed to catch, and Sales inherits the same event-handler pattern, so the bug would propagate.

**Reversal exists but edits/deletes the original** — a rule-8 violation hiding as a feature. Worse than no reversal, because it looks done. Would need reworking into true reversal + re-entry.

**Mutable quantity column instead of a ledger** — a deeper design issue. Everything downstream (reversal, Sales allocation, stock reports) assumes the append-only ledger. If Post decrements a column in place, that's worth knowing now, because it's cheaper to correct before Sales than after.

Run it, paste the report back, and I'll write the build prompt against what's actually there — reversal, the atomicity fix, or both, in the right order. No more guessing from screenshots; the code will tell us.

One thing to decide with the client in parallel (doesn't block the audit): **can a purchase be reversed after Sales has allocated its lots?** Most ERPs block it until you unwind the downstream sale first. You don't need the answer to build basic reversal now, but it's the one reversal rule that genuinely needs their input rather than your judgment.
