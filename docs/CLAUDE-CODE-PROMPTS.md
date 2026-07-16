# Claude Code — Kickoff Prompts

Copy-paste these **in order**. Each is self-contained and ends with acceptance criteria.

## Before you start

```bash
mkdir hyperion-erp && cd hyperion-erp && git init
mkdir -p docs/spec docs/adr
# Put CLAUDE.md in the repo ROOT — Claude Code auto-loads it every session.
cp ~/Downloads/CLAUDE.md .
cp ~/Downloads/PROTOTYPE-PLAN-90-DAYS.md docs/
cp ~/Downloads/Hyperion-ERP-Backend-Plan-v2.md docs/
# Export the Purchase V2 sheet to docs/spec/Purchase-V2.md — Claude needs the field spec as text
claude
```

**How to use these:**
- One prompt per session where possible. Long sessions drift.
- After each: review the diff, run the tests, **commit**. Don't stack three unreviewed prompts.
- If it starts inventing business rules, stop it and point at `docs/spec/Purchase-V2.md`.
- Prompts 3 and 4 are the ones that matter. Don't rush them.

---

## Prompt 1 — Scaffold

```
Read CLAUDE.md first.

Set up the monorepo skeleton. Nothing else — no auth, no database, no business logic.

1. pnpm workspaces + Turborepo. Packages: apps/api, apps/worker, packages/contracts, packages/config.
2. packages/config: shared tsconfig (strict: true, noUncheckedIndexedAccess: true), eslint 9 flat config, prettier.
3. apps/api: Express 5 skeleton, tsx for dev, tsup for build.
   - src/config/env.ts — Zod-validated environment config. Fail fast and loudly at boot on a missing var.
   - src/config/logger.ts — Pino, JSON in prod, pretty in dev.
   - src/common/context/ — AsyncLocalStorage request context carrying requestId. Node built-in, not cls-hooked.
   - src/common/errors/ — AppError base + NotFoundError, ValidationError, ForbiddenError, ConflictError. Each with an httpStatus and a stable machine-readable code.
   - src/common/middleware/error-handler.ts — one handler, consistent response shape, logs with requestId.
   - GET /health returning { status, version, uptime }.
4. apps/worker: BullMQ skeleton with its own entrypoint. It must NOT import apps/api's server.
5. docker/docker-compose.yml: postgres:17, redis:7, minio, mailhog. Named volumes, healthchecks.
6. .github/workflows/ci.yml: install, lint, typecheck, test, build.
7. .env.example with every var. .gitignore covering .env.
8. Vitest configured in apps/api with one passing test for the health endpoint.

IMPORTANT: verify Express 5 compatibility for every middleware you add before adding it — some v4-era packages still assume v4 internals. If helmet/cors/express-rate-limit have v5 caveats, tell me rather than working around it silently.

Acceptance:
- `docker compose up -d` → all four services healthy
- `pnpm dev` → GET /health returns 200
- `pnpm lint && pnpm typecheck && pnpm test` all pass
- Boot with a missing env var → clear, immediate failure
```

**Commit before continuing.**

---

## Prompt 2 — Database foundation

```
Set up Drizzle and the platform (control-plane) schema. No tenant schemas yet.

1. Drizzle + drizzle-kit in apps/api. Verify the current drizzle-orm API against its docs before writing config — do not rely on remembered syntax.
2. src/database/platform/schema.ts:
   - tenants (id uuid pk, name, slug unique, schema_name unique, status enum[provisioning|active|suspended], created_at, updated_at)
   - tenant_modules (tenant_id fk, module_key, enabled, unique on (tenant_id, module_key))
   - platform_admins (id, email unique, password_hash, name, status, created_at) — SEPARATE from tenant users, different auth path entirely
3. src/database/platform/migrations/ — generated via drizzle-kit.
4. src/config/db.ts — pg Pool, sensible pool sizing, graceful shutdown on SIGTERM.
5. Testcontainers harness: spin up real Postgres per suite, run migrations, truncate between tests. Add a small helper so every future suite is one line.
6. Test: migrations apply cleanly to an empty DB; tenants table accepts a row.

Do NOT create tenant schemas or business tables yet — that's the next prompt.

Acceptance:
- `pnpm db:generate` and `pnpm db:migrate` work
- Testcontainers suite passes against real Postgres
- No `any` anywhere
```

