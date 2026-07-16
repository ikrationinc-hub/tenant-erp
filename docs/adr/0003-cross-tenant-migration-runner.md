# 0003 - Cross-tenant migration runner

## Status

Accepted

## Context

Every tenant lives in its own `tenant_<slug>` schema, all built from the same
migration files (`src/database/tenant/migrations`). We need a deploy-step
that brings every active tenant schema up to date, tolerates one tenant's
migration failing without blocking the rest, and is safe to run repeatedly.
This must never run from app boot - N running API instances must not race
each other to migrate the same schemas.

## Decisions

- **A custom `schema_migrations` table per tenant schema, not drizzle's
  built-in migrator.** [0002](0002-tenant-boundary.md) already found that
  drizzle's `migrate()` tracks applied migrations in a schema-qualified
  bookkeeping table that defaults to one shared `"drizzle"` schema regardless
  of connection, and works around it there by passing `migrationsSchema`.
  For the ongoing cross-tenant runner we need more than that workaround
  gives us: per-schema pending/applied diffing we can query directly,
  continue-past-failure orchestration across many schemas in one run, and a
  report the caller can act on. Drizzle's `migrate()` provides none of that -
  it throws and stops on the first error. `runMigrations()` (the drizzle-based
  helper) is kept only for the platform schema, a single one-time migration
  target where none of this applies.
- **One transaction per schema covers ALL of that schema's pending
  migrations, not one transaction per migration file.** This is what makes
  "schema #2 fails, #1 and #3 still commit" well-defined: a schema either
  ends the run with every pending migration applied, or with none of them
  (whatever it had before the run, unchanged). Partial application within a
  single schema is never a state this system can produce.
- **`applyPendingTenantMigrations(schemaName)` is the single mechanism for
  "make this one tenant schema match the migration files,"** used by both
  `core/tenant/provisioner.ts` (a brand-new schema, where everything is
  pending) and `runTenantMigrations()` (existing schemas, mostly no-ops).
  Before this, provisioning used drizzle's own migrator while the ongoing
  runner would have used `schema_migrations` - two different bookkeeping
  mechanisms for the same schemas would have meant a freshly-provisioned
  tenant looks "fully pending" to the new runner (nothing recorded in
  `schema_migrations` yet) and tries to re-run migrations against tables
  that already exist. Provisioning was changed to call the same function.
- **`listActiveTenants` accepts a list of slugs, not just one.** The CLI only
  ever exposes a single `--tenant=<slug>` flag (translated to a one-element
  list) - the list form exists so tests (and any future programmatic caller)
  can scope one run to a known set of tenants. This matters concretely: all
  Vitest test files in a single run share one Testcontainers Postgres via
  `test/global-setup.ts`, so a filterless run inside a test would also pick
  up active tenants left behind by other test files.
- **The CLI (`scripts/migrate-tenants.ts`) is a plain `tsx`-run script, not
  wired into server boot or a BullMQ job.** It closes the platform pool and
  sets `process.exitCode` (never a bare `process.exit()`, so `finally` blocks
  still run) so CI/deploy tooling can rely on the exit code, and prints a
  report naming every schema's exact status alongside the structured pino
  logs `runTenantMigrations` already emits.

## Consequences

- `apps/api/tsconfig.json` now includes `scripts/` so `migrate-tenants.ts`
  gets full type-checking against the rest of the app; the existing
  `scripts/check-search-path-boundary.mjs` stays outside the TS project
  (`disableTypeChecked` override in `apps/api/eslint.config.js`) since it's a
  plain Node script with no tsconfig coverage.
- `test/global-setup.ts` must never statically import
  `src/database/migration-runner.ts` (or anything else under `src/`) - that
  file now imports `config/db.ts` for `listActiveTenants`, which imports
  `env.ts`, which would evaluate (and `process.exit(1)`) before globalSetup
  has set `DATABASE_URL`. Global setup inlines `drizzle-orm`'s `migrate()`
  directly for the one-time platform migration instead.
