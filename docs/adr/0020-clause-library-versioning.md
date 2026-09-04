# 0020 - Clause library: rich-text storage, one-active-version state machine, and worker DB access

## Status

Accepted

## Context

C-1 (docs/CONTRACT-MODULE-BUILD.md) builds the versioned clause library:
`clauses` (stable identity) and `clause_versions` (append-only, one row per
edit). The client's own stated requirement is absolute: editing a clause in
the library must never change what an already-signed contract says. Three
decisions needed recording before implementation - how clause text is
stored, how the "exactly one Active version" invariant is enforced, and how
the effective-dating scheduler gets database access, since the worker
process had none before this task.

## Decisions

- **Rich text stored as HTML, in a plain `text` column.** `clause_text` is
  never parsed or transformed server-side (C-2's placeholder resolver reads
  it as a string template) - HTML is the simplest format a browser-based
  rich-text editor can round-trip without a conversion step, and every
  other "flexible content" column in this schema (e.g. `audit_logs.before`/
  `after`) already prefers a directly-usable format over a custom
  serialization. No markdown, no delta/ProseMirror JSON - those would need
  a rendering step this module has no other reason to build yet.

- **The one-Active-version rule is enforced at the DB level, not just in
  application code.** `clause_versions_one_active_per_clause` is a partial
  unique index on `(clause_id) WHERE status = 'active'`. The promotion
  transaction (`promoteVersion`, duplicated identically in
  `apps/api/src/modules/contract/clause-promotion.ts` and
  `apps/worker/src/clause-promotion.ts`) already flips the prior Active
  version to Superseded before promoting the new one in the same
  transaction, so this index should never fire in practice - but a
  partial-unique index is cheap insurance against a future bug (a missed
  guard, a bypassed service-layer call) silently producing two Active
  versions, which would be a legal-correctness bug, not just a data one.

- **Versions are a strictly chronological timeline, not an interval set
  with independent bounds.** Rather than accepting arbitrary
  `effective_from`/`effective_to` pairs and validating no two intervals
  overlap, `addVersion` only accepts a new version whose `effectiveFrom` is
  strictly after every existing version's own `effectiveFrom` for that
  clause. Combined with `promoteVersion` always stamping the prior version's
  `effectiveTo` to exactly the new version's `effectiveFrom`, this makes
  "no overlapping/gapping windows" (C-1's own acceptance criterion) a
  structural guarantee rather than something validated after the fact - a
  gap or overlap becomes impossible to construct through the API at all,
  not just rejected when detected.

- **Approving a version never itself promotes it to Active**, even when
  `effectiveFrom` is already in the past. Approve and promote are
  deliberately separate steps (Draft -> Approved via `approveVersion`;
  Approved -> Active only via `promoteVersion`, triggered by either the
  scheduler or the on-access fallback) so a backdated `effectiveFrom` can't
  skip whatever legal sign-off process an approval is meant to represent
  (docs/CONTRACT-MODULE-BUILD.md Part 6 flags "should a clause-edit require
  legal sign-off before going Active" as an open client question - this
  keeps that door open without requiring an answer now). In practice, for a
  past-dated `effectiveFrom`, approval calls the on-access fallback
  immediately afterward, so the version reads back as Active in the same
  request - but that's the fallback running, not the approve action itself.

- **The worker process was given real Postgres access for the first time**,
  specifically to run the BullMQ scheduled promotion job
  (docs/CONTRACT-MODULE-BUILD.md C-1 item 5). Before this task,
  `apps/worker` had zero DB dependencies (`pg`/`drizzle-orm` weren't even in
  its `package.json`) - it only talked to Redis. Since `@ikration/api` isn't
  set up as an importable workspace package (no `exports`/`main`/`types`
  pointing at a build output), the worker keeps its own minimal mirror:
  `apps/worker/src/database/tenant-schema.ts` (just the tables its jobs
  touch: `clauses`, `clause_versions`, `audit_logs`, `companies`),
  `get-tenant-db.ts` (mirrors `apps/api`'s `withTenantSchema` - same `SET
  LOCAL search_path` via `set_config(..., true)`, same `hyperion_app`
  non-superuser role), and `get-platform-db.ts` (mirrors `apps/api`'s
  platform `db` client, for the tenant-listing loop). CLAUDE.md rule 3's
  "lives in get-db.ts and nowhere else" is now enforced per-app: a
  worker-local copy of `scripts/check-search-path-boundary.mjs`, scoped to
  `apps/worker/src/database/get-tenant-db.ts`, was added and wired into
  `apps/worker`'s own `lint` script. This worker-local database layer is
  not C-1-specific - C-2's document-generation job needs the identical kind
  of tenant DB access, so this is foundational infrastructure the module
  needs regardless of phase.

- **Known gap, not silently accepted:** `apps/worker` has no automated test
  coverage at all as of this task (no vitest config, no Testcontainers
  setup - `"test": "echo \"no tests yet\"\" && exit 0"` predates this work).
  The clause-promotion job's core promotion logic
  (`apps/worker/src/clause-promotion.ts`) is a deliberate near-line-for-line
  mirror of the api-side version, which IS fully covered (7 passing tests
  in `apps/api/src/modules/contract/__tests__/clauses.test.ts`, including
  the one-active-rule, future-dated promotion via a pinned `asOf`, and
  overlap rejection) - but the worker's own new DB plumbing
  (`get-tenant-db.ts`, `get-platform-db.ts`, the BullMQ repeat registration
  in `worker.ts`) is currently verified only by typecheck/lint, not an
  integration test. Building a Testcontainers harness for `apps/worker`
  (mirroring `apps/api/test/global-setup.ts`) was deliberately deferred
  rather than done ad hoc inside this task - it's real, standalone
  infrastructure that C-2's document-generation job will need too, and
  deserves to be built once, properly, rather than bolted on under time
  pressure here.