---

## Prompt 3 — Tenant isolation ⚠️ THE CRITICAL ONE

```
Read rules 2, 3, 4 in CLAUDE.md before starting. This is the highest-consequence code in the project — a mistake here is a cross-tenant data breach.

Build the tenant boundary.

1. src/database/tenant/schema.ts — a minimal tenant schema to prove the mechanism:
   - companies (id, name, country_code, currency_code, fiscal_year_start_month, timezone, status, + audit columns)
   - branches (id, company_id fk, name, code, status, + audit columns)
   Define tables UNQUALIFIED (no pgSchema binding) — the schema is selected per-connection at runtime.

2. src/database/get-db.ts — THE tenant boundary. The ONLY place in the codebase that touches search_path.
   - export async function withTenantDb<T>(ctx: RequestContext, fn: (tx) => Promise<T>): Promise<T>
   - Opens a transaction, issues `SET LOCAL search_path TO <tenant_schema>, public`, runs fn, commits.
   - SET LOCAL, never SET. It must be transaction-scoped or a pooled connection leaks the schema into the next request.
   - Identifier must be escaped/validated — never string-interpolate a raw schema name.
   - Today it uses one shared pool. Design the signature so swapping to a per-tenant pool later changes nothing outside this file.

3. src/common/middleware/scope-resolver.ts — resolves tenant → company → branch from the JWT ONLY. Never from body, query, or header. Stores in AsyncLocalStorage. For now accept a stub token; real auth is the next prompt.

4. src/core/tenant/provisioner.ts — createTenantSchema(slug): creates `tenant_<slug>`, runs tenant migrations against it, inserts the tenants row.

5. THE TEST THAT MATTERS — src/database/__tests__/tenant-isolation.test.ts:
   - Provision tenant_alpha and tenant_beta
   - Insert distinct companies into each
   - Fire 100 CONCURRENT interleaved reads/writes across both tenants through withTenantDb
   - Assert: alpha NEVER sees beta's rows, and vice versa, not once
   - Assert: after a withTenantDb call, a raw pool connection has NOT retained the search_path
   - Add a test proving a thrown error inside withTenantDb rolls back AND doesn't leak search_path

6. ESLint rule (or a CI grep) failing the build on `search_path` appearing anywhere outside get-db.ts.

If Drizzle's typing fights the runtime schema selection, do NOT weaken types with `any`. Drop to raw parameterized SQL inside the repository layer instead and tell me. The boundary matters more than the ORM.

Acceptance:
- The concurrency isolation test passes, reliably, 10 runs in a row
- `grep -rn "search_path" src/ --exclude=get-db.ts` returns nothing
- No `any`
```

**Do not proceed until that test is green ten times running.** Everything else sits on top of it.

---

## Prompt 4 — Migration fan-out

```
Build the migration runner that applies tenant migrations across every tenant schema.

1. src/database/migration-runner.ts:
   - Discovers pending migrations from the tenant migrations folder
   - Lists active tenants from platform.tenants
   - Applies each pending migration to each tenant schema, transactionally per schema
   - Tracks applied version PER SCHEMA (a schema_migrations table inside each tenant schema)
   - On partial failure: that schema rolls back, others continue, and it exits non-zero with a clear report of which schemas succeeded/failed
   - Idempotent and re-runnable — a second run is a no-op
   - Structured progress logging

2. CLI: `pnpm migrate:tenants` (all), `pnpm migrate:tenants --tenant=alpha` (one).

3. Tests:
   - Applies to 3 schemas cleanly
   - Migration failing on schema #2: #1 committed, #2 rolled back, #3 still applied, exit code non-zero, report accurate
   - Re-run after success = no-op
   - Re-run after partial failure = only the failed schema is retried

This runs as a deploy step, never on app boot — N instances must not race to migrate.

Acceptance:
- All tests pass including the partial-failure case
- The failure report names exactly which schemas are in which state
```

---

## Prompt 5 — Auth

