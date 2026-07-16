# Hyperion ERP — Backend Plan v2

**Supersedes:** `Hyperion-ERP-Backend-Master-Plan.md` (v1)
**Changed since v1:** deployment model, scope (multi-country + multi-vertical), stack picks, onboarding model, timeline.
**Status:** Plan of record. D-001 needs one explicit confirmation (§1). Everything else is locked or tracked in §11.

---

## 1. Decision register

Locked. Changing anything here after Phase 1 is a re-plan, not a ticket.

| ID | Decision | Status | Notes |
|---|---|---|---|
| **D-001** | **Schema-per-tenant.** One Postgres instance, one database, one schema per tenant. | ⚠️ **Confirm** | You asked for "one DB now, easy split to db-per-tenant later." Schema-per-tenant *is* one DB and makes the split a `pg_dump -n`. Plan is written on this. Say the word if you meant shared-schema + `tenant_id`. |
| **D-002** | **Three-level scope:** `tenant` (schema) → `company_id` (legal entity) → `branch_id` (operations). | ✅ | Multi-country forces this. `company_id` carries country, currency, tax regime, fiscal year, number series. |
| **D-003** | **Three-tier field model:** Tier 1 fixed / Tier 2 configurable / Tier 3 user-created. | ✅ | Requires a signed Tier-3 whitelist. See §4. |
| **D-004** | **One trading spine**, verticals as plugins. Not four copies of purchase/sales. | ✅ | `modules/trading` + `core/vertical-registry` + `modules/verticals/*`. |
| **D-005** | **Metals ships first.** Other verticals are architecture-ready, not delivered. | ⚠️ A-002 | Only vertical with a spec. |
| **D-006** | **Invite-based onboarding.** Admins never set passwords. | ✅ | Non-repudiation for OTP approvals. See §5. |
| **D-007** | **Users live in the tenant schema.** Platform admins in a separate table + separate auth. | ✅ | Keeps `pg_dump -n` self-contained. |
| **D-008** | **Break-glass platform access**, not free impersonation. | ✅ | Time-limited, reason-required, tenant-notified, audited in *their* trail. |
| **D-009** | **LME manual entry now, feed later**, behind a `PriceSource` port. | ✅ | Prices land in immutable `market_prices`, never straight onto a transaction. |
| **D-010** | **Express 5** + TypeScript strict. | ✅ | Familiarity > throughput at 2 engineers. Not Express 4. |
| **D-011** | **Drizzle ORM** + `drizzle-kit`. | ✅ | Three gotchas in §7.2. |
| **D-012** | **Audit trail is compliance-grade from commit #1.** | ✅ | Immutable, append-only. Cannot be retrofitted. |
| **D-013** | **Money is `numeric` + decimal.js.** Never a JS float. | ✅ | Enforced by lint rule. |
| **D-014** | **2 backend engineers.** | ✅ | Timeline in §9 is built on this. |

---

## 2. What you're building

A **multi-tenant, multi-company, multi-vertical commodity trading ERP**, metals first.

The Excel is the real spec, and it describes physical commodity trading: LME-priced metals, moved in containers on vessels, hedged, invoiced in USD/AED across legal entities. Auth/RBAC/CRUD is the well-understood 30%. Three things carry the risk:

| | The hard part | Why |
|---|---|---|
| **A** | **Lot allocation & costing chain** | Purchase lot → reserved → allocated to sales → landed cost spread across lots → gross profit. Concurrent, money-exact, auditable. |
| **B** | **Contract / clause assembly engine** | Clause library, conditional rules, drag-drop ordering, placeholder substitution from live data, versioning, Word+PDF, e-signature. A product in its own right. |
| **C** | **Dynamic fields + field-level rights** | Excel demands both. D-003 makes it tractable; §6 makes field-rights honest. |

Multi-country adds a fourth: **the tax engine** (§3.3).

---

## 3. Architecture

