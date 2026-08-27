# 0018 - PO status refactor: Draft -> Issued -> Closed/Cancelled

## Status

Accepted

## Context

ADR 0016 and ADR 0017 both scoped this refactor to PL-3, describing it as "its
own audited migration since it touches existing data." Both consistently used
a three-state target - Draft -> Issued -> Closed - with `Approved` renamed to
`Issued` and `Posted` dropped entirely, its only real effect (rule 8
immutability) subsumed by the two derived/terminal states that replace it.
Neither ADR mentioned a fourth "Cancelled" state.

An audit before this build confirmed: the current enum is `[draft, approved,
posted]`; the `approve` transition has two guards (zero-item block, LME-record
requirement); `post` has none and does nothing beyond the status write; items
lock only at `posted` while header/costs/allocation lock at anything past
draft; `received_status`/`billed_status` (PL-1/PL-2) are the only derived
fulfilment signals, and both already exist independently of the PO's own
status. No "cancellation" concept exists anywhere in the codebase - the
closest analog, `reversed` on Bills/Receipts, is a different concept
(reversing a posted document) with no implemented transition to it.

Two decisions were confirmed with the user before building, since both
diverge from the two ADRs' literal wording:

1. **Add "Cancelled" as a genuine fourth state**, beyond what either ADR
   scoped - a PO the buyer calls off before fulfilment is common ERP need,
   and adding it now (alongside the rest of this migration) is cheaper than a
   separate future migration.
2. **"Closed" is automatic/derived only** - it fires the moment
   `received_status = fully_received` AND `billed_status = fully_billed`, with
   no manual "Close" endpoint, matching ADR 0017's literal wording exactly.

Live local data was checked before finalizing the migration mapping:
`tenant_dummy` had 12 purchases (5 `approved`, 7 `posted`, 0 `draft`), zero
receipts, and one bill total - meaning no purchase could possibly already be
fully received and fully billed, so every row maps to `issued`, none to
`closed`. `tenant_acme` and `tenant_abcd` had zero purchases each.

## Decisions

