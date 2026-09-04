# 0022 - Division-scoped contract fields: extending the field engine, not a new field_master

## Status

Accepted

## Context

C-3a (docs/CONTRACT-MODULE-BUILD.md) asks for the contract form's fields
to differ per division (Scrap first, Metal/others later), driven by data
not code, using the EXISTING field engine rather than a new field_master
table. Before building anything, an audit of `field_definitions`,
`core/field-engine/resolve.ts`, `defaults.ts`, and the field VALUE
mechanism was required and is recorded here alongside the decisions it
produced.

## Decisions

- **`field_definitions` gained one nullable column (`division_id`), not a
  new table.** NULL means "applies to all divisions," the same optional-FK
  convention `purchases.divisionId` already established. This satisfies
  the prompt's explicit instruction not to build a parallel field_master -
  the field engine's own scoping (`companyId, module, entity, fieldKey`)
  was simply extended by one dimension.

- **Two PARTIAL unique indexes replace the old single 4-column one**, not
  one 5-column index. Postgres unique indexes treat every NULL as distinct
  from every other NULL, so a single index including a nullable
  `division_id` would silently allow the SAME `fieldKey` to be inserted
  twice with `division_id` NULL - exactly the ambiguous "which one is THE
  all-divisions row" collision this column exists to prevent.
  `field_definitions_company_module_entity_field_key_all_divisions`
  (`WHERE division_id IS NULL`) and
  `field_definitions_company_module_entity_field_key_division` (`WHERE
  division_id IS NOT NULL`) are each a real uniqueness guarantee in their
  own partition of the table.

- **The decisive audit finding: there is no field-VALUE storage layer in
  this codebase at all** - every Tier 2 field's actual value lives in a
  real typed column on a real table (confirmed via `purchase.po.freight`
  and the "Other Charges" reference case: `field_definitions` carries zero
  value-bearing columns, only label/visibility/mandatory/order metadata).
  `custom_fields`/Tier 3 JSONB is the only value-store concept this schema
  has, and CLAUDE.md explicitly puts it out of scope. This meant a minimal
  `contracts` table with real typed columns (`materialType`, `weightKg`,
  `rateUsd`, `deliveryTerms`) was a structural PREREQUISITE for C-3a's own
  test ("values persist and reload") to be satisfiable at all - confirmed
  with the user before building it, per the prompt's own instruction to
  verify before adding anything.

- **`materialType`/`weightKg`/`rateUsd`/`deliveryTerms` are a PLACEHOLDER
  field set, not the client-confirmed Scrap field list.** The prompt's own
  instruction was to confirm the real list before seeding; that
  confirmation has not happened. These four are named after the prompt's
  own example fields only. Expect `defaults.ts`'s `contract/header`
  entries and the `contracts` table's columns to change once the real list
  is confirmed - this is tracked debt, not a finished field set.