```
Build authentication. Read the identity section of docs/Hyperion-ERP-Backend-Plan-v2.md first.

1. Tenant schema additions: users (id, company_id, email, mobile, password_hash nullable, name, status enum[invited|active|suspended], email_verified_at, mobile_verified_at, must_change_password, last_login_at, + audit columns), refresh_tokens, login_history.
   Note: password_hash is NULLABLE. Invited users have no password until they set one themselves.

2. jose for JWT. Access token 15m, refresh 7d with rotation + reuse detection (a reused refresh token revokes the whole family). argon2id for hashing.

3. Claims: { sub, tenant, company_id, branch_id, roles[], jti }. Nothing sensitive.

4. Redis denylist keyed by jti for logout/revocation.

5. Endpoints: POST /api/v1/auth/login, /refresh, /logout, GET /me.

6. Tenant resolution at login: subdomain first, tenant-code field as fallback. Do NOT leak whether an email exists — same response and same timing for unknown user and wrong password.

7. Rate limit login per IP + per email. Lockout after N failures.

8. Log every auth event to login_history: success, failure, reason, IP, user agent.

9. Wire scope-resolver to the real JWT now, replacing the stub.

Tests: happy path; wrong password; unknown email (identical response); refresh rotation; refresh reuse revokes family; expired token; logged-out token rejected; user from tenant A cannot use their token against tenant B.

Acceptance:
- All tests pass, including the cross-tenant token test
- No timing difference between unknown-email and wrong-password
```

---

## Prompt 6 — RBAC

```
Build the permission engine. Read the RBAC sections of CLAUDE.md and the v2 plan.

1. Tenant schema: permissions (id, key, module, entity, action, description), roles (id, company_id, name, is_system), role_permissions, user_roles, field_permissions (id, company_id, role_id, module, entity, field_key, can_view, can_edit).

2. Permission keys are namespaced module.entity.action — e.g. purchase.po.approve, masters.supplier.create.

3. src/core/rbac/:
   - resolve(userId) → { permissions: Set, fieldPermissions: Map, } — ONE query, not per-check
   - Cache in Redis keyed user_id:role_version. Bump role_version on any role/permission/field-permission change to invalidate.

4. src/common/middleware/rbac.ts — requirePermission('purchase.po.approve'). One reusable middleware. NEVER an inline role-string check anywhere else in the codebase.

5. src/common/middleware/field-rbac.ts — two boundaries only:
   - WRITE, before validation: a field the role cannot edit present in the body → 403 with the field name. NOT a silent strip.
   - READ, at serialization: strip non-viewable fields. Must apply to single GETs AND list endpoints — write it as a serializer the response layer calls, so it cannot be forgotten per-route.

6. Seed the permission catalogue from module manifests (registry comes later — a static list is fine for now).

Tests: permission granted/denied; cache invalidation on role change; write-forbidden field → 403; read-forbidden field stripped from both a single GET and a list; a role change takes effect immediately, not after TTL.

Acceptance:
- All tests pass
- `grep -rn "role ===" src/` and `grep -rn "role.name ==" src/` return nothing outside core/rbac
```

---

## Prompt 7 — Invite flow

```
Build user onboarding. Admins NEVER set passwords — see CLAUDE.md and the identity section of the v2 plan for why (non-repudiation for OTP approvals).

1. Tenant schema: invitations (id, company_id, email, token_hash, roles jsonb, invited_by, expires_at, accepted_at, status).

2. Flow:
   - POST /api/v1/users/invite {email, mobile, name, roles[]} — creates a user with status=invited and password_hash=NULL. NO password field is accepted on this endpoint. Reject the request if one is sent.
   - Single-use token, 72h expiry. Store the HASH, send the raw token by email (Mailhog in dev).
   - GET /api/v1/invitations/:token → validate, return email + company name
   - POST /api/v1/invitations/:token/accept {password} → set password, email_verified_at = now, status = active, consume token
   - Resend and revoke endpoints.

3. Password policy: min 12 chars, zxcvbn strength check, block the top-10k common list.

4. Exception path — ops staff with no email: POST /api/v1/users/provision {name, tempPassword, roles[]} sets must_change_password=true, records provisioned_by in the audit trail, and REJECTS the request if any requested role holds an approval permission. Financial approvals require self-set credentials.

5. Login with must_change_password=true returns a token scoped to the password-change endpoint only.

Tests: full invite→accept→login; expired token; reused token; admin cannot send a password on invite; provision path rejects approval-holding roles; must_change_password blocks other endpoints.

Acceptance:
- All tests pass
- No endpoint anywhere accepts an admin-supplied password for another user, except the audited provision path
```

