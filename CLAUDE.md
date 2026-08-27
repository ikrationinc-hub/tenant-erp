# CLAUDE.md

Project instructions for Claude Code. Read this before every task.

## What we're building

A multi-tenant, multi-company **commodity trading ERP** (metals: LME-priced, hedged, shipped in containers). First client is a billion-dollar trading company. **Production-grade from commit #1 — this is a prototype in scope only, never in code quality.**

Current milestone: 16-week prototype — architecture + company onboarding + Purchase module + a thin schema-driven UI. See `docs/PROTOTYPE-PLAN-16-WEEKS.md`.

Team: 2 engineers, both doing backend and frontend. Time is the scarcest resource — prefer the boring solution.

---

## Stack — decided, do not relitigate

### Backend
| | |
|---|---|
| Runtime | Node.js 22 LTS, TypeScript 5 `strict` |
| HTTP | **Express 5** (not 4, not Fastify) |
| DB | PostgreSQL 17 + **Drizzle ORM** (not Prisma) |
| Cache/queue | Redis 7 + ioredis + BullMQ |
| Validation | **Zod** static · **AJV** for dynamic form schemas |
| Money | **decimal.js** + `numeric` columns |
| Auth | jose (JWT) + argon2id |
| Storage | MinIO (S3 API) via `@aws-sdk/client-s3` |
| Logging | Pino + AsyncLocalStorage |