### 3.1 Topology

```
                       ┌─────────────┐
   React SPA ─── TLS ──│    Nginx    │  ← subdomain routes tenant
                       └──────┬──────┘     (hyperion.yourerp.com)
                              │
                     ┌────────▼─────────┐        ┌──────────────────┐
                     │   API process    │        │  Worker process  │
                     │  (Express 5)     │        │  (BullMQ)        │
                     │                  │        │                  │
                     │ middleware chain │        │ - docgen         │
                     │ module registry  │        │ - reports        │
                     │ core engines     │        │ - notifications  │
                     │ trading spine    │        │ - LME sync       │
                     │ vertical plugins │        │ - recon / close  │
                     └───┬──────────┬───┘        └───┬───────────┬──┘
                         │          │                │           │
                    ┌────▼───┐  ┌───▼────┐       ┌───▼───┐   ┌───▼────┐
                    │Postgres│  │ Redis  │       │ MinIO │   │ LibreO │
                    │  17    │  └────────┘       │(files)│   │ (→PDF) │
                    └────────┘                   └───────┘   └────────┘
```

Same codebase, two entrypoints (`server.ts` / `worker.ts`). A 200-page contract PDF must never block the request loop.

### 3.2 Tenancy

```
platform                       ← control plane, becomes its own DB on split
├── tenants                       (id, name, schema_name, status, plan)
├── tenant_modules
├── platform_admins               ← you/Knackroot. Separate auth entirely.
└── break_glass_sessions

tenant_hyperion                ← self-contained. pg_dump -n = a whole tenant.
├── companies                     ← legal entities (country, currency, tax, FY)
├── branches
├── users, roles, permissions, user_roles, role_permissions, field_permissions
├── audit_logs
├── suppliers, purchases, sales, contracts, stock_movements, ...
└── field_definitions, form_schemas, number_series, market_prices
```

**Four rules that keep the db-per-tenant split cheap:**

1. The repository layer is the **only** place that touches SQL.
2. A single `getDb(ctx)` accessor. Today: one pool + `search_path`. Later: per-tenant pool. Business logic never learns the difference.
3. **Never write a cross-tenant query.** Not one. The first cross-tenant report JOIN permanently kills the split.
4. No FK from a tenant schema to `platform`. Ever.

### 3.3 Multi-country reality

The Excel has `VAT/TRN` as a textbox. That works for one country. It does not survive several:

- **Tax regime per legal entity.** UAE VAT is a flat 5%; India GST splits CGST/SGST/IGST by place-of-supply. Not a rate column — a rules engine.
- **E-invoicing mandates.** India is live. UAE has a phased programme. **Verify current status and dates with the client's tax advisor** — this moves, and my information may be stale. If any entity is in scope, that's an integration, not a checkbox.
- **Number series per legal entity**, not per tenant. Sequential-invoice rules attach to a tax registration.
- **Fiscal year per entity.** India Apr–Mar, UAE Jan–Dec. Every report needs an entity-aware calendar.
- **Functional vs reporting currency**, plus consolidation across entities.
- **Data residency.** India's DPDP Act may prevent an India entity's data sitting in a UAE-hosted schema. Confirm before choosing where the box lives — it can invalidate D-001.

→ `core/tax-engine/` joins the engine list.

### 3.4 Verticals

Metals, toys, and electronics share a spine: **buy → hold → allocate → sell → profit.** Different item attributes, same skeleton. Real estate may not fit at all (A-001).

```
modules/trading/            ← ONE core: purchase, sales, allocation, costing, invoice
core/vertical-registry/     ← item_types: fields, modules, rules per vertical
modules/verticals/
├── metals/                 ← LME + hedging (plugs into trading)
├── electronics/            ← serial / warranty  (later)
├── toys/                   ← SKU               (later)
└── realestate/             ← only if trading, not leasing (A-001)
```

