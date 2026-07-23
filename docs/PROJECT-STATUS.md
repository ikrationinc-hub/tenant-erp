# Hyperion ERP — Project Status

_Snapshot as of 2026-07-18. Ground-truth from reading the repo, not from prompt-completion claims. Re-verify before trusting this beyond a few weeks — re-run the same audit rather than assuming it's still accurate._

## Backend — against `docs/CLAUDE-CODE-PROMPTS.md`

| Prompt | State |
|---|---|
| 1 Scaffold | ✅ complete |
| 2 DB foundation | ✅ complete |
| 3 Tenant isolation | ✅ complete — `apps/api/src/database/__tests__/tenant-isolation.test.ts` covers the 100-concurrent cross-tenant leak test |
| 4 Migration fan-out | ✅ complete |
| 5 Auth | ✅ complete |
| 6 RBAC | ✅ complete |
| 7 Invite flow | ✅ complete |
| 8 Numbering + audit | ✅ complete |
| 9 Module registry + menus | ✅ complete |
| 10 Provisioning | ⚠️ **partial** — see below |
| 11 Field engine | ❌ not started |
| 12–14 Masters / Storage+Supplier / Purchase | ❌ not started |

Prompts 1–9 each have a real implementation plus a matching, substantive test suite, one commit per prompt, in order. These look genuinely done and match the acceptance criteria in the prompts doc (the hard concurrency/isolation tests actually exist and target the right invariants).

### Prompt 10 gap, specifically

Spec asks for `src/core/provisioning/` with `provisionTenant()` seeding roles, menus, field definitions, number series, reference masters, creating a company + branch, and exposing `POST /api/v1/platform/tenants`.

What actually exists: `apps/api/src/core/tenant/provisioner.ts` (48 lines) — creates the schema, runs migrations, seeds the permission catalogue and tenant modules. It does **not**:
- seed default roles / menus / field-defs / number series
- create a company or branch
- expose an HTTP endpoint (`modules/platform/` is an **empty directory**)

`core/provisioning/` itself is a dead, empty stub (with an empty `__tests__/` folder).

There is uncommitted, in-progress work right now (`platform-admin-auth.ts` middleware, `core/platform-auth/jwt.ts`) that looks like prep toward closing this exact gap — a separate platform-admin auth path, presumably feeding the missing `POST /api/v1/platform/tenants` endpoint.

## Frontend — against `docs/CLAUDE-CODE-PROMPTS-FRONTEND.md`

**`apps/web` does not exist on disk at all** — no Vite config, no React, no `.tsx` file anywhere in the repo, despite FE-1 reportedly being "just started."

The only trace of FE-1 work is two **uncommitted** Zod schema files in `packages/contracts/src/` (`auth.ts`, `errors.ts`).

Notably, FE-1's own stated prerequisite — *"FE-1 can start the moment `packages/contracts` has auth + field-definition schemas"* — is not fully met either, since Prompt 11 (field engine) doesn't exist, so no field-definition schemas exist anywhere. Worth syncing the two sessions on this before FE-1 goes further.

## Folder structure

```
apps/
  api/          the real system, see below
  worker/       bare BullMQ skeleton (one example queue + one example worker, no real jobs)
  web/          does NOT exist
packages/
  contracts/    nearly empty; 2 uncommitted files (auth, errors schemas)
  config/       shared tsconfig/eslint/prettier — fine
docker/docker-compose.yml   postgres:17, redis:7, minio, healthchecks — complete
.github/workflows/ci.yml    lint → typecheck → test → build — complete

apps/api/src/
  config/       env.ts, db.ts, logger.ts, redis.ts
  common/       errors/, middleware/ (error-handler, rbac, field-rbac, scope-resolver, ...)
  core/
    tenant/           provisioner.ts (thin — see Prompt 10 gap)
    auth/             jwt, password, invite-token, login-rate-limit
    rbac/             resolve, cache, mutations, queries
    numbering/        next-number.ts (gapless, SELECT FOR UPDATE)
    audit/            write.ts (before/after diff, immutable)
    module-registry/  manifests + loader
    menu-engine/      resolve + cache
    provisioning/     EMPTY stub
    platform-auth/    jwt.ts (new, uncommitted)
    notification/     mailer + templates
  database/
    get-db.ts             THE tenant boundary (SET LOCAL search_path)
    migration-runner.ts
    platform/schema.ts     3 tables
    tenant/schema.ts        16 tables, 9 migrations
  modules/
    auth/, users/     full controller/service/repository/routes/validator pattern
    menus/            thin passthrough to menu-engine
    health/
    platform/         EMPTY — this is where provisioning's HTTP endpoint would live
```

## Worked example: how a request actually flows today

Walking through *"invite a user, they accept, they log in, they try to approve a purchase order"* touches every layer that currently exists.

**1. Tenant resolution + DB boundary**
Every request hits `scope-resolver.ts` middleware, which pulls `{ tenant, company_id, branch_id }` **only from the JWT** — never body/query/header (CLAUDE.md rule 2). Stored in AsyncLocalStorage. Then `get-db.ts` opens a transaction and runs:

```sql
SET LOCAL search_path TO tenant_acme, public;
```

scoped to that one transaction only, so a pooled connection can't leak `tenant_acme`'s search_path into the next request. This is the only place in the codebase allowed to touch `search_path` — enforced by a CI grep.

**2. Invite (Prompt 7)**
`POST /api/v1/users/invite` → repository inserts into `tenant_acme.users` with `password_hash = NULL`, `status = 'invited'`, plus a row in `invitations` storing a **hash** of a one-time token (raw token emailed via Mailhog). No password ever touches this endpoint — admin-set passwords break non-repudiation on financial approvals, so the request is rejected if one is sent.

**3. Accept + login**
User hits `/invitations/:token/accept` with their own password → `argon2id` hash stored, `status = 'active'`. Login goes through `core/auth/jwt.ts`: access token (15m) + refresh token (7d, rotation + reuse-detection — a reused refresh revokes the whole token family). Claims: `{ sub, tenant, company_id, branch_id, roles[], jti }`.

**4. Permission check (RBAC)**
User calls `PATCH /purchases/:id/approve`. Middleware `requirePermission('purchase.po.approve')` calls `core/rbac/resolve.ts`, which runs **one query** joining `user_roles → role_permissions → permissions`, then caches the result in Redis keyed `user_id:role_version`. If an admin revokes the role mid-session, `role_version` bumps and the cache invalidates immediately — no stale-permission window.

**5. Field-level enforcement**
If the body includes a field the user's role can't edit (checked against `field_permissions`), the request is rejected with 403 naming the field — not silently stripped. This part works today. What doesn't exist yet is the Tier-2 `field_definitions` engine that would let an admin rename that field's label without a deploy — that's Prompt 11, not built.

**6. Numbering (gapless)**
For a new PO, `core/numbering/next-number.ts` runs `SELECT ... FOR UPDATE` on the `number_series` row **inside the same transaction as the insert** — never a Postgres `SEQUENCE`, because a rolled-back transaction must not burn a number. 100 concurrent calls → 100 unique sequential numbers, proven by test.

**7. Audit (same transaction)**
Whatever mutation happens, `core/audit/write.ts` writes a before/after JSONB diff into `audit_logs` in the **same business transaction** — if the business write rolls back, no orphan audit row exists. The Postgres app role has `UPDATE`/`DELETE` revoked on `audit_logs` entirely, enforced by a migration plus a test that confirms the app role can't violate it.

## DB schema: how the two-schema model works

**`platform` schema** (control plane, 3 tables) — one row per tenant, never touched by tenant-scoped requests:

```
tenants          (id, name, slug, schema_name, status)
tenant_modules   (tenant_id, module_key, enabled)
platform_admins  (id, email, password_hash, ...)   ← separate auth path from tenant users
```

**`tenant_<slug>` schema** (one physical Postgres schema *per tenant*, 16 tables) — what `search_path` switches into per-request:

```
companies, branches                                  ← legal entity / location
users, refresh_tokens, login_history                 ← auth
permissions, roles, role_permissions, user_roles,
  field_permissions                                  ← RBAC
invitations                                          ← onboarding
audit_logs                                           ← immutable, partitioned by month
number_series                                        ← gapless doc numbering
menus                                                ← nav tree
reference_masters, field_definitions                 ← masters/field-engine (both stubs so far)
```

Hierarchy:

```
Postgres cluster
 └─ platform schema        (which tenants exist, which modules they've paid for)
 └─ tenant_acme schema      (Acme's own copy of every business table)
     └─ companies           (Acme could have 2+ legal entities)
         └─ branches         (each company has N branches)
 └─ tenant_globex schema    (fully separate, same table shapes)
```

`pg_dump -n tenant_acme` is self-contained on purpose (rule 9: no FK from tenant → platform) — that's what keeps a future "split tenant onto its own database" migration possible without touching business tables.

**Concretely, `number_series`** — the row that makes gapless numbering work:

| company_id | branch_id | doc_type | fiscal_year | current_value | padding | prefix_pattern |
|---|---|---|---|---|---|---|
| Acme | Dubai | PO | 2026 | 42 | 4 | `PO-{BRANCH}-{FY}-{0000}` |

Creating PO #43 locks this row (`FOR UPDATE`), increments `current_value` to 43, formats `PO-DXB-2026-0043`, and commits both the number bump and the PO insert in one transaction — roll back the PO, and 43 is never consumed.

## Bottom line

Backend is genuinely strong through Prompt 9. Prompt 10 needs the provisioning HTTP endpoint plus full seeding (roles/menus/field-defs/number-series/company+branch) before it's truly done. The frontend session hasn't produced a scaffold yet despite starting FE-1, and its own stated prerequisite (field-definition contracts from Prompt 11) doesn't exist yet either — sync the two sessions on that before FE-1 goes further.