### Frontend
| | |
|---|---|
| Framework | React 19 + TypeScript `strict` + Vite |
| Components | **Ant Design v5** (not shadcn, not MUI — AntD's Table/Tree/Transfer/Cascader ARE the product) |
| Server state | **TanStack Query v5** |
| Client state | **Zustand** — auth + UI prefs only. No Redux. |
| Forms | **React Hook Form** + Zod resolver, wrapping AntD inputs via `Controller` |
| Routing | React Router v7 |
| Mocking | **MSW** — handlers built from `packages/contracts` |
| Tests | Vitest + Testing Library + Playwright |

### Shared
pnpm workspaces + Turborepo. `packages/contracts` holds Zod schemas + inferred types, imported by **both** api and web. Backend tests: Vitest + Supertest + Testcontainers.

---

## The 10 backend rules (violating these is a bug, not a style preference)

1. **Money is never a JS number.** `numeric(18,2)` amounts, `numeric(18,6)` rates/quantities. `decimal.js` in code. Never `mode: 'number'` on a numeric column — silent float conversion. Parse to `Decimal` at the repository boundary.
2. **Tenant scope comes from the JWT.** Never body, query, or header. Not even for admin endpoints.
3. **`SET LOCAL search_path`, never `SET`.** Transaction-scoped only. A pooled connection leaking `search_path` across tenants is a data breach. Lives in `get-db.ts` and **nowhere else**.
4. **Never write a cross-tenant query.** Not one. It permanently kills the database-per-tenant migration path.
5. **Only the repository layer touches SQL.** Controllers and services never import `db`.
6. **Audit writes happen inside the business transaction.**
7. **Numbering is gapless.** Never a Postgres `SEQUENCE` for document numbers — it leaks on rollback. `number_series` + `SELECT FOR UPDATE`, same transaction as the insert.
8. **Posted documents are immutable.** Corrections are reversal + re-entry.
9. **No FK from a tenant schema to `platform`.** `pg_dump -n tenant_x` must be self-contained.
10. **Every list endpoint is paginated and filtered server-side.**

## The 7 frontend rules

1. **Never hardcode a field label, type, or form layout.** Forms render from `GET /field-definitions/:module/:entity`. An `<Input label="Other Charges" />` anywhere under `modules/` defeats the entire field engine and is a bug.
2. **Never hardcode navigation.** The menu tree renders from `GET /menus`. No route arrays in code.
3. **The frontend never calculates money.** FR-105/106/203 are server-side. The API returns `numeric` as **strings** — never `parseFloat` them. Display as given. If a live preview is genuinely needed, use decimal.js — never native arithmetic.
4. **Field permissions are UX, not security.** The backend resolves and enforces; the frontend renders whatever schema it's handed. Never re-derive permissions client-side.
5. **TanStack Query owns server state.** Zustand only for auth token + UI prefs. Never cache API data in Zustand.
6. **One component per spec field type**, in a registry (`core/schema-form/field-types/`). Thirteen exist — see `docs/spec/Purchase-V2.md` §4. Never a `switch` on field type outside the registry.
7. **Types come from `packages/contracts`.** Never redeclare an API type inside `apps/web`.

---

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

The frontend is **a rendering engine for backend metadata**, not hand-coded screens:
```
GET /field-definitions/purchase/purchase → schema → <SchemaForm/> → rendered form
GET /menus                               → tree   → <Navigation/>
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

Soft-delete-aware uniques: `create unique index ... where deleted_at is null`. Every composite index leads with `company_id`. Timestamps `timestamptz` UTC; business dates (LME fixing, invoice date) are `date`.

## Field model (three tiers — do not blur these)

- **Tier 1 Fixed** — typed columns. ~85%. Rate, quantity, exchange rate.
- **Tier 2 Configurable** — real column + `field_definitions` row overriding label/visibility/mandatory/order. This is how *"Other Charges — field should be named by user"* works.
- **Tier 3 Custom** — `custom_fields` JSONB. **NOT IN THE 16-WEEK SCOPE.**

If a task seems to need Tier 3, stop and ask.

## Layout

```
apps/api/src/
├── config/          env.ts (Zod-validated), logger.ts, redis.ts
├── database/
│   ├── platform/    control-plane schema + migrations
│   ├── tenant/      per-tenant schema + migrations
│   ├── get-db.ts    ← THE tenant boundary. search_path lives here only.
│   └── migration-runner.ts
├── common/          middleware/ errors/ money/ context/ events/ validators/
├── core/            module-registry, rbac, field-rbac, menu-engine, field-engine,
│                    numbering, workflow, audit, fx, pricing, storage,
│                    notification, provisioning
├── modules/         auth, users, roles, masters, trading, verticals/metals, inventory
│                    (each: controller, service, repository, routes, validator,
│                     events, manifest)
└── app.ts

apps/web/src/
├── core/
│   ├── schema-form/     ← THE renderer. SchemaForm, FieldRenderer,
│   │                       field-types/ (13), compile-validator.ts
│   ├── schema-table/    ← generic grid from column definitions
│   ├── navigation/      ← renders GET /menus
│   ├── permissions/     ← usePermission, <Can/>
│   └── api/             ← TanStack Query client, error handling, auth interceptor
├── modules/             auth, masters, purchase   ← thin. Screens compose core/.
├── app/                 router, layout, providers
└── mocks/               MSW handlers

apps/worker/src/     queues/, workers/, worker.ts   ← separate entrypoint
packages/contracts/  shared Zod schemas + types (api ↔ web)
```

## Working style

- **Small, verifiable steps.** One concern per commit.
- **Tests alongside code.** Testcontainers with real Postgres/Redis — **never mock the DB.** Mocked repos hide the exact constraint/locking/precision bugs that matter in an ERP.
- **Verify library APIs against current docs before using them.** Training data goes stale; Drizzle, Express 5, AntD v5, React Router v7 and TanStack Query v5 all move. Check rather than guess.
- **When the spec is ambiguous, stop and ask.** Don't invent business rules. Source: `docs/spec/Purchase-V2.md` — including its §5 open questions, which are NOT answered yet.
- **Record decisions** in `docs/adr/`.
- Conventional commits. Never commit secrets.

## Do not

- Add dependencies without asking
- Use `any`, or `as` to silence a type error
- Scatter `if (status === 'draft')` — that's the workflow engine
- Scatter `if (user.role === 'admin')` — that's the RBAC middleware
- Write `SET search_path` outside `get-db.ts`
- Hard-delete anything
- Build Tier-3 custom fields
- Hardcode a field label or a route in `apps/web`
- `parseFloat` an amount
- Optimize before it's measured


## Vocabulary — canonical terms (use these exact words everywhere)

Naming must be consistent across the API, the UI, the database, the audit log,
and every prompt. Drift here (Supplier in one screen, Vendor in another) confuses
users and fragments search. These are the canonical terms.

### Document lifecycle — use Zoho's names (the client benchmarked against Zoho)

| Concept | Canonical term | NOT |
|---|---|---|
| The purchase order | **Purchase Order** (PO) | — |
| Goods physically arriving | **Purchase Receipt** / "Receive" | goods-in, GRN* |
| The supplier's invoice to us | **Bill** | supplier invoice**, voucher |
| Money we pay out | **Payment** (deferred phase) | — |
| Fulfilment axes on a PO | **Received** / **Billed** | fulfilled, delivered |
| Fully received + fully billed | **Closed** | posted, completed |
| PO committed & sent to supplier | **Issued** | approved, posted |

\* The client may call the receipt a **GRN** (goods receipt note) — common in
trading/shipping. If they do, GRN wins. Treat "Purchase Receipt" as the working
default until the client confirms; it is provisional.
\** The spec sometimes said "supplier invoice." We standardize on **Bill** for the
document we receive from a supplier. Use one word, not two, for one thing.

### Parties — use the spec's / client's names, NOT Zoho's

| Party | Canonical term | NOT |
|---|---|---|
| Who we buy from | **Supplier** | Vendor (Zoho's word — do not use) |
| Who we sell to | **Customer** | Client, Buyer |
| The introducer/agent (D party) | **Broker** | agent, introducer, middleman |

Rationale: the client's own documents say Supplier/Customer. Their language beats
Zoho's. "Vendor" must not appear anywhere in Ikration.

### On the SELL side (Sales module, later) — mirror the convention

| Buy side | Sell side |
|---|---|
| Purchase Order | **Sales Order** |
| Purchase Receipt (goods in) | **Delivery** (goods out) |
| Bill (invoice we receive) | **Invoice** (invoice we issue) |
| Payment (we pay) | **Receipt** of payment (we're paid) |

Note the deliberate split Zoho uses and we adopt: a **Bill** is received from a
supplier; an **Invoice** is issued to a customer. Never use "invoice" for the
supplier document or "bill" for the customer document.

### Trading vocabulary — keep as-is (Zoho has no equivalent; do not invent)

LME · Agreed % (never "Premium") · Division · Broker · Lot · Bill of Lading (BL) ·
Container · Vessel · Voyage · Incoterm · Hedge / Hedging · Allocation · Fixing Date ·
Fixed vs LME (pricing type).

### Do NOT import from Zoho

- **TDS / TCS** — Indian withholding-tax jargon. Ikration's tax is multi-country
  and unresolved. Never use these terms or build their mechanics.
- **Vendor** — see parties above.
- **"Convert to Bill" tax handling** — the phrase/button is fine; the Indian tax
  logic behind it is not.

### The rule

Match Zoho for the lifecycle document nouns; keep the client's/spec's words for
parties; keep trading vocabulary for trading concepts; drop Zoho's tax jargon.
When the client uses a different word in a review (e.g. GRN), the client wins —
update this list and rename consistently.