*Architect* multi-vertical day one — cheap, mostly discipline. *Ship* metals first — necessary, it's the only vertical with a spec.

### 3.5 Request flow

```
Request
  → requestId (AsyncLocalStorage)
  → helmet / CORS / body limits
  → rate limit (Redis, per-user + per-IP)
  → authenticate (JWT)
  → resolve tenant → company → branch   ← from token, NEVER from body
  → SET LOCAL search_path                ← inside the transaction only
  → module-enabled check                 ← module registry
  → permission check                     ← module.entity.action
  → validate (Zod static | AJV compiled dynamic)
  → reject write-forbidden fields        ← field-level RBAC (403, not silent strip)
  → controller → service → repository → Postgres
  → domain events emitted
  → audit log write                      ← SAME transaction
  → serialize + strip read-forbidden fields
  → response
```

Two details that matter: field-check **before** validation (forbidden fields are rejected, not silently dropped), and the audit write **inside** the transaction (an audit log that can diverge from the data is worse than none in a financial audit).

---

## 4. The three-tier field model

| Tier | What | Storage | Example from the Excel |
|---|---|---|---|
| **1 — Fixed** | Typed columns. ~85% of fields. | Real columns | `Purchase Rate (USD)`, `Quantity`, `LME Fixing Date`, `Exchange Rate` |
| **2 — Configurable** | Real column, metadata-overridable: label, visibility, mandatory, default, dropdown source, order | Column + `field_definitions` | `Other Charges` → *"field should be named by user"*; `Other Documents 2` → *"rename by user"* |
| **3 — Custom** | User-created fields, whitelisted entities only | `custom_fields` JSONB + `field_definitions` + `form_schemas` | Client-specific approval steps, extra PO line attributes, vertical-specific item attributes |

```sql
field_definitions (
  id, tenant_scope, company_id, module, entity,
  field_key,          -- 'other_charges_1' | 'custom_broker_ref'
  tier,               -- 1 | 2 | 3
  label,              -- user-overridable
  data_type,          -- text|number|decimal|date|bool|enum|lookup|file
  is_visible, is_mandatory, is_editable,
  default_value, options_source, validation_json,
  visibility_condition_json,
  sort_order, is_system, version
)
```

**Why it works:** the client's ask ("let me rename this and control who sees it") is satisfied at Tier 2 — metadata, not schema. Tier 3 is explicitly whitelisted, so a purchase order never degrades into a JSONB blob.

**Costs to accept:** Tier-3 fields are hard to report on. Mitigation: Postgres **generated columns** promoting frequently-filtered custom fields to real indexed columns, plus GIN indexes on `custom_fields`.

**Hard rule:** a Tier-1 field never becomes Tier-3 because a stakeholder asked in a meeting. That path ends at a fully generic ERP and a 3-year timeline.

**Action:** the Tier-3 whitelist is a signed document. Without it, this model dies by a thousand cuts.

---

## 5. Identity & onboarding

```
Knackroot (platform_admins)
   └── onboards tenant → creates schema, runs migrations, seeds, creates tenant admin
         └── Tenant admin (Hyperion)
               └── invites employees → email + mobile + roles   (NO password field)
                     └── employee: single-use expiring token
                           → sets own password
                           → email verified implicitly
                           → mobile verification forced
                           → active
```

**Why admins never set passwords:** the Excel wants OTP approval on financial transactions. The point is non-repudiation — "Approved by Ahmed" must legally mean Ahmed. If the admin typed Ahmed's password, the admin can *be* Ahmed, and the audit trail is worthless for every account. "He changed it on first login" doesn't fix it; the admin can reset again tomorrow.

**Exception:** warehouse/ops staff with no email → admin-set temp password + forced change, flagged in the audit log as admin-provisioned, and **blocked from holding approval permissions**. Financial approvals require self-set credentials. Defensible in an audit; "we trust the admin" is not.

