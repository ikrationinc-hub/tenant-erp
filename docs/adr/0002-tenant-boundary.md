# 0002 - The tenant boundary (get-db.ts)

## Status

Accepted

## Context

CLAUDE.md rules 2-4 are the highest-consequence rules in the project: tenant
scope must come from the JWT only, `search_path` must be `SET LOCAL` (never
`SET`) and must live in one file only, and no query may ever cross a tenant
boundary. This ADR records how `src/database/get-db.ts` and the tenant
provisioning path satisfy that, and the non-obvious problems found while
building it.

## Decisions

- **`set_config('search_path', value, true)` instead of `SET LOCAL search_path
  TO ...`.** Postgres's `SET` statement cannot take a bind parameter in the
  value position - `set_config()` is the parameterized equivalent, and its
  third argument (`true` = is_local) is exactly `SET LOCAL`'s scoping. This
  means the tenant schema name is a genuine bound parameter, never
  string-interpolated SQL, on top of being regex-validated
  (`tenant/schema-name.ts`) before use.
- **Tenant tables are plain `pgTable` (no `pgSchema` binding).** The same
  `companies`/`branches` objects are reused for every tenant; only the
  connection's search-path setting decides which physical schema they hit.
  This is what makes `withTenantDb(ctx, fn)` work at all without a
  schema-name generic on every query.
- **A private, module-scoped pool lives inside get-db.ts, decoupled from the
  platform pool in `config/db.ts`.** `withTenantDb(ctx, fn)` is the only
  shape any caller sees; swapping this one pool for a per-tenant pool or a
  pool factory later does not change that signature or touch any repository.
- **Provisioning also goes through get-db.ts (`withTenantSchemaAdmin`), not a
  separate `SET search_path` call in `provisioner.ts`.** Two reasons: (1) the
  project's own boundary check
  (`scripts/check-search-path-boundary.mjs`, wired into `pnpm lint`) fails the
  build if that literal string appears anywhere outside get-db.ts, and (2) it
  keeps the "only one file touches this" rule true in fact, not just in the
  request path. Provisioning uses a dedicated one-off `pg.Client` (never the
  pool) and a session-level (non-local) `set_config`, which is safe there
  specifically because that connection is closed immediately after and never
  returned to a pool for a future request to inherit.

## A real bug this caught

Provisioning tenant_alpha then tenant_beta with identical migration files
silently no-opped the second tenant: drizzle's migrator tracks applied
migrations in `<migrationsSchema>.__drizzle_migrations`, **always
schema-qualified explicitly**, defaulting to one shared `"drizzle"` schema
regardless of which connection/session ran it. Tenant #1's migration hash
got recorded there; tenant #2's `migrate()` call saw that hash and concluded
"nothing to do," leaving `tenant_beta_xxx` schema created but empty.

Fix: `runMigrations()` now takes an optional `migrationsSchema` parameter,
and `provisioner.ts` passes the tenant's own schema name. Each tenant gets
its own independent `__drizzle_migrations` bookkeeping table, inside its own
schema - which also keeps `pg_dump -n tenant_x` self-contained (rule 9),
where a shared external bookkeeping schema would not have.

Separately, drizzle-kit's SQL generator hardcodes a `"public".` qualifier on
`CREATE TYPE` statements and FK `REFERENCES` targets even for completely
unqualified `pgTable` schemas (verified in the generated
`0000_mysterious_blindfold.sql` and its snapshot - `typeSchema: "public"` in
the JSON). Left alone, every tenant's enum types would collide on a single
`public.branch_status`/`public.company_status`, and the `branches ->
companies` FK would always point at `public.companies` instead of the
tenant's own schema. Both were hand-edited out of the generated migration.
**Anyone re-running `pnpm db:tenant:generate` after a schema change must
check the diff for reintroduced `"public".` qualifiers on enums and FK
targets and strip them before committing.**

## Deliberate scope cuts (this task, not forgotten)

- `scope-resolver.ts` decodes a base64url JSON "stub token" with no signature
  verification. Real JWT verification (jose) is explicitly the next prompt;
  this exists so scope resolution (tenant -> company -> branch, from the
  token only) can be built and tested now without redoing its contract later.
- `companies`/`branches` audit columns (`created_by`/`updated_by`) have no FK
  to a `users` table, because the tenant schema has no `users` table yet in
  this minimal proof-of-mechanism schema.
- `updated_at` is `defaultNow()`, not yet trigger-maintained as CLAUDE.md's
  table conventions specify - no migration currently creates the shared
  trigger function. Tracked as a gap to close when the audit/core engine is
  built, not silently dropped.
- The isolation test suite (`tenant-isolation.test.ts`) and the
  `scope-resolver` test each spin up their own Testcontainers Postgres
  (via a Vitest `globalSetup` for the former, [[0001-platform-schema-and-drizzle-setup]]'s
  own harness for `platform-schema.test.ts`) - two containers run per
  `pnpm test` invocation. Consolidating onto one shared container is a
  reasonable follow-up, not done here to avoid destabilizing the
  already-green platform-schema suite.
