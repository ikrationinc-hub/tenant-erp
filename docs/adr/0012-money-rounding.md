# 0012 - Money rounding

## Status

Accepted

## Context

`docs/spec/Purchase-V2.md` §5 open question #5 flags rounding mode as
undecided ("banker's or half-up? Auditors will ask.") and the Purchase
build task explicitly required asking before choosing, rather than
picking one unilaterally. This ADR also covers the mechanics of *when*
rounding happens in a multi-step calculation chain (FR-105 -> FR-106,
later FR-203), since that's a second, related decision the task's
"never a JS float, not even an intermediate" instruction implies but
doesn't spell out numerically.

## Decisions

- **Round half up**, confirmed with the user over banker's rounding
  (round-half-to-even). Half-up is what most ERPs and auditors expect by
  default for currency, and is intuitive to reconcile by hand against a
  supplier invoice - the reason this project's auditors would ask about
  it in the first place. Banker's rounding's advantage (less aggregate
  bias when summing many rounded values) wasn't judged worth the
  reconciliation surprise.

- **`common/money/decimal.ts`** is the one place `decimal.js`'s global
  config is touched (`Decimal.set({ rounding: Decimal.ROUND_HALF_UP })`),
  and the one place `numeric` columns are parsed to `Decimal` or
  formatted back to a fixed-precision string. No other file constructs a
  `Decimal` or calls `.toFixed()` directly - the same "one boundary"
  discipline `get-db.ts` already applies to `search_path`.

- **Two roundings, two precisions**, matching CLAUDE.md rule 1 exactly:
  `roundAmount()` rounds to 2 decimal places (`numeric(18,2)` - USD/AED
  amounts), `roundRate()` rounds to 6 (`numeric(18,6)` - unit rates,
  quantities, exchange rates, premiums). Both round-half-up.

- **Full precision through the whole chain; each column rounds
  independently off that chain, never off an already-rounded sibling.**
  FR-105's `purchase_amount_usd` and FR-106's `purchase_amount_aed` are
  both derived from the SAME unrounded `quantity x purchaseRateUsd`
  `Decimal` - `purchase_amount_aed` is never computed as
  `round(purchase_amount_usd) x exchangeRate`. Rounding a column, then
  feeding that rounded value into the next column's calculation, would
  compound rounding error invisibly across a chain (worse the more steps
  a future session adds - FR-203's premium calculation included).
  Rounding happens exactly once per column, at the moment that column's
  value is handed to the repository for insertion - never before, never
  reused.

- **Repository boundary parses `numeric` columns to `Decimal` immediately**
  (CLAUDE.md rule 1: "Parse to `Decimal` at the repository boundary").
  Controllers and services only ever hold `Decimal` instances or their
  `.toFixed()`-formatted string form for the wire; a raw driver string
  never reaches a calculation, and a `Decimal` never reaches
  `JSON.stringify` un-formatted (its default `toString()` can emit
  exponential notation for very small/large values, which is not a valid
  `numeric` literal).