**Login routing:** subdomain. Tenant resolves at Nginx before auth — no lookup table, no email-enumeration leak. Tenant-code field on the login form is the fallback.

**Segregation of duties:** tenant admin defaults to user/role management **without** financial approval. Granting it is an explicit, logged act. One person who both assigns roles and approves money is an audit finding in any real review.

---

## 6. Field-level RBAC

Standard `module.entity.action` permissions, plus:

```sql
field_permissions (id, company_id, role_id, module, entity, field_key, can_view, can_edit)
```

Enforced at **two boundaries only** — never inside business logic:

1. **Write, before validation** — forbidden field in the body → `403`. Not a silent strip; silent strips generate "I saved it and it didn't save" tickets.
2. **Read, at serialization** — strip non-viewable fields. Must cover list endpoints, exports, PDFs, and reports. **Every egress path.** Missing one is the whole bug.

**Performance:** resolve `{permissions, fieldPermissions, menuTree}` once per request, cache in Redis keyed `user_id:role_version`, bump `role_version` on any role/permission change. Never query per field.

**The trap:** hiding `Purchase Rate` is meaningless if `Gross Profit` and `Sales Rate` are visible — the rate is arithmetic away. You need a **derivation-dependency map**, or explicit written client acceptance that field-hiding is a UI convenience, not a security control. This is exactly what a security review finds.

---

## 7. Technology inventory

### 7.1 Core

| Tech | Version | Note |
|---|---|---|
| Node.js | 22 LTS | LTS through 2027 |
| TypeScript | 5.x `strict` | + `noUncheckedIndexedAccess` |
| Express | **5** | D-010. Verify `express-rate-limit`, `helmet`, body parser against v5 in **week 1** — some middleware still assumes v4 internals |
| pnpm + Turborepo | | Monorepo: `apps/api`, `apps/worker`, `apps/web`, `packages/contracts` |
| tsx / tsup | | Dev runner + build. Not `ts-node` |

### 7.2 Database

| Tech | Note |
|---|---|
| PostgreSQL | 17 |
| **Drizzle ORM** + drizzle-kit | D-011 — three gotchas below |
| pg | Driver |
| pgcrypto | Field-level encryption: bank details, TRN/VAT |
| pg_partman | `audit_logs` partitioned by month **from day one** — it becomes your largest table |
| pgBackRest | Replaces the docx's "daily pg_dump to SSD". Incremental + PITR + verified restore |
| PgBouncer | Only at the db-per-tenant split. Transaction mode breaks session vars — `SET LOCAL` only |

**Drizzle gotcha 1 — schema-per-tenant.** `pgSchema()` binds the name at *build* time; you can't parameterize it per request. Don't fight it. Define tables unqualified, set schema per transaction:

```ts
await db.transaction(async (tx) => {
  await tx.execute(sql`SET LOCAL search_path TO ${sql.identifier(tenantSchema)}, public`);
  // Drizzle queries now hit the tenant schema
});
```

`SET LOCAL`, never `SET` — transaction-scoped, so a pooled connection can't leak one tenant's `search_path` into another's request. **Getting this wrong is a cross-tenant breach.** It lives in `getDb(ctx)` and nowhere else, with a test that proves isolation under concurrency.

**Drizzle gotcha 2 — `numeric` returns strings.** That's correct. Don't "fix" it. Never `mode: 'number'` on a money column — that's a silent float conversion. Parse to `Decimal` at the repository boundary.

**Drizzle gotcha 3 — migration fan-out is yours.** `drizzle-kit generate` emits SQL; applying it across N schemas transactionally, tracking per-schema version, handling partial failure — that's your `migration-runner.ts`. Budget several days in Phase 1 and test against 3 schemas where one fails mid-run.

### 7.3 Money & correctness