---

## Prompt 8 — Numbering + audit

```
Two engines. Both are load-bearing for financial compliance. Read rules 6 and 7 in CLAUDE.md.

=== NUMBERING ===
1. Tenant schema: number_series (id, company_id, branch_id nullable, doc_type, prefix_pattern, fiscal_year, current_value, padding, unique on (company_id, branch_id, doc_type, fiscal_year)).
2. src/core/numbering/: nextNumber(tx, {companyId, branchId, docType, date}) → string.
   - MUST run inside the caller's transaction — takes tx, never opens its own
   - SELECT ... FOR UPDATE on the series row. NEVER a Postgres SEQUENCE — sequences leak numbers on rollback and these must be gapless.
   - Pattern support: PO-{BRANCH}-{FY}-{0000}
   - Fiscal year derived from the company's fiscal_year_start_month, not the calendar year
3. TEST THAT MATTERS: 100 concurrent transactions calling nextNumber for the same series → 100 unique sequential numbers, zero gaps, zero duplicates. Plus: a transaction that rolls back does NOT consume a number.

=== AUDIT ===
4. Tenant schema: audit_logs (id, company_id, entity, entity_id, action, before jsonb, after jsonb, changed_by, changed_at, request_id, ip, user_agent). Partition by month from day one — this becomes the largest table in the system.
5. src/core/audit/: called from the repository layer, INSIDE the business transaction. Computes a before/after JSONB diff.
6. IMMUTABILITY: revoke UPDATE and DELETE on audit_logs from the application DB role. Add a migration doing this, and a test proving the app role cannot modify an audit row.
7. Audit auth events too — logins, failures, permission changes.

Tests: concurrency test above; rollback consumes no number; audit written in the same transaction (business rollback → no orphan audit row); app role cannot UPDATE or DELETE an audit row; diff correctness.

Acceptance:
- The 100-concurrent numbering test passes 10 runs in a row
- The audit-immutability test passes
```

---

## Prompt 9 — Module registry + menus

```
1. Module manifest type: { key, name, version, routes, permissions[], dependsOn[], migrations }.
2. src/core/module-registry/: loads manifests at boot, resolves dependsOn order, mounts routes ONLY for modules enabled for the current tenant (platform.tenant_modules), exposes the permission catalogue for seeding.
3. Middleware: a request to a disabled module's route → 404 (not 403 — don't leak which modules exist).
4. Tenant schema: menus (id, company_id, key, label, path, icon, parent_id, sort_order, required_permission, module_key, is_visible).
5. src/core/menu-engine/: resolves the tree for the current user filtered by permissions AND enabled modules. Cache in Redis keyed user_id:role_version:menu_version. Invalidate on role, menu, or module change.
6. GET /api/v1/menus → the user's tree.

Tests: disabled module route → 404; menu tree hides items whose required_permission the user lacks; menu hides items from disabled modules; cache invalidates on role change.
```

---

## Prompt 10 — Provisioning (the week-6 checkpoint)

```
One-click tenant + company setup. This is the milestone — read the provisioning engine section of the v2 plan.

src/core/provisioning/:
1. provisionTenant({name, slug, adminEmail, adminName, modules[]}):
   - create schema tenant_<slug>
   - run all tenant migrations against it
   - seed: permission catalogue (from module manifests), default roles (Admin / Manager / Officer / Viewer) with sensible permission sets, default menu tree, Tier-2 field_definitions for seeded modules, number series defaults
   - seed reference masters: countries, currencies, UOM, incoterms
   - create the company + a default branch
   - enable the requested modules in platform.tenant_modules
   - invite the tenant admin (no password — reuse the invite flow)
   - insert platform.tenants with status=active
2. IDEMPOTENT and re-runnable. Versioned, so a re-run applies only what's new.
3. On failure at any step: drop the schema, clean the platform row, return a clear error. Never leave a half-provisioned tenant.
4. POST /api/v1/platform/tenants — platform-admin auth only.
5. provisionCompany() for adding a second legal entity to an existing tenant.

Tests: full provision → schema exists, migrations applied, roles seeded, admin invited; re-run is a no-op; failure mid-way leaves NO orphan schema and no platform row; the provisioned admin can accept their invite and log in.

Acceptance:
- One API call → a new tenant an admin can log into. Zero manual SQL.
- The failure-cleanup test passes.
```

