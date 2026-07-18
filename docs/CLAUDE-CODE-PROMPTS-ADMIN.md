# Claude Code — Platform Admin App (`apps/admin`)

A **separate application** for Knackroot staff to onboard and monitor tenants. Not part of `apps/web`. Different auth, different domain, different security posture.

**Scope (deliberately tight):** tenant provisioning + health monitoring. Nothing else.
**Deploy target:** `admin.yourerp.com`, network-restricted (VPN / IP allowlist) in production.

---

## Why this is a separate app — read before building

The platform admin app is the one surface that legitimately crosses tenant boundaries. That makes it the highest-risk code in the system. Three rules define it:

1. **Separate identity.** Authenticates against `platform.platform_admins`, never `tenant_x.users`. A platform token and a tenant token are different audiences — each API must reject the other's token. This is tested, not assumed.
2. **Orchestrates tenants, never reads their data.** The admin app calls provisioning, reads `platform.tenants` status, checks health. It does **not** open a tenant schema to browse purchases, users, or financials. If a Knackroot operator needs to see inside a tenant, that goes through **break-glass** (audited, tenant-notified) — which is explicitly out of this 16-week scope. The admin app has no "view tenant data" button. Building one is a contract violation waiting to happen.
3. **No tenant `search_path`, ever.** This app touches the `platform` schema only. `get-db.ts`'s tenant machinery is not imported here.

If a prompt result starts querying a tenant schema for business data, stop it — that's the boundary breaking.

---

## Where it lives

```
apps/
├── api/          existing — tenant API. Gains a /platform/* route group (ADM-1).
├── web/          existing — tenant app
├── worker/       existing
└── admin/        NEW — this plan. React + Vite + AntD, same stack as web.
packages/
└── contracts/    gains platform-admin schemas
```

The admin app can share `packages/contracts`, the AntD theme, and the `core/api` client pattern from `apps/web`. It does **not** share auth state, routing, or the tenant `core/` engines.

---

## Ordering

The backend half (ADM-1, ADM-2) depends on BE-10 (provisioning engine) being done. The frontend half depends on ADM-1/2 and reuses `apps/web`'s FE-1 patterns.

Earliest start: **after BE-10**. Realistically a week-15/16 task for the demo, or immediately post-prototype. It does not block anything on the critical path — provisioning via Postman covers the demo if you run out of time.

```
BE-10 done ──► ADM-1 (platform auth) ──► ADM-2 (tenant admin API)
                                              │
FE-1 patterns exist ──────────────────────────► ADM-3 (admin scaffold + auth)
                                              ──► ADM-4 (tenant provisioning UI)
                                              ──► ADM-5 (health dashboard)
```

---

## ADM-1 — Platform authentication (backend)

```
Read the tenancy and identity sections of docs/Hyperion-ERP-Backend-Plan-v2.md. This builds auth for PLATFORM admins — completely separate from tenant user auth (BE-5).

1. platform.platform_admins already exists (BE-2): id, email, password_hash, name, status, created_at. If it's missing any of that, add it.

2. A SEPARATE auth path under /api/v1/platform/auth/*:
   - POST /login, /refresh, /logout, GET /me
   - jose JWT, signed with its OWN secret — PLATFORM_JWT_SECRET, never JWT_ACCESS_SECRET/JWT_REFRESH_SECRET. This is the boundary, not an `aud` claim on a shared secret: a platform token literally does not verify against the tenant secret, and vice versa, so cross-audience use fails at signature verification, before any claim is even inspected. (Originally speced as a shared secret + `aud: "platform"`/`aud: "tenant"` claim — separate secrets per docs/env.ts give the same guarantee with one less thing to get wrong, since there's no claim-check code path that could be skipped by accident. Neither token carries an `aud` claim at all; core/platform-auth/jwt.ts and core/auth/jwt.ts are two independent signer/verifier pairs.)
   - argon2id, same as tenant auth
   - Separate refresh-token table: platform_refresh_tokens (do NOT reuse tenant refresh_tokens)

3. Middleware: platformAdminAuthMiddleware — verifies the token against PLATFORM_JWT_SECRET. A tenant token presented here fails verification outright → 401, no exceptions.

4. Correspondingly, the tenant scope-resolver middleware (BE-5) verifies only against JWT_ACCESS_SECRET/JWT_REFRESH_SECRET — a platform-signed token fails verification there too, for the same reason (wrong secret, not a missing claim check).

5. Platform admins have NO tenant scope, NO company_id, NO search_path. Their requests never touch a tenant schema.

6. Rate limit + lockout on platform login, same as tenant. Log every platform auth event to a platform_login_history table.

7. Seed one bootstrap platform admin via an idempotent script (env-driven credentials, never hardcoded).

THE TESTS THAT MATTER:
- A platform token is REJECTED by the tenant API (wrong secret → 401)
- A tenant token is REJECTED by the platform API (wrong secret → 401)
- Platform login happy path; wrong password; unknown email (identical response + timing)
- A platform request never sets search_path (assert no tenant schema is touched)

Acceptance:
- The two cross-audience rejection tests pass — this is the security boundary
- Bootstrap admin can log in; credentials come from env, not code
```