- **A `FieldDefault` (the code-declared catalogue in `defaults.ts`) is
  scoped by division CODE ("SCRAP"), never a divisionId/UUID.** Every
  company gets its OWN `divisions` rows with their own generated ids at
  provisioning time (`core/masters/seed-data.ts`'s `DIVISION_SEEDS`), but
  `FIELD_DEFAULTS` is a single static array evaluated once, before any
  company or division row exists - a UUID can never be a valid
  code-declared constant here. `seed-field-definitions.ts` resolves each
  company's own division code to its real `division_id` at seed time,
  immediately before writing the `field_definitions` row; `resolve.ts`
  does the inverse lookup (a requested `divisionId` -> that division's own
  `code`) before calling `getFieldDefaults`, so the DB column and every
  runtime query are always keyed by the real UUID - only the static
  declaration layer (`FieldDefault.divisionCode`) ever uses the code.

- **`seedMasterData` now runs BEFORE `seedDefaultFieldDefinitions`** in
  both `provisionTenant`'s fresh-provisioning path and
  `reProvisionExistingTenant`'s idempotent resync path (`provision-
  tenant.ts`) - was the reverse order before this task. A division-scoped
  field default needs that company's own Scrap division row to already
  exist so its code can be resolved to a real `division_id`. Neither
  function depends on the OLD order for anything else.

- **A `field_definitions` row whose `divisionCode` has no matching
  division for a given company is skipped and logged, never thrown.**
  Several existing tests (and, in principle, any company that hasn't been
  seeded with the standard four-division set) call
  `seedDefaultFieldDefinitions` without first seeding matching divisions -
  a real, valid state, not a configuration error. Throwing would fail
  every OTHER field in the same seeding batch for an unrelated reason;
  skipping just the affected field (self-healing on the next re-run, once
  that company's divisions exist) matches this function's own existing
  idempotent, re-run-safe design.

- **`resolve.ts`'s merge (division-specific row wins over an "all
  divisions" row for the same `fieldKey`) mirrors the SAME two-pass
  pattern at two layers**: once over DB rows (`resolveBaseFieldDefinitions`)
  and once over code defaults (`getFieldDefaults`) - needed because two
  code defaults for the same `module/entity/fieldKey` but different
  `divisionCode` are both valid, simultaneous entries in `FIELD_DEFAULTS`
  (one for "all divisions," one for a specific division), and only one
  may surface per request.

- **The Redis cache key gained a `divisionId` segment** (defaulting to the
  literal string `"all"`), so Scrap's and a future division's resolved
  field lists never collide on the same cache entry - but `bumpFieldVersion`
  deliberately stays keyed WITHOUT a division component: any write to
  ANY division's (or the shared, division-NULL) rows for an entity
  invalidates every division's cached result at once. This is intentionally
  coarser than per-division invalidation - a shared field_definitions row
  (division_id IS NULL) exists whose edit must invalidate every division's
  view anyway, so per-division invalidation would still need a "bump
  everything" fallback for that case; one shared counter is simpler and
  always correct, just occasionally invalidates a little more eagerly than
  strictly necessary.

- **Onboarding a division is a DATA task, proven concretely**: a
  test-only "METAL" division's own `alloyGrade` field
  (`apps/api/src/modules/contract/__tests__/contract-fields.test.ts`)
  required zero changes to `resolve.ts`, `cache.ts`, or any resolution
  logic - only a new `FIELD_DEFAULTS` array entry (still code-declared
  data, the same catalogue every other Tier 2 field in this codebase
  already lives in, not a new `if` branch or function). This is the
  correct reading of "no code change" for THIS field engine's own
  architecture: `resolve.ts`'s `resolved` array is built by mapping over
  `getFieldDefaults`'s code defaults, never the DB rows directly, so a
  `field_definitions` DB row with no matching `FIELD_DEFAULTS` entry was
  already invisible for every module before this task, division-scoping
  or not - this is a pre-existing field-engine property, not something
  C-3a introduces or could bypass.

- **The frontend (`SchemaForm.tsx`) gained one optional `divisionId`
  prop**, threaded into both the TanStack Query key and the
  `GET /field-definitions/:module/:entity?divisionId=...` request -
  omitted entirely, every other caller's behavior is byte-identical to
  before this task. A new `ContractFieldSetupScreen` (division picker +
  `<SchemaForm module="contract" entity="header" divisionId={...}/>`)
  proves the full chain end to end: picking Scrap renders Scrap's fields,
  a create actually persists to the real `contracts` table, and reloading
  round-trips the same values back through the same field mechanism.

## Consequence

Onboarding a new division's contract fields going forward is: add
`FIELD_DEFAULTS` entries with the new `divisionCode`, re-run
`seedDefaultFieldDefinitions` for existing tenants (a backfill script,
same pattern as every other field-engine/permission addition in this
codebase). No new table, no new resolve-time branch, no frontend change
beyond passing the selected division's id - `SchemaForm` itself is
already division-agnostic.