---

## Prompt 11 — Field engine (Tier 2 only)

```
Tier 2 ONLY. No Tier 3, no custom_fields, no JSONB. If a requirement seems to need Tier 3, stop and ask — it's out of the 90-day scope. See the field model in CLAUDE.md.

1. Tenant schema: field_definitions (id, company_id, module, entity, field_key, tier, label, data_type, is_visible, is_mandatory, is_editable, default_value, options_source, validation_json, sort_order, is_system, version, + audit columns).
2. src/core/field-engine/:
   - resolve(module, entity, userId) → the effective field list, merging code-declared defaults with company overrides and the user's field permissions
   - Cache in Redis keyed company_id:module:entity:field_version
3. GET /api/v1/field-definitions/:module/:entity → form schema for the frontend
   PATCH /api/v1/field-definitions/:id → override label / visibility / mandatory / sort_order
4. Guardrails: is_system fields cannot be hidden or made optional. data_type is NEVER overridable. Changing a label must not affect the column name, any query, or any calculation.
5. Emit a field_definition.changed event → invalidate cache.

Prove it with the real requirement from the spec: rename "Other Charges" to "Clearing Charges" via PATCH → GET returns the new label → no deploy, no migration, no code change.

Tests: label override reflected in the resolved schema; is_system field cannot be hidden; data_type override rejected; mandatory override enforced by the validator; cache invalidates; field permissions correctly intersect with definitions.
```

---

## Prompt 12 — Masters

```
Read docs/spec/Purchase-V2.md. Every "Dropdown → Master" there needs a master table.

1. Build ONE generic master-data pattern first: schema factory + repository + service + controller + routes, giving CRUD + activate/deactivate + search + pagination + audit + field-engine integration. Then instantiate it. Do NOT hand-write 15 near-identical modules.

2. Instantiate: countries, cities (fk country), currencies, payment_terms, uom, ports, warehouses, incoterms, items, item_grades, vessels, transport_modes, lme_exchanges, hedge_platforms, supplier_types.

3. items carries an item_type column now (metals | electronics | toys) even though only metals is used — it's the vertical seam. Do not build the vertical registry yet.

4. Seed real reference data: ISO country codes, ISO 4217 currencies, standard Incoterms 2020, common UOM (MT, KG, LB).

5. Every master gets a manifest and mounts through the module registry — this is the first real proof the registry works.

If the generic pattern isn't paying for itself by the third instantiation, STOP and tell me rather than pushing through.

Tests: generic CRUD against 3 different masters; cascading city→country filter; deactivate hides from dropdowns but preserves existing references; pagination; search.
```

---

## Prompt 13 — Storage + Supplier (FR-001…006)

```
=== STORAGE ===
1. src/core/storage/: MinIO via @aws-sdk/client-s3. Streaming upload via busboy — never buffer a whole file in memory. Presigned download URLs. SHA-256 checksum stored. Key pattern: tenant/company/entity/entity_id/uuid-filename.
2. ClamAV scan before the file is accepted. Infected → reject + audit.
3. Tenant schema: attachments (id, company_id, entity, entity_id, field_key, filename, content_type, size, storage_key, checksum, scanned_at, + audit columns).
4. Enforce per-type limits and an allowlist of content types.

=== SUPPLIER MASTER ===
Read the "Sub Tab 1 – Supplier Creation" field spec in docs/spec/Purchase-V2.md. Implement EXACTLY those fields — don't add, don't omit.

FR-001 create · FR-002 auto Supplier Code via the numbering engine · FR-003 edit · FR-004 activate/deactivate · FR-005 no duplicate names (unique WHERE deleted_at IS NULL) · FR-006 available in purchase transactions after creation.

Tables: suppliers, supplier_banks, supplier_contacts. Full audit columns. Mounts through the module registry with a manifest.
"Supplier Type" is a configurable enum from a master, per the spec's Remarks column.

Tests: FR-001 through FR-006 each have a named test; duplicate name rejected; soft-deleted supplier's name can be reused; supplier code gapless under concurrency; upload scanned and stored; infected file rejected.
```

