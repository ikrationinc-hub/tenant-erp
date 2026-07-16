# 0001 - Platform schema and Drizzle setup

## Status

Accepted

## Context

We need the control-plane (`platform`) schema and a Drizzle ORM setup before any tenant
schema or business logic exists. The spec for this prompt fixed most columns explicitly;
a few details were left to judgment.

## Decisions

- **Custom Postgres schema via `pgSchema("platform")`**, not the default `public` schema,
  so `pg_dump -n platform` stays self-contained and mirrors the `tenant_<name>` schema
  pattern used later (rule 9 in CLAUDE.md).
- **`timestamp(..., { withTimezone: true })`** for all timestamps, not a `timestamptz()`
  helper — Drizzle's pg-core has no such function; `timestamp` with `withTimezone: true`
  is the actual API and maps to Postgres `timestamptz`.
- **`platform_admins.updated_at`** was added even though the prompt's column list didn't
  mention it. `status` can transition (active/suspended) after creation, and every other
  table in this schema carries `updated_at`; omitting it here would be an inconsistency
  with no upside.
- **`tenant_modules.id` and timestamps** were added despite not being listed. The prompt's
  `unique on (tenant_id, module_key)` implies that pair is a constraint, not necessarily
  the primary key, so a surrogate `id` is needed for a table to exist at all.
- **`tenant_modules.tenant_id` FK uses `ON DELETE CASCADE`.** Module-enablement rows are
  meaningless without their tenant, and `tenants` has no `deleted_at` (tenants are
  deactivated via `status`, not soft-deleted) so cascade never fires on a routine
  soft-delete.
- **The generic three-level scope / soft-delete / `version` conventions from CLAUDE.md's
  "Table conventions" section do NOT apply to the `platform` schema.** Those conventions
  (`company_id`, `branch_id`, `deleted_at`) describe tenant-scoped business tables; the
  platform schema has no company/branch concept. The prompt's explicit, narrower column
  list for `tenants` / `tenant_modules` / `platform_admins` is followed as-is.
- **No dotenv.** `drizzle.config.ts` and `apps/api/src/config/env.ts` both read
  `process.env` directly and fail loudly if `DATABASE_URL` is missing, consistent with
  the rest of the project (no `.env` auto-loading anywhere else).
- **`db:generate` / `db:migrate` are plain `drizzle-kit` CLI calls**, not Turborepo tasks —
  they're side-effectful, non-cacheable commands against a real database, which doesn't
  fit Turbo's task model. Root `package.json` forwards to `apps/api` via
  `pnpm --filter @hyperion/api`.

## Consequences

- Tenant schema creation (next prompt) will reuse `runMigrations` from
  `src/database/migration-runner.ts` for per-tenant migrations, and will need its own
  `get-db.ts` for the `SET LOCAL search_path` tenant boundary — neither exists yet by
  design.
- `gen_random_uuid()` (used via Drizzle's `.defaultRandom()` on `uuid` columns) requires
  Postgres 13+ built-in support, or `pgcrypto` on older versions. The project's target is
  Postgres 17 (docker-compose), so no extension is needed there.