- **`purchaseStatusEnum` becomes `[draft, issued, closed, cancelled]`.**
  Postgres cannot rename or remove enum values in place when the meaning
  changes this much (unlike PL-2's straightforward column/table renames), so
  migration 0032 creates a new enum type, converts the column via an explicit
  `CASE` mapping cast through `text` (`draft -> draft`, `approved -> issued`,
  `posted -> issued`), drops the old type, and renames the new one to the
  canonical name - all in one migration, verified first against a scratch
  copy of real `tenant_dummy` data (schema + data dumped into a throwaway
  schema, migration applied there, confirmed correct, then dropped) before
  running it for real.

- **`approved_by`/`approved_at` columns are renamed to `issued_by`/
  `issued_at`** (same "rename in place, keep history" discipline as PL-2's
  `invoice_number -> bill_number`) - the concept these columns record didn't
  change, only its name. New `cancelled_by`/`cancelled_at` columns are added;
  there is no `closed_by` - Closed has no human actor, only ever written by
  the system, and its timestamp lives in `audit_logs` like every other
  system-driven change.

- **`approve()`/`post()` become `issue()`/`cancel()`** in
  `purchase.service.ts`. `issue`'s guards are identical to the old `approve`'s
  (zero-item block, LME-record requirement under LME pricing) - only the
  transition's name and target status changed, not what it protects.
  `permission.purchase.po.approve`/`.post` become `.issue`/`.cancel`; routes
  move from `/:id/approve`/`/:id/post` to `/:id/issue`/`/:id/cancel`.
  `seed-roles.ts`'s Manager-tier action list gains `"issue"` and `"cancel"`
  alongside `"approve"`/`"confirm"` - both are the same class of decision
  (issuing commits the order, cancelling kills that commitment), not
  day-to-day data entry.

- **`cancel` is NOT modeled as a `WorkflowTransition`/`findTransition` entry.**
  The engine (`core/workflow/transitions.ts`) represents one static
  `from -> to` edge per name, found by a plain name lookup with no way to
  disambiguate by the caller's actual current status - and cancel is reachable
  from either `draft` or `issued`. `transitionPurchaseStatus`'s CAS `UPDATE
  ... WHERE status = $from` genuinely needs the caller's own already-fetched
  status as `from`, not a value guessed from a static table. `cancel()`
  reads `existing.status` directly, validates it's one of `["draft",
  "issued"]` itself, and runs the same guard
  (`requireNothingFulfilledForCancel`) either way - a PO can only be
  cancelled while nothing has been received or billed against it yet
  (checked via `hasAnyReceiptForPurchase`/the new `hasAnyBillForPurchase`).
  A partially-fulfilled PO is a real transaction in motion, not a dead
  letter, so it can't be cancelled - it must reach `closed` (or stay
  `issued` forever, if the client never finishes fulfilling it - no forced
  terminal state exists for that case).

- **`maybeAutoClosePurchase` lives in a new file,
  `purchase-lifecycle.ts`**, not in `purchase.service.ts` itself. Both
  `purchase-receipts.service.ts`'s `confirm()` and
  `purchase-bills.service.ts`'s `approve()` need to check *both* derived
  axes after their own write (a receipt confirm needs `billedStatus` too, to
  know whether to auto-close; a bill approve needs `receivedStatus` the same
  way) - if `computeReceivedStatus` lived in `purchase-receipts.service.ts`
  and `purchase-bills.service.ts` imported it (or the reverse), that would be
  a genuine two-file circular import, since each file already needs
  something from the other for this exact check. `purchase-lifecycle.ts`
  holds both pure compute functions (`computeReceivedStatus`,
  `computeBilledStatus`, moved out of their original homes) and
  `maybeAutoClosePurchase` itself, depending on nothing but
  `purchase.repository.ts` and `core/audit` - breaking the cycle for good.
  It is called at the end of both transactions, using the freshest re-summed
  figures computed after that transaction's own write; a no-op unless the
  purchase is currently `issued` and both axes are fully done, and
  `transitionPurchaseStatus`'s own CAS (`WHERE status = 'issued'`) makes a
  second call in the same request cycle a safe no-op rather than a duplicate
  close.

- **Items stay editable through Issued; the terminal states (Closed or
  Cancelled) are what locks them** - `assertItemsEditable` now checks
  `status === "closed" || status === "cancelled"` in place of the old
  `status === "posted"` check. This preserves the exact editability window
  that existed before (Draft + Approved/now-Issued), consistent with
  dropping `posted` as a separate manual step: immutability now arrives
  automatically when the PO is actually done or dead, rather than through a
  disconnected manual accounting lock.

- **`roleIdsHoldApprovalPermission` (core/rbac/queries.ts) now also matches
  action `"issue"`, not only `"approve"`.** This guard exists to stop a
  provisioned account (temp-password, not self-registered) from holding a
  role that can make an irreversible financial commitment - issuing a PO is
  exactly that same class of commitment `approve` always meant to cover.
  `"cancel"` is deliberately excluded from this list: calling off an
  unfulfilled PO is not the financial commitment this check exists to gate.

- **The frontend follows the same rename**: `PurchaseListScreen.tsx`'s status
  filter chips/dropdown become Draft/Issued/Closed/Cancelled;
  `PurchaseDetailScreen.tsx`'s Approve/Post buttons become Issue (shown only
  in Draft) and Cancel (shown in Draft or Issued, behind a confirm popup);
  the info banners describe automatic closing instead of a manual Post step;
  `PURCHASE_STATUS_COLORS` gets four entries. `endpoints.ts`'s
  `approvePurchase`/`postPurchase` become `issuePurchase`/`cancelPurchase`.
  Unlike PL-1/PL-2's deliberate API-surface-preservation (Receipt and Bill
  were new/renamed sub-resources that could hide behind a wire-shape
  translation layer), the PO's own status is rendered directly everywhere -
  there's no equivalent translation trick for a status *value*, so the
  frontend rename happens in the same prompt as the backend's.

## Consequences

- Approving a PO (now "issuing") still has no inventory or financial side
  effect of its own - confirming a receipt still moves stock; approving a
  bill still records the liability. Closing is now the derived signal that
  both have finished, computed the same way `receivedStatus`/`billedStatus`
  already were, not a third manual step layered on top.
- A PO that's fully received and fully billed transitions to `closed`
  automatically the moment the second of those two axes completes,
  regardless of which one finishes first - the auto-close check runs from
  both `purchase-receipts.service.ts` and `purchase-bills.service.ts`,
  always using freshly re-summed figures from inside the same transaction as
  whichever write triggered the check.
- A PO with no `closed` transition available (because the client never
  finishes fulfilling it) simply stays `issued` indefinitely - there is no
  forced terminal state, and no manual override to force one from outside
  the automatic mechanism, matching the "Closed only" decision made with the
  user.
- `roleIdsHoldApprovalPermission`'s expansion to include `"issue"` is a
  narrow, deliberate widening of an existing security boundary, not
  incidental scope creep from the rename - it was caught by an existing
  regression test (`users.test.ts`'s "the provision path rejects a role
  holding an approval permission") failing immediately once `purchase.po
  .approve` stopped existing, confirming the check needed to move with the
  renamed permission rather than silently going dark.