**The two cross-audience rejection tests are the point of this prompt.** If a platform token can hit a tenant endpoint, the separation is cosmetic. The mechanism is separate secrets rather than a shared secret plus an audience claim — verify that divergence stays deliberate: if the two `jwt.ts` files (`core/auth/jwt.ts`, `core/platform-auth/jwt.ts`) ever end up sharing a secret constant, the whole boundary silently becomes cosmetic again.

---

## ADM-2 — Tenant administration API (backend)

```
Platform-admin-only endpoints for managing tenants. All under /api/v1/platform/*, all behind authenticatePlatform. Wraps the BE-10 provisioning engine.

1. GET /platform/tenants — list all tenants from platform.tenants: name, slug, schema_name, status, created_at, module count, user count (the user count is an aggregate FROM platform metadata or a lightweight per-tenant COUNT — NOT a browse of tenant business data).

2. GET /platform/tenants/:id — one tenant's metadata + provisioning status + enabled modules. Metadata only. No business data.

3. POST /platform/tenants — provision a new tenant. Body: { name, slug, adminEmail, adminName, modules[] }. Calls the BE-10 provisionTenant engine. Returns the created tenant + confirmation the admin invite was sent.
   - Idempotent guard: a duplicate slug against an *already-active* tenant re-runs the naturally idempotent seed steps (permission catalogue, field-defs, number series, reference masters, module enablement) and returns 200 with `created: false` — not a 409. (Originally speced as a 409; the actual engine treats "provision this slug again" as safe-to-repeat rather than an error, since the only thing that matters operationally is "does this tenant end up correctly seeded," and re-running is strictly less surprising than making an operator diagnose a 409 on a slug they know is right.) A duplicate slug against a tenant stuck in a non-active state (still `provisioning`, or `suspended`) IS a 409 — that's a real conflict, not a safe re-run.
   - On failure mid-provision (brand-new tenant only — a re-run against an existing active tenant never triggers cleanup), the BE-10 engine already cleans up (drops schema, clears the platform row). Surface which step failed.

4. POST /platform/tenants/:id/suspend and /reactivate — flip tenant status. Suspended tenants' users cannot log in (the tenant auth path checks tenant status).

5. GET /platform/tenants/:id/modules + PATCH to enable/disable modules per tenant (writes platform.tenant_modules).

6. NO endpoint that returns tenant business data. Not purchases, not users' details beyond a count, not financials. If you're tempted to add "GET /platform/tenants/:id/users" returning a user list — don't. That's break-glass territory, out of scope.

Tests: provision creates schema + seeds + invites (assert via the BE-10 engine's own tests + an integration check); duplicate slug → 409; suspend blocks that tenant's user login; module toggle reflects in tenant_modules; every endpoint 401s without a platform token.

Acceptance:
- A single POST provisions a working tenant an admin can log into
- No endpoint anywhere returns tenant business records
```

---

## ADM-3 — Admin app scaffold + auth (frontend)

```
Read the FE-1 and FE-2 prompts in CLAUDE-CODE-PROMPTS-FRONTEND.md — reuse those patterns. This is a NEW app: apps/admin.

1. apps/admin: Vite + React 19 + TS strict + AntD v5, same theme tokens as apps/web (import from a shared location or copy the token file). pnpm workspace member.

2. TanStack Query + a Zustand store for the PLATFORM token — a SEPARATE store from apps/web's. These apps never share auth state; they're different origins in production anyway.

3. core/api client: same fetch-wrapper pattern as web, but points at /api/v1/platform/* and carries the platform token. 401 → refresh → re-auth, single-flight guarded.

4. Login screen — platform admin email + password. NO tenant-code field (platform admins aren't tenant-scoped). Plain, utilitarian; this is an internal ops tool.

5. Route guard: unauthenticated → login. No invite/accept flow here — platform admins are seeded/managed out-of-band, not self-invited, in this scope.

6. Shell: minimal AntD layout. Sidebar with two items only — Tenants, Health. No company/branch switcher (meaningless here). Header shows the logged-in operator + logout.

7. A clear visual marker that this is the PLATFORM console, not a tenant app — a distinct header color or a "PLATFORM ADMIN" badge. Operators must never confuse this with a tenant login.

8. MSW handlers from the platform-admin contracts for building against mocks.

Tests: login against MSW; guard redirects; token stored in the admin store (not web's); logout clears it.

Acceptance:
- apps/admin boots independently, themed, visually distinct from apps/web
- Builds and runs with zero backend
```