---

## Prompt 14 — Purchase (FR-101…110, FR-201…204)

```
The big one. Read docs/spec/Purchase-V2.md sections A–H and Sub Tab 3 in full. Implement EXACTLY the fields specified.

Split this across sessions — do not attempt it in one pass. Suggested order: (a) header+shipment, (b) items+pricing, (c) allocation+costs+attachments, (d) LME+hedging, (e) workflow+stock.

TABLES
- purchases (header: purchase_number auto, purchase_date, status, branch_id, buyer_id, supplier_id, supplier_invoice_no, supplier_reference_no)
- purchase_shipments (shipment_year, lot_number, container_number, bl_no, loading_date, through, vessel, voyage_no, port_of_loading, port_of_discharge, warehouse, incoterm)
- purchase_items (item_id, grade_id, quantity, uom_id)
- purchase_pricing (purchase_rate_usd, purchase_amount_usd, exchange_rate, purchase_amount_aed)
- purchase_allocations (reserved_customer_id, allocation_pct)
- purchase_additional_costs (freight, insurance, customs, other_charges_1..3)  ← Tier-2 renameable, per the spec
- lme_records (purchase_ref, lme_exchange_id, lme_price_usd, fixing_date, agreed_premium_pct, final_purchase_rate_usd)
- hedges (platform_id, contract_number, position, quantity, rate, hedge_date, status)
- market_prices (immutable: exchange, metal, price, effective_date, source, entered_by)
- stock_movements (append-only ledger — NOT a mutable quantity column)

MONEY — rule 1 in CLAUDE.md
All amounts numeric(18,2), rates/quantities numeric(18,6). decimal.js for every calculation. Never a JS float, not even intermediate.
- FR-105: purchase_amount_usd = quantity × purchase_rate_usd
- FR-106: purchase_amount_aed = purchase_amount_usd × exchange_rate
- FR-203: final_purchase_rate_usd = lme_price × (1 + agreed_premium_pct/100)
Rounding is explicit and documented in an ADR. Ask me before choosing a rounding mode.

LME (FR-201/202) — prices go into market_prices first, NEVER straight onto a transaction. Put a PriceSource interface in front with a ManualEntryAdapter, so a live feed drops in later without touching purchase code.

WORKFLOW (FR-107/108) — Draft → Approved → Posted via the workflow engine. Each transition needs its own permission. Posted is IMMUTABLE (rule 8) — corrections are reversal + re-entry. Approved emits purchase.approved on the event bus; the inventory subscriber writes stock_movements. Modules must NOT call each other directly.

OUT OF SCOPE — do not attempt: FR-105 Profit/Loss, FR-206, FR-109 (all need Sales).

Tests:
- One named test per FR ID
- THE MONEY TEST: 500 MT × $8,432.75 × (1 + 2.35%) × 3.6725 AED — assert exact to the fils against a hand calculation I will verify
- Purchase number gapless under 100 concurrent creates
- Posted purchase rejects every edit
- Approve → stock_movements written, in the same transaction
- Two concurrent approvals of one purchase → exactly one succeeds
- Renaming "Other Charges" changes only the label, never the calculation
```

---

## After each prompt

```bash
pnpm lint && pnpm typecheck && pnpm test
git add -A && git commit -m "feat(scope): ..."
```

**Weekly:** re-read `CLAUDE.md` yourself. It drifts — Claude Code will happily follow a stale rule for six weeks. When a decision changes, update CLAUDE.md **first**, code second.

**Ask Claude Code to write an ADR** (`docs/adr/`) whenever it makes a non-obvious call. In month 8 you will not remember why.

---

## Where it will fight you

| Prompt | Likely friction |
|---|---|
| 1 | Express 5 middleware compatibility. **Surface it in week 1, not week 6** |
| 3 | Drizzle typing vs runtime schema selection. Fallback: raw parameterized SQL in the repository. Never weaken types |
| 8 | It will suggest a Postgres SEQUENCE. **Refuse.** Gapless is a legal requirement |
| 11 | It will want to build Tier 3 "while it's in there". Refuse |
| 14 | It will want floats "just for the intermediate calc". Refuse |

Everything on that list is in `CLAUDE.md`. If it drifts, the fix is to point at the rule — not to argue.
