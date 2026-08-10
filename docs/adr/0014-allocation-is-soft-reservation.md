# 0014 - Customer allocation is a soft reservation, not a binding sale

## Status

Accepted

## Context

Purchase's Customer Allocation sub-resource (FR-... "F", `purchase_allocations`)
lets a user record which customer(s) a purchase's stock is intended for,
and at what percentage. An earlier prompt added a hard block rejecting a
create once the cumulative allocation for a purchase exceeded 100%. The
client, asked directly, confirmed this is wrong: allocation is intent
only. Multiple customers may be allocated against the same purchase, the
percentages are not required to sum to any particular total, and -
critically - **the eventual sale is never bound to the allocated
customer**. Prompt 21 item 6 asks that this be corrected and recorded,
"this note matters more than the code."

This matters beyond the immediate bug fix: it is a constraint on how the
not-yet-built Sales module may use this data. Without this ADR, a future
session building Sales could reasonably infer from the existence of
`purchase_allocations` that it should enforce "this stock can only be
sold to its allocated customer" - which would be wrong and would need to
be un-built.

## Decisions

- **No over-100% block, ever.** `purchase-allocations.service.ts` keeps
  only the single-row sanity check (`0 < allocationPct <= 100` - a row
  can't itself be nonsensical), and does NOT sum existing allocations
  against a new one. Two allocations of 70% and 60% against the same
  purchase are both accepted; the purchase ends up "130% allocated" and
  that is not an error.

- **The frontend mirrors this: informational only, never blocking.**
  `PurchaseDetailScreen`'s Customer Allocation panel shows a running
  total ("Allocated: 130% (soft reservation only - not a hard limit)")
  purely for the user's awareness. It is never validated, never disables
  the Add button, and never surfaces as a form error - there is nothing
  server-side for it to mirror.

- **Sales (when built) must NOT enforce the allocated customer as
  binding.** An allocation row is a statement of intent captured at
  purchase time - useful for planning and reporting ("who did we buy this
  for") - not a reservation the sales flow is required to honor. When a
  Sales module is built, it must remain free to sell purchased stock to
  any customer regardless of what `purchase_allocations` says. If a
  future requirement genuinely needs a hard reservation (stock provably
  locked to one customer), that is a different, new feature - not a
  tightening of this one.