---

## ADM-4 — Tenant provisioning UI (frontend)

```
The core of the admin app: onboard and manage tenants.

1. Tenant list — an AntD Table over GET /platform/tenants: name, slug, status (tag: active/provisioning/suspended), created date, module count, user count. Sortable, filterable by status. This is a plain table — apps/web's SchemaTable is tenant-scoped and does NOT belong here; use AntD Table directly.

2. "Onboard tenant" — a form (React Hook Form + AntD, or AntD Form): name, slug (with a live availability check against the list / a HEAD endpoint), admin email, admin name, module multi-select from the module catalogue. Submit → POST /platform/tenants.
   - Show provisioning progress: the call may take a few seconds (schema create + migrate + seed). Disable the button, show a spinner, surface success ("Tenant created, admin invited to {email}") or the specific failed step.
   - Duplicate slug → surface the 409 clearly.

3. Tenant detail drawer/page: metadata, provisioning status, enabled modules with toggle switches (PATCH), suspend/reactivate buttons with a confirm dialog.

4. NO "view tenant data" anywhere. The detail view shows platform metadata and controls only. If a stakeholder asks "can I see their purchases from here?" the answer is architectural: no — that requires break-glass, which is audited and out of scope. Don't build a door you've promised the client stays locked.

5. Empty state: "No tenants yet — onboard your first" for the fresh-install demo moment.

Tests: list renders from mocked data; onboard form validates; slug-availability check works; provisioning success + failure states both render; suspend confirm dialog; module toggle persists.

Acceptance:
- An operator can onboard a tenant end-to-end in the browser and watch it appear active
- Nowhere in this app can an operator read a tenant's business records
```

**This is the screen that replaces "provision via Postman" for the demo.** Onboarding Hyperion live in a console is a far stronger story than a curl command.

---

## ADM-5 — Health dashboard (frontend)

```
Basic operational visibility. Keep it genuinely basic — this is the "+ health" half of the scope, not an observability platform.

1. A health page reading a GET /platform/health endpoint (add it in the API if absent). It reports:
   - API process: up, version, uptime
   - Postgres: reachable, connection pool in-use/idle
   - Redis: reachable
   - Worker: last heartbeat (the worker writes a timestamp to Redis periodically; the endpoint reads it)
   - Per-tenant: schema present, last migration version, active/suspended
2. Render as AntD cards + a simple table for per-tenant status. Green/amber/red tags. Auto-refresh every 15-30s via TanStack Query refetchInterval.
3. A "migrations" panel: which tenant schemas are on which migration version, so a failed fan-out (BE-4) is visible at a glance. This is the single most useful operational view you have — a tenant stuck a version behind is exactly the 2am problem the fan-out runner warns about.
4. NO business metrics (revenue, purchase counts, etc.) — that's reading tenant data. Infrastructure health only.

Tests: health cards render from mocked status; per-tenant migration table flags a lagging schema; auto-refresh fires.

Acceptance:
- One glance shows whether the platform and every tenant schema are healthy
- No tenant business data appears
```

---

## Where it will fight you

| Prompt | Likely friction |
|---|---|
| ADM-1 | It may reuse the tenant auth middleware or the tenant JWT secret "to save code." **Refuse** — the separate-secret separation is the entire security boundary |
| ADM-2 | It will offer a "list tenant users" or "view tenant data" endpoint as a convenience. **Refuse** — that's break-glass, out of scope, and a contract risk. It may also want to 409 a duplicate slug unconditionally — only do that for a non-active tenant; an active tenant re-provisions idempotently |
| ADM-3 | It may try to share apps/web's auth store. Separate stores, separate apps |
| ADM-4 | It will reach for apps/web's SchemaTable/SchemaForm. Those are tenant-scoped. Use plain AntD here |
| ADM-5 | It will want to add business metrics. Infrastructure health only |

The through-line of every one of these: **the admin app orchestrates tenants, it never reads inside them.** When a result crosses that line, it's wrong regardless of how useful it looks.

---

## The demo add

With ADM-4 done, your onboarding demo becomes:

> Operator logs into the platform console → clicks "Onboard tenant" → fills in Hyperion + admin email → watches it provision and go active → the Hyperion admin receives the invite → logs into the tenant app → sets their password → creates a company, invites a trader. Two apps, two audiences, one clean handoff — and at no point can the platform operator see Hyperion's data.

That last clause is the one the client's security team will care about. Being able to *say it and show it* is worth more than any feature.
