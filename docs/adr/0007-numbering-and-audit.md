# 0007 - Numbering engine and audit hardening

## Status

Accepted

## Context

Two engines CLAUDE.md calls out as rules, not style preferences (rules 6
and 7), built and made load-bearing: gapless document numbering, and an
audit trail that's actually immutable at the database level, not just by
application-code convention. The prior audit_logs table (built during the
user-onboarding task) already followed the audit-inside-the-transaction
discipline; this task hardens it (partitioned, genuinely un-mutable) and
adds numbering from scratch.

## Decisions

- **A second, non-superuser Postgres role (`hyperion_app`) is now what
  every normal business query runs as** - `get-db.ts`'s tenant pool
  connects via a new `DATABASE_APP_URL`, while migrations/provisioning
  keep using `DATABASE_URL`'s superuser. This was necessary, not optional:
  Postgres superusers bypass every ACL check, so `REVOKE UPDATE, DELETE ON
  audit_logs` against the role the app already used (the `docker-compose`
  `POSTGRES_USER`, a superuser) would have been a complete no-op. The role
  is created idempotently (exception-based on `duplicate_object`, not
  check-then-create - see below) and granted per-schema privileges by
  `migration-runner.ts`'s `ensureAppRoleGrants`, which runs after every
  tenant migration attempt, including a no-op one, so an already-migrated
  tenant from before this feature existed still ends up correctly
  configured.

- **`number_series` uses `UNIQUE ... NULLS NOT DISTINCT`** (Postgres 15+),
  not a plain unique constraint. `branch_id` is nullable (a company-level
  series has no branch), and Postgres's default nulls-are-distinct
  behavior would let two concurrent first-ever inserts for the same
  no-branch series both succeed - exactly the race `SELECT ... FOR UPDATE`
  exists to prevent. Without it, the uniqueness guarantee silently doesn't
  apply to the no-branch case.

- **`nextNumber` rolls a series over to a new fiscal year automatically**,
  cloning the prior year's `prefix_pattern`/`padding` rather than requiring
  every fiscal year to be pre-configured by hand. The insert-if-missing
  step uses `onConflictDoNothing()`, not a plain insert: a `SELECT ...
  FOR UPDATE` against a row that doesn't exist yet locks nothing, so two
  concurrent callers can both reach "no row for this fiscal year" at once.
  Exactly one wins the insert; the other's is a no-op, and the mandatory
  re-select `FOR UPDATE` immediately after is what actually serializes
  them from that point on. A `doc_type` with no prior configuration in ANY
  fiscal year has nothing to roll over from and is treated as a setup
  error (out of this task's scope: no "configure a number series" admin
  endpoint exists yet).

- **Pattern tokens: `{BRANCH}`, `{FY}`, and any run of zeros `{0+}`.** The
  zero-count in the token (e.g. `{0000}`) is a human-readable convention,
  not machine-parsed - the actual zero-pad width always comes from the
  `padding` column, which is the authoritative value the task's schema
  calls out as its own field. `{BRANCH}` with no branch given is a thrown
  `ValidationError`, not a silently blank segment.

- **`audit_logs` is genuinely immutable, not just by convention** - a
  migration `REVOKE`s `UPDATE, DELETE` on it from `hyperion_app`
  specifically, on top of the blanket `GRANT ... ON ALL TABLES` every
  other tenant table gets. `company_id`/`changed_by` are nullable,
  mirroring `login_history`'s existing precedent: a login attempt against
  an unknown email resolves neither. An attempt where the tenant itself
  can't be resolved has no schema to write into at all and is still only
  `logger.warn`-ed, same as before this task.

- **`audit_logs` is `PARTITION BY RANGE (changed_at)` from its very first
  migration**, with a `DEFAULT` partition as a catch-all. Its primary key
  is composite `(id, changed_at)` because Postgres requires the partition
  key to be part of any unique/primary key constraint on a partitioned
  table. drizzle-kit's schema DSL can't express `PARTITION BY` at all, so
  this table's migration is hand-written rather than generated (the
  `pgTable` definition in schema.ts still exists and is accurate - it's
  used for query-building against the partitioned parent, which behaves
  like a normal table for every DML statement the app issues; only the
  DDL creating it had to be manual).

- **Partition maintenance runs on the admin connection
  (`migration-runner.ts`'s `ensureAuditLogPartitions`), never inline in
  the business transaction that's writing an audit row.** This was a real
  bug caught by the test suite: `hyperion_app` only has `USAGE` on the
  tenant schema, not `CREATE`, so it cannot create a new partition table.
  Granting it `CREATE` to allow that would mean it OWNS whatever partition
  it creates - and table owners retain full privileges (including UPDATE/
  DELETE) regardless of any `REVOKE` issued to them as a *non-owner* role,
  which would silently defeat this entire feature for every partition
  created after the fact. `insertAuditLog` (`core/audit/write.ts`) does
  NOT attempt to ensure a partition exists; `ensureAuditLogPartitions` pre-
  creates a rolling window of months (default: one before, current, two
  ahead) every time tenant migrations run for a schema, which is what
  keeps the scheme self-sustaining in practice. A write that falls outside
  the currently-maintained window lands in `audit_logs_default` - fully
  correct, just not yet split into its own partition.

- **Role creation and partition creation are both exception-based
  idempotency, not check-then-act.** `CREATE ROLE` has no `IF NOT EXISTS`
  form in Postgres at all, and a plain `SELECT pg_roles ... IF NOT EXISTS
  THEN CREATE` has a race window two concurrent sessions (parallel test
  files, or two tenants provisioning at once) can both pass through before
  either commits. Catching the exception from the `CREATE` statement
  itself has no such window - Postgres raises it atomically from the DDL
  statement, not from a separate check. Both blocks catch two exception
  classes, not one, learned the hard way by a flaky parallel test run: two
  concurrent `CREATE ROLE`s racing on the same name raise
  `unique_violation` on `pg_authid`'s own index, not `duplicate_object` -
  role creation apparently doesn't go through the same higher-level
  "already exists" check `CREATE SCHEMA`/`CREATE TABLE` do, where
  `duplicate_object`/`duplicate_table` reliably fires instead. Both
  `EXCEPTION` blocks now catch both, since a partition-creation race could
  plausibly hit the same lower-level path.

- **`core/audit/write.ts`'s `computeDiff` keeps only changed keys**, not
  the full before/after row twice - a wide row with many unrelated columns
  shouldn't double its own audit footprint on every edit that only
  touches one field. `request_id` is stored as `text`, not `uuid`: it can
  be client-supplied via the `X-Request-Id` header
  (`request-context.middleware.ts`), which is never validated as UUID-
  shaped, and a strict `uuid` column would reject a well-formed but
  non-UUID correlation id.
