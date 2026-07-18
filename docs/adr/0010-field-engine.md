# 0010 - Field engine (Tier 2)

## Status

Accepted

## Context

Tier 2 Configurable fields from the CLAUDE.md field model: a real typed
column plus a `field_definitions` row that can override label,
visibility, mandatory flag, and sort order without a deploy or migration.
Explicitly Tier 2 only - no Tier 3/`custom_fields`/JSONB, out of the
90-day scope. The reference requirement, from `docs/spec/Purchase-V2.md`
section G, is renaming "Other Charges" to "Clearing Charges" via a PATCH
call alone.

## Decisions

- **`field_definitions` rows are materialized eagerly for every company
  at provisioning time, one row per `core/field-engine/defaults.ts`
  entry, not created lazily on first override.** PATCH needs a real
  `:id` to target. If rows only appeared on first override, the "Other
  Charges" proof (PATCH before any prior override exists) would have no
  id to PATCH against. `core/provisioning/seed-field-definitions.ts`
  handles this via `onConflictDoUpdate` against the same
  `(company_id, module, entity, field_key)` partial unique index every
  other seed step uses, so it's naturally idempotent and re-run-safe
  (docs/adr/0009).

- **`core/field-engine/defaults.ts` is the single source of truth for
  what Tier 2 fields exist**, consumed by both the provisioning seed step
  and `resolve.ts`'s fallback merge. There is exactly one hardcoded list
  of Tier 2 fields in the codebase, not two that could drift - the
  previous provisioning-only field list (with a latent bug: `mobile`
  marked mandatory despite the column being nullable) was deleted in
  favor of this registry.

- **`data_type`, `module`, `entity`, and `field_key` are never read from
  the database row during resolution or mutation - they always come from
  the code default.** `resolve.ts`'s merge takes these four from
  `FIELD_DEFAULTS`, never the DB override; `updateFieldDefinition`'s
  input type doesn't even have a `dataType` field, and the HTTP
  validator's `.strict()` Zod schema makes sending one a 422, not a
  silently-ignored no-op. This is a structural guarantee, not a runtime
  check: renaming a label can't accidentally change what column, query,
  or calculation a field maps to, because there is no code path that
  reads a data type override in the first place.

- **`is_system` guardrails (cannot be hidden, cannot be made optional)
  live in `core/field-engine/mutations.ts`, checked against the
  system-field flag on the existing row before any update is applied** -
  not a DB constraint. A CHECK constraint can't express "only when
  `is_system = true`" against the *other* row's own boolean cleanly
  alongside the tier=2 CHECK already on the table, and the guardrail
  needs a clear `ForbiddenError` (403) for the API layer, not a raw
  constraint-violation error bubbling up.

- **No event bus.** This codebase has never built one (confirmed: every
  other cache-invalidation-on-change need - `role_version`,
  `menu_version` - calls the bump function directly after the write
  commits). `field_definition.changed` is satisfied by two things inside
  the same mutation: an `audit_logs` row with
  `action: "field_definition.changed"` written in the same transaction
  as the update (the durable record, per rule 6), and `bumpFieldVersion`
  called after the transaction commits (the cache invalidation).
  Introducing pub/sub for one new event type would be new infrastructure
  the task didn't ask for and no other part of the system uses.

- **Two-layer resolution, split at the cache boundary.** The task's cache
  key is `company_id:module:entity:field_version` - company-wide, no
  user or role component - but the final field list also has to respect
  per-user RBAC field permissions, which vary by role and are already
  cached separately (`core/rbac/cache.ts`, keyed by `role_version`).
  `resolveBaseFieldDefinitions` (cached, company-wide: code defaults
  merged with DB overrides) and `resolveFieldDefinitions` (uncached,
  intersects the cached base with `resolvePermissions(ctx)`'s cached
  field-permission map) are two functions, not one, so each half stays
  cacheable at the granularity its own version counter actually tracks.
  The final intersection is cheap enough to redo per request once both
  cached pieces exist.

- **`field_version` cache follows the same "missing key returns 0, not
  1" convention as `role_version` and `menu_version`** (`core/rbac/
  cache.ts`, `core/menu-engine/cache.ts`) - an off-by-one here was a real
  bug caught earlier in this project's RBAC cache, so the field-engine
  cache was written to match the established-correct pattern from the
  start rather than re-deriving it.
