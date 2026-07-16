# CLAUDE.md

Project instructions for Claude Code. Read this before every task.

## What we're building

A multi-tenant, multi-company **commodity trading ERP** (metals: LME-priced, hedged, shipped in containers). Backend only for now. First client is a billion-dollar trading company. **Production-grade from commit #1 — this is not a prototype in code quality, only in scope.**

Current milestone: 90-day prototype — architecture + company onboarding + the Purchase module. See `docs/PROTOTYPE-PLAN-90-DAYS.md`.

## Stack — decided, do not relitigate

| | |
|---|---|
| Runtime | Node.js 22 LTS, TypeScript 5 `strict` |
| HTTP | **Express 5** (not 4, not Fastify) |
| DB | PostgreSQL 17 + **Drizzle ORM** + drizzle-kit (not Prisma) |
| Cache/queue | Redis 7 + ioredis + BullMQ |
| Validation | **Zod** static DTOs · **AJV** for dynamic form schemas |
| Money | **decimal.js** + `numeric` columns |
| Auth | jose (JWT) + argon2id |
| Storage | MinIO (S3 API) via `@aws-sdk/client-s3` |
| Logging | Pino + AsyncLocalStorage |
| Tests | Vitest + Supertest + Testcontainers |
| Repo | pnpm workspaces + Turborepo |

## The 10 rules (violating these is a bug, not a style preference)

1. **Money is never a JS number.** `numeric(18,2)` for amounts, `numeric(18,6)` for rates/quantities. `decimal.js` in code. Never `mode: 'number'` on a numeric column — that's a silent float conversion. Parse to `Decimal` at the repository boundary.
2. **Tenant scope comes from the JWT.** Never from body, query, or header. Not even for admin endpoints.
3. **`SET LOCAL search_path`, never `SET`.** Transaction-scoped only. A pooled connection leaking `search_path` across tenants is a data breach. This lives in `getDb(ctx)` and **nowhere else**.
4. **Never write a cross-tenant query.** Not one. It permanently kills our database-per-tenant migration path.
5. **Only the repository layer touches SQL.** Controllers and services never import `db`.
6. **Audit writes happen inside the business transaction.** An audit log that can diverge from the data is worse than none.
7. **Numbering is gapless.** Never use Postgres `SEQUENCE` for document numbers — it leaks on rollback. Use `number_series` + `SELECT FOR UPDATE`, same transaction as the insert.
8. **Posted documents are immutable.** Corrections are reversal + re-entry, never edits.
9. **No FK from a tenant schema to the `platform` schema.** `pg_dump -n tenant_x` must be self-contained.
10. **Every list endpoint is paginated and filtered server-side.** From day one.

## Architecture

```
platform schema        tenants, tenant_modules, platform_admins, break_glass_sessions
tenant_<name> schema   companies, branches, users, roles, permissions, field_permissions,
                       audit_logs, suppliers, purchases, stock_movements,
                       field_definitions, number_series, market_prices
```

Three-level scope on every business table: `tenant` (schema) → `company_id` (legal entity) → `branch_id`.

Request pipeline:
```
requestId → helmet/cors → rate limit → authenticate → resolve tenant/company/branch
→ SET LOCAL search_path (in txn) → module enabled? → permission check
→ validate → reject write-forbidden fields (403) → controller → service → repository
→ events → audit (same txn) → strip read-forbidden fields → response
```

## Table conventions — every table, no exceptions

```sql
id            uuid primary key default gen_random_uuid()
company_id    uuid not null
branch_id     uuid
created_at    timestamptz not null default now()
updated_at    timestamptz not null      -- trigger-maintained, not app code
created_by    uuid not null
updated_by    uuid
deleted_at    timestamptz               -- soft delete. NO hard deletes.
version       integer not null default 1  -- optimistic locking
```

- Soft-delete-aware uniques: `create unique index ... where deleted_at is null`
- Every composite index leads with `company_id`
- All timestamps `timestamptz`, stored UTC. Business dates (LME fixing, invoice date) are `date`, not timestamp.

## Field model (three tiers — do not blur these)

- **Tier 1 Fixed** — typed columns. ~85% of fields. Rate, quantity, exchange rate.
- **Tier 2 Configurable** — real column + `field_definitions` row overriding label/visibility/mandatory/order. This is how *"Other Charges — field should be named by user"* works.
- **Tier 3 Custom** — `custom_fields` JSONB, whitelisted entities only. **NOT IN THE 90-DAY SCOPE.**

If a task seems to need Tier 3, stop and ask. It's out of scope.

## Layout

```
apps/api/src/
├── config/          env.ts (Zod-validated), logger.ts, redis.ts
├── database/
│   ├── platform/    control-plane schema + migrations
│   ├── tenant/      per-tenant schema + migrations
│   ├── get-db.ts    ← THE tenant boundary. search_path lives here only.
│   └── migration-runner.ts
├── common/
│   ├── middleware/  auth, scope-resolver, rbac, field-rbac, error, rate-limit
│   ├── errors/      AppError hierarchy
│   ├── money/       Money value object, decimal wrappers
│   ├── context/     AsyncLocalStorage request context
│   └── events/ validators/ utils/ types/
├── core/            module-registry, rbac, field-rbac, menu-engine, field-engine,
│                    numbering, workflow, audit, fx, pricing, docgen, storage,
│                    notification, provisioning
├── modules/         auth, users, roles, masters, trading, verticals/metals, inventory
│                    (each: controller, service, repository, routes, validator,
│                     events, manifest)
└── app.ts
apps/worker/src/     queues/, workers/, worker.ts   ← separate entrypoint, same modules
packages/contracts/  shared Zod schemas + types (api ↔ web)
```

## Working style

- **Small, verifiable steps.** One concern per commit. Don't build three engines in one pass.
- **Tests alongside code**, not after. Testcontainers with real Postgres/Redis — **never mock the DB.** Mocked repos hide exactly the constraint/locking/precision bugs that matter in an ERP.
- **Verify library APIs against current docs before using them.** Training data goes stale; Drizzle and Express 5 both move. If unsure of an API, check rather than guess.
- **When the spec is ambiguous, stop and ask.** Don't invent business rules. The source spec is `docs/spec/Purchase-V2.md`.
- **Record decisions** in `docs/adr/` as you make them.
- Conventional commits. Never commit secrets.

## Do not

- Add dependencies without asking
- Use `any`, or `as` to silence a type error
- Scatter `if (status === 'draft')` — that's the workflow engine's job
- Scatter `if (user.role === 'admin')` — that's the RBAC middleware's job
- Write `SET search_path` outside `get-db.ts`
- Hard-delete anything
- Build Tier-3 custom fields
- Optimize before it's measured