| Tech | Why |
|---|---|
| **decimal.js** | `0.1 + 0.2 !== 0.3`. On 500 MT at $8,432.75 with a 2.35% premium converted to AED, float drift becomes a reconciliation dispute with a billion-dollar client |
| `numeric(18,2)` / `numeric(18,6)` | Amounts / rates + quantities. Never `float8` |
| `Money` value object | Amount + currency + explicit rounding policy (banker's vs half-up — auditors ask) |
| date-fns + `timestamptz` | All storage UTC. LME fixing dates are business `date`, not timestamps |

### 7.4 Cache, queue, jobs

Redis 7 · ioredis · **BullMQ** (docgen, reports, notifications, LME sync, reconciliation, period close) · bullmq-board.

### 7.5 Auth & security

jose (JWT) · argon2id · otplib (TOTP) · **SMS gateway ⚠️** (per-country — Twilio's Gulf delivery is inconsistent; a UAE-local gateway may be needed alongside) · Nodemailer + client SMTP relay · helmet · cors · express-rate-limit + rate-limit-redis · **HashiCorp Vault** (on-prem; never `.env` in prod) · **ClamAV** on every upload · Trivy in CI.

### 7.6 Validation

**Zod** for static DTOs (single source of truth for types) · **AJV** for the Tier-3 dynamic path — compiles JSON Schema to optimized functions, cached by schema hash; building a Zod schema per request is slower and you'd hand-roll the compiler anyway · **zod-to-json-schema** bridges static Zod → frontend form rendering + OpenAPI.

### 7.7 Document generation

| Tech | Note |
|---|---|
| **docxtemplater** ⚠️ | Placeholder substitution + loops + conditionals — matches the Excel's Contract Assembly Workflow exactly. **HTML/image/table modules are paid** — budget ~€1–3k |
| *alt:* carbone.io | Evaluate against docxtemplater in the Phase 0 spike |
| **LibreOffice headless** | DOCX → PDF preserving Word layout. The client wants Word **and** PDF of the *same* document; HTML→PDF won't reproduce a legal contract's formatting |
| Puppeteer | Invoices/reports where HTML is fine |
| exceljs | Report exports, streaming writer |
| pdf-lib | Merging contract + annexures + COO |
| **E-signature** ⚠️ | DocuSign / Adobe Sign / Zoho Sign. Third-party contract + cost. Conflicts with air-gapped on-prem — ask early |

### 7.8 Storage

**MinIO** (S3-compatible, self-hosted, in Compose) over the docx's "on-premise file server" — presigned URLs, versioning, lifecycle, checksums, and a migration path to S3. A raw filesystem gives none of that and becomes a backup problem. `@aws-sdk/client-s3` works against both. Streaming uploads via busboy — never buffer a 200MB scan.

### 7.9 Observability

Pino + pino-http (tagged `tenant_id`, `company_id`, `request_id`, `user_id`) · AsyncLocalStorage (Node built-in, not cls-hooked) · OpenTelemetry (instrument now — impossible to retrofit under pressure) · Prometheus + Grafana · Loki · Sentry (self-hosted) · Uptime Kuma.

### 7.10 API contract

`@asteasolutions/zod-to-openapi` → OpenAPI 3.1 · Scalar for docs · `openapi-typescript` generates the frontend client.

### 7.11 Testing

Vitest · Supertest · **Testcontainers** (real Postgres + Redis — do **not** mock the DB for an ERP; mocked repos hide exactly the constraint/locking/precision bugs that matter) · faker · Playwright · k6.

**Must-have suites:**
- **Tenant isolation** — concurrent requests across schemas, prove no `search_path` leak
- **Costing & allocation** — property-based: allocations always sum to lot quantity, costs always reconcile
- **Number series** — 100 parallel inserts, zero gaps, zero duplicates
- **Permission engine**, including field-level, including exports
- **Money** — round-trip + rounding boundaries

### 7.12 Deferred

Meilisearch/OpenSearch · Kubernetes · Kafka/NATS · Metabase/Superset · read replica · Debezium/CDC.

---

## 8. The engines

Modules are what your docs describe. These are what modules *depend on* — all implied by the Excel, all absent from the source docs. Unplanned, they get improvised under deadline.

| Engine | What | Trap |
|---|---|---|
| **Numbering** | `PO-{BRANCH}-{FY}-{0000}`, per legal entity + fiscal year, **gapless** | **Never `SEQUENCE`** — it leaks numbers on rollback. Use `number_series` + `SELECT FOR UPDATE`, in the same transaction as the insert. Sequential-invoice rules are a legal requirement in most jurisdictions |
| **Workflow** | Draft → Approved → Posted, per-transition permission, optional OTP, approval trail | **Posted is immutable.** Corrections are reversals + re-entry, never edits. One engine — not `if (status === 'draft')` in 12 services |
| **Tax** ⚠️ | Regime per legal entity, place-of-supply, rate resolution, e-invoicing hooks | New in v2. Not a rate column |
| **Contract assembly** | Clause master (category, version, effective dates, `is_default`, `is_mandatory`, `editable`, country, governing law) · templates · **conditional rule engine** (Incoterm=CIF → insurance clause mandatory — use `json-rules-engine`, don't invent a DSL) · drag-drop order · placeholder substitution · preview · Word+PDF · approval · e-signature | **8–12 weeks alone.** Not "a module like inventory" |
| **LME / pricing** | `Final Rate = LME × (1 + Premium%)`, fixing dates, hedge positions, realized vs unrealized P&L | Prices → immutable `market_prices` (price, exchange, effective date, entered_by, source). A wrong manual LME price silently poisons profit on every deal that day — same audit trail as money |
| **Costing & allocation** | Lot → reserved customer + % → sales allocation (many lots per contract, FR-103) → available/reserved qty → landed cost → gross profit | **Row-level locking** or you oversell. Costing method = specific-lot (my read of the Excel — confirm). Concurrency is the whole difficulty |
| **FX** | Rate table with effective dates, historical lookup, unrealized FX gain/loss | Rate is **captured on the transaction**, never re-derived later |
| **Audit** | Who/what/when/before/after/request_id/IP, JSONB diff | Written in the repository layer **inside** the business transaction, DB trigger as backstop. Immutable — revoke UPDATE/DELETE at the DB role. Partition monthly |
| **Field engine** | Tiers 2+3, AJV compiler | §4 |
| **Field RBAC** | Two boundaries only | §6 |
| **Notification** | Email/SMS/in-app, template-driven, retry via BullMQ | Triggered off the event bus, never inline from a service |
| **Storage** | MinIO + ClamAV + checksums | |
| **Provisioning** | Excel #5: *"one button... create all basic fields"* → create schema → migrate → seed permissions, roles, menus, field definitions, masters, clause library → admin invite | Idempotent, re-runnable, versioned |
| **Vertical registry** | `item_types` → fields/modules/rules per vertical | D-004 |
| **Reporting** | Dashboard KPIs, profit analysis, sales-vs-purchase | Materialized views refreshed by BullMQ. **Never** aggregate against OLTP under load |

---

## 9. Timeline

Two engineers. Metals vertical. Multi-tenant, multi-company, multi-country.

| Phase | Contents | Weeks |
|---|---|---|
| **0** | Decisions, client answers, TeamBook/R# demo, **docgen spike** (one template → one clause → one PDF), Tier-3 whitelist signed | 2 |
| **1** | Monorepo, TS strict, config, Postgres+Redis, **tenant plumbing + `getDb(ctx)`**, **migration fan-out**, Pino + request context, AppError, Docker Compose, CI, Testcontainers | 4–5 |
| **2** | Auth (JWT + refresh + rotation), **invite flow**, users, roles, permissions, RBAC middleware, **field-level rights**, OTP (email+SMS), login history, **break-glass** | 6–8 |
| **3** | Module registry, menu engine, **numbering**, **audit**, event bus, storage (MinIO+ClamAV), notifications | 7–9 |
| **4** | Field engine: Tier-2 overrides, Tier-3 custom, AJV compiler. Proven end-to-end on one entity | 4–5 |
| **5** | ~16 masters via one generic pattern, companies/branches, **FX**, **tax engine v1**, **provisioning** | 6–8 |
| **6** | **Purchase**: supplier, header/shipment/items/pricing/costs/allocation/attachments, LME + hedging, approvals. First module *through* the registry — proves the architecture | 9–12 |
| **7** | **Sales & inventory**: customer, sales, **lot allocation**, **costing**, delivery, invoice, payments, stock ledger | 12–16 |
| **8** | **Contracts**: clause library, templates, rule engine, assembly, DOCX+PDF, revisions, approval, e-signature | 10–14 |
| **9** | Reporting, materialized views, exports, load test, security review, backup/restore drill, runbooks | 6–8 |

**Full Excel scope, metals only: ~19–24 months.**
Multi-country e-invoicing, if any entity is in scope: **+3–5 months.**
Additional verticals: **unestimable** — you cannot cost what isn't specified.

### If that date doesn't survive contact with the client

The lever is **scope, not speed**. Two engineers is already thin; adding a third mid-project costs velocity before it adds any (Brooks' law is real on a domain this deep).

| Cut | Saves | Costs you |
|---|---|---|
| Tier-3 → Tier-2 only | ~4 wks | Client can rename/hide/reorder, can't create fields. **Cheapest cut. Take it first.** |
| Contracts → templates only, no rule engine, no e-sign | ~7 wks | Manual clause selection. Word+PDF still work |
| Defer vertical registry (keep the spine, skip plugins) | ~3 wks | Metals hardcoded. Retrofit is moderate if D-004's discipline holds |
| Defer reporting to phase 2 | ~5 wks | Exports only, no dashboards |
| Single country at go-live | ~4 wks | One legal entity live, others phase 2. Tax engine still architected |

All five: **~12–14 months** for a genuinely usable metals trading ERP. That's the number I'd defend.

**Do not parallelize phases 6 and 7.** Sales depends on purchase lots existing; running them together means building allocation against a moving target.

---

## 10. Operations

| Env | Purpose |
|---|---|
| local | Compose: postgres, redis, minio, mailhog, libreoffice, clamav |
| ci | Ephemeral Testcontainers |
| staging | Production topology, anonymized data |
| uat | Client acceptance |
| production | On-prem — **pending data residency (§3.3)** |

**Backups:** pgBackRest. Full weekly, incremental daily, WAL archiving for PITR, **monthly automated restore verification**. An untested backup is not a backup — and it's the first thing an enterprise IT audit checks.

**Deploy:** migrations run as a **separate step before the app starts**, never on boot — otherwise N instances race to migrate N schemas.

**Runbooks before go-live:** restore from backup · restore a single tenant · rotate secrets · replay a failed job · reverse a posted document · onboard a tenant · break-glass procedure · investigate "profit looks wrong".

**Compliance — build the cheap 80% now.** Nobody signals compliance at kickoff; it arrives as a vendor security questionnaire two months before go-live. Encryption, MFA, and policies are retrofittable. **History you didn't record is gone.** If an auditor asks for 12 months of access logs in month 20 and you started at month 18, the answer is "come back next year."

Do now: immutable append-only audit logs (revoke UPDATE/DELETE at the DB role) · before+after+request_id+IP · **auth events too** (logins, failures, permission changes, break-glass) · retention policy per table · encryption at rest + TLS · MFA available on every account · ADRs in-repo.
Defer: formal policies, evidence collection, pen tests, vendor management.

---

## 11. Open items

### Assumption register — start `docs/assumptions.md` today

| ID | Assumption | Impact if wrong | Needed by | Status |
|---|---|---|---|---|
| **A-001** | Real estate = trading units, not leasing | +4–6 months, separate recurring-revenue module | Phase 7 (~M12) | OPEN |
| **A-002** | **Metals ships first; other verticals are architecture-ready, not delivered** | If all four were promised on one date, the plan is void | **Phase 0 — NOW** | OPEN |
| **A-003** | Costing = specific-lot | Rework of the costing engine | Phase 6 (~M8) | OPEN |
| **A-004** | No e-invoicing mandate in scope at go-live | +2–3 months per jurisdiction | Phase 5 (~M6) | OPEN |
| **A-005** | Data may be hosted centrally on-prem | Could invalidate D-001 entirely | **Phase 0** | OPEN |
| **A-006** | Field-hiding is UI convenience, not a security control | Security review finding | Phase 2 (~M3) | OPEN |
| **A-007** | Contract e-signature via a cloud provider is permitted | Feature drops or goes manual | Phase 8 (~M14) | OPEN |

**A-002 and A-005 are Phase 0 blockers.** The rest can sit open.

### Risks

| Risk | Mitigation |
|---|---|
| Scope creep via "dynamic" | Signed Tier-3 whitelist. Additions are change requests |
| Contract module underestimated | Phase 0 spike — smallest end-to-end slice before committing |
| Money precision found in UAT | decimal.js + numeric from commit #1. Retrofitting precision is a data migration, not a bugfix |
| `search_path` leak across tenants | One `getDb(ctx)`. Concurrency isolation test in CI. Lint-ban raw `SET search_path` |
| Cross-tenant query kills the split | Code review rule + lint. One JOIN is permanent |
| Four verticals, one spec | A-002. Architecture-ready ≠ delivered |
| 2 engineers, 19–24 months | Scope levers in §9. Adding people late makes it slower |
| Bus factor of 1 | ADRs from day one. Pair on the costing and contract engines |

---

## Appendix — folder structure

```
apps/
├── api/src/
│   ├── config/              # env, logger, redis, db
│   ├── database/
│   │   ├── platform/        # control-plane schema + migrations
│   │   ├── tenant/          # per-tenant migrations
│   │   ├── get-db.ts        # ← THE tenant boundary. search_path lives here, nowhere else
│   │   └── migration-runner.ts   # fan-out across schemas
│   ├── common/
│   │   ├── middleware/      # auth, scope-resolver, rbac, field-rbac, error, rate-limit
│   │   ├── errors/ events/ validators/ utils/ types/
│   │   ├── money/           # Money value object, decimal wrappers
│   │   └── context/         # AsyncLocalStorage
│   ├── core/
│   │   ├── module-registry/ vertical-registry/
│   │   ├── rbac/ field-rbac/ menu-engine/ field-engine/
│   │   ├── numbering/ workflow/ audit/ tax-engine/ fx/
│   │   ├── pricing/         # PriceSource port + manual adapter
│   │   ├── docgen/ storage/ notification/ provisioning/
│   ├── modules/
│   │   ├── auth/ users/ roles/      # controller, service, repository,
│   │   ├── masters/                 #   routes, validator, events, manifest
│   │   ├── trading/                 # ← ONE spine: purchase, sales, allocation, costing, invoice
│   │   ├── verticals/
│   │   │   ├── metals/              # LME + hedging
│   │   │   ├── electronics/ toys/ realestate/     # later
│   │   ├── inventory/ contracts/ reports/
│   └── app.ts
├── worker/src/
│   ├── queues/ workers/     # docgen, reports, notifications, lme-sync, recon
│   └── worker.ts            # ← separate entrypoint, same modules
└── web/                     # React + TS + Vite + MUI

packages/
├── contracts/               # shared Zod schemas + inferred types (api ↔ web)
└── config/                  # shared eslint/ts/prettier

docker/  docs/adr/  docs/runbooks/  docs/assumptions.md
```
