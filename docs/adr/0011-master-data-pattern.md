# 0011 - Generic master-data pattern

## Status

Accepted

## Context

`docs/spec/Purchase-V2.md` §4 lists 16 masters the Purchase module needs
("Dropdown -> Master" fields). Hand-writing 15 near-identical CRUD modules
(schema + repository + service + controller + routes + validator each)
would be ~15x the same code with the entity name changed. The task asked
for ONE generic pattern, instantiated 15 times, with an explicit
instruction to stop and say so if the pattern stopped paying for itself by
the third instantiation - it didn't: 13 of the 15 masters are a single
`defineMasterModule({ entity, urlSegment, table, createSchema,
updateSchema })` call with no other code.

## Decisions

- **`defineMasterTable(tableName, extraColumns)`** (`database/tenant/
  schema.ts`) is the schema half of the pattern - a real function that
  calls `pgTable` internally, not just a shared column-spreading helper.
  Every master gets `id/company_id/branch_id/code/name/is_active/
  sort_order` plus `auditColumns()`, and a soft-delete-aware unique index
  on `(company_id, code)`. Only `cities` (a required `country_id` FK) and
  `items` (`item_type`, the vertical seam) pass `extraColumns` - the other
  13 pass `{}`.

- **Company-scoped, not tenant-wide.** The old `reference_masters`
  precursor this replaces was deliberately tenant-wide (no `company_id`)
  as a stated short-cut; this task explicitly builds the real pattern, and
  CLAUDE.md's table conventions ("every table, no exceptions") don't carve
  out a masters exception. `reference_masters` and its seed step
  (`core/provisioning/seed-reference-masters.ts`) are deleted, not kept
  alongside - two ways to seed the same four lists (countries, currencies,
  incoterms, uom) would drift.

- **Repository results are typed as `MasterRow`/`MasterInsert`
  (types.ts), not `InferSelectModel<T>`/`InferInsertModel<T>` for a
  generic `T`.** drizzle-orm's inference for these relies on a table's own
  internal config branding, which a generic `T extends MasterTable` type
  *parameter* doesn't carry (only a real, concrete table like `typeof
  cities` does) - attempting it produced unresolvable indexed-type errors
  throughout repository.ts/service.ts. `MasterRow`/`MasterInsert` are
  hand-written interfaces (the fixed columns, precisely typed, plus an
  index signature for whatever extra columns that master adds) that sidestep
  the problem entirely. Per-master extra-column type safety is enforced
  instead at the Zod validator layer (registry.ts's per-master create/
  update schemas, e.g. `cityCreateSchema` requiring `countryId: z.string
  ().uuid()`) and in the concrete closures a master supplies itself
  (`buildParentFilter`/`extractParentValue`, defined against the real
  table object, e.g. `eq(cities.countryId, parentValue)`) - the two places
  that actually need it, not the generic layer that can't have it anyway.

- **`raw = table as unknown as PgTable` inside the repository.** A second,
  related drizzle-orm limitation: `.from()`/`.insert()`/`.update()`
  overload resolution doesn't fully resolve when their table argument is a
  generic type parameter rather than a concrete table. Column
  *references* (`table.code`, `table.isActive`, ...) stay fully typed
  throughout and are used for every `eq`/`ilike`/`asc`; only the query-
  builder entry points use the widened `raw`. This is a working-around-
  the-type-system cast, not a masking of a real logic error - the runtime
  object is unchanged, and every caller of the repository still gets full
  type safety because `MasterRow`/`MasterInsert` are defined once and
  correct for every master.

- **No hard DELETE route.** CRUD's "D" is `PATCH .../:id/deactivate`
  (and `/activate` to reverse it), gated by the same `update` permission
  as a normal edit - not a separate grantable action. CLAUDE.md rule 8
  ("no hard deletes") plus the task's own explicit "deactivate hides from
  dropdowns but preserves existing references" requirement both point at
  the same design: `is_active` is the only lifecycle switch a master has.

- **`GET /api/v1/masters/:master/options`, registered as one static route
  per master** (`/countries/options`, `/cities/options`, ...) rather than
  a single `/:master` dynamic-segment handler resolved at request time.
  Both produce identical URL matching; the static form lets each route
  carry its own concrete `requirePermission("masters.<entity>.read")`
  middleware the normal way, instead of a hand-rolled runtime dispatch +
  permission check. This endpoint's shape (`{ options: [{ value, label,
  parentValue? }] }`, query params `search`/`parentValue`) matches a
  contract `apps/web` had already built against ahead of this task
  (`packages/contracts/src/master-options.ts`, `endpoints.ts`'s
  `masterOptions(master)`) - reconciling to it was in-scope (it's this
  task's own deliverable) and low-risk (an additive endpoint, not a
  change to anything already shipped); the wider `field-definitions`
  response-shape mismatch the frontend's contracts also reveal (sections
  vs. flat fields, a richer `FieldDefinition` type) was left alone as a
  separate, larger reconciliation this task didn't ask for.

- **Field-engine integration is data, not new endpoints.** Every master
  automatically gets three Tier-2 `FieldDefault` entries (`code`, `name`,
  `isActive`, the first two `isSystem: true`) plus whatever
  `extraFieldDefaults` its `defineMasterModule` call declares (cities'
  `countryId`, items' `itemType`), generated inside `factory.ts` and
  aggregated by `registry.ts` into `ALL_MASTER_FIELD_DEFAULTS`, which
  `core/field-engine/defaults.ts` concatenates into the existing
  `FIELD_DEFAULTS` export. `GET /api/v1/field-definitions/masters/:entity`
  (built in the prior field-engine task, entity-agnostic by design)
  therefore works for every master with zero new code in that module -
  the field engine's own genericity is exactly what "instantiate 15
  masters" gets to lean on for free.

- **Pagination/search established from scratch** (`page`/`pageSize`,
  1-indexed, `{ items, total, page, pageSize }`) - CLAUDE.md rule 10
  ("every list endpoint is paginated and filtered server-side") had no
  prior implementation anywhere in this codebase to match; the two
  existing list-shaped endpoints (`GET /menus`, `GET /field-definitions/
  :module/:entity`) both return small, bounded, whole-collection responses
  and were exempt in practice. This is the first endpoint that actually
  needs it, so the shape landed here.

- **Cascading filter is one query param, `parentValue`, reused for both
  the full CRUD list and the options endpoint** (not two different names,
  e.g. `countryId` on the list vs `parentValue` on options) - a master
  with no configured parent (13 of 15) just never has anything match it.
  One name, one code path (`MasterServiceConfig.buildParentFilter`), used
  identically by `list()` and `listOptions()`.
