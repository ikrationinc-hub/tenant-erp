# Hyperion ERP — Project Setup & Run Guide

_Updated 2026-07-23 against the state of the repo at that time — re-check `pnpm-workspace.yaml`, `apps/api/package.json`, `apps/web/package.json`, and `apps/admin/package.json` if scripts have moved on since._

## Prerequisites

- Node.js ≥ 22 (see `engines` in root `package.json`)
- pnpm 9.15.4 (`packageManager` field — use `corepack enable` to get the exact version)
- Docker + Docker Compose (Postgres/Redis/MinIO/ClamAV run in containers; Testcontainers also needs Docker for `pnpm test`)

## 1. Install dependencies

```bash
cd hyperion-erp
pnpm install
```

## 2. Environment files

Three `.env` files exist already in this repo (`.env` at root, `apps/web/.env`, `apps/admin/.env`) — copy the `.example` versions if setting up fresh elsewhere:

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env
cp apps/admin/.env.example apps/admin/.env
```

**Root `.env`** (consumed by `apps/api`, Zod-validated at boot — a missing var fails loudly):
- `DATABASE_URL` — superuser-ish connection, used for migrations
- `DATABASE_APP_URL` — the restricted `hyperion_app` role the running server actually uses (migrations create/grant this role automatically)
- `REDIS_URL`
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` / `PLATFORM_JWT_SECRET` — generate with `openssl rand -hex 32`, one each
- `S3_*` — MinIO, matches the docker-compose service
- `RESEND_API_KEY`, `MAIL_FROM_*` — email, sent via the real Resend API (`apps/api/src/core/notification/mailer.ts`'s `resendMailer` is the default `activeMailer`) — not Mailhog, despite Mailhog being mentioned in the prompts doc
- `CLAMAV_HOST` / `CLAMAV_PORT` — attachment virus-scanning (`core/storage/`); `CLAMAV_PORT` defaults to `3310` if unset
- `WEB_APP_BASE_URL` — origin of `apps/web` (e.g. `http://localhost:5173`), used to build links in invite emails. **Never** point this at the API's own origin — that was a real bug (invite links 404'd) fixed 2026-07-23. See `apps/api/src/core/notification/templates/invite-email.ts`.
- `PLATFORM_BOOTSTRAP_ADMIN_EMAIL` / `PLATFORM_BOOTSTRAP_ADMIN_PASSWORD` / `PLATFORM_BOOTSTRAP_ADMIN_NAME` — only read by `pnpm seed:platform-admin` (step 6), not by the running server

**Note the non-default ports** — `docker/docker-compose.yml` maps Postgres to host `5433` (not 5432) and Redis to `6380` (not 6379), specifically to avoid clashing with any Postgres/Redis you already run locally.

**`apps/web/.env`**:
- `VITE_API_BASE_URL=http://localhost:3000/api/v1`
- `VITE_USE_MOCKS=true|false` — `true` runs the whole frontend against MSW with **zero backend running**; `false` hits the real API at `VITE_API_BASE_URL`

**`apps/admin/.env`** (the platform console — see step 6a):
- `VITE_API_BASE_URL=http://localhost:3000/api/v1/platform`
- `VITE_USE_MOCKS=true|false` — same semantics as `apps/web`

## 3. Start infrastructure

```bash
pnpm docker:up      # postgres:17, redis:7, minio, clamav — all with healthchecks
pnpm docker:ps      # confirm all show healthy
```

ClamAV's healthcheck has a 5-minute `start_period` — its virus-definition download on first boot takes a while, and it won't report healthy until that finishes. Only attachment upload (`POST /api/v1/attachments/...`) needs it; everything else works fine while it's still starting.

## 4. Run database migrations

```bash
pnpm db:migrate            # applies platform-schema migrations (tenants, tenant_modules, platform_admins)
```

Tenant-schema migrations are **not** run by this — they apply per-tenant, once a tenant schema exists:

```bash
pnpm migrate:tenants                    # all active tenants
pnpm migrate:tenants -- --tenant=acme   # one tenant
```

This only does anything once at least one tenant schema has been created (step 6).

## 5. Run the backend

```bash
pnpm --filter @hyperion/api dev
# or from repo root: pnpm dev   (runs turbo dev across every app, including the frontend if present)
```

Starts on `http://localhost:3000` (from `PORT` in `.env`). Verify with:

```bash
curl http://localhost:3000/health
```

## 6. Seed the first platform admin

The provisioning flow (`POST /api/v1/platform/tenants`) is protected by `platformAdminAuthMiddleware` — it needs a row in `platform.platform_admins` to log in as first. A seed script does this now (no manual SQL/argon2id hashing needed):

```bash
# in root .env: PLATFORM_BOOTSTRAP_ADMIN_EMAIL / _PASSWORD / (optional) _NAME
cd apps/api && pnpm seed:platform-admin
```

Idempotent — re-running with the same `PLATFORM_BOOTSTRAP_ADMIN_EMAIL` is a no-op if that admin already exists, so it's safe to run more than once.

## 6a. Create a tenant

Two ways to do this — prefer the admin console; curl is the fallback if it's not running.

**Via `apps/admin`** (recommended): run `pnpm --filter @hyperion/admin dev` (see step 7a below), log in with the platform admin from step 6, and use the tenant-creation form. This is what the UI actually calls under the hood.

**Via curl** (no admin console needed):

```bash
curl -X POST http://localhost:3000/api/v1/platform/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<PLATFORM_BOOTSTRAP_ADMIN_EMAIL>","password":"<PLATFORM_BOOTSTRAP_ADMIN_PASSWORD>"}'

curl -X POST http://localhost:3000/api/v1/platform/tenants \
  -H "Authorization: Bearer <platform-admin-accessToken-from-above>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Acme Metals","slug":"acme","adminEmail":"owner@acme.test","adminName":"Acme Owner","modules":["users","suppliers","purchase","masters","storage","field-definitions"]}'
```

This creates `tenant_acme`, runs tenant migrations against it, and (per `core/provisioning/provision-tenant.ts`) seeds roles/menus/field-definitions/number-series/reference-masters, creates a company + branch, and invites the tenant admin by email.

The invited tenant admin then opens the link in that email (`{{WEB_APP_BASE_URL}}/accept-invitation/:token?tenantCode=<slug>`), sets a password, and logs in normally at `POST /api/v1/auth/login` — passing `tenantCode` explicitly, since there's no subdomain on localhost to infer it from even though the field is technically optional.

A full Postman collection covering every endpoint (including this whole flow) lives in `docs/postman/`.

## 7. Run the frontend(s)

```bash
pnpm --filter @hyperion/web dev
```

Starts Vite on its default port (check terminal output, typically `http://localhost:5173`).

- With `VITE_USE_MOCKS=true` (the current default in `apps/web/.env`): the app runs standalone against MSW handlers generated from `packages/contracts` — no backend, no docker, no database needed at all. This is the fastest way to see the UI.
- With `VITE_USE_MOCKS=false`: requests go to the real API — needs steps 3–6 done first, and a real logged-in session.

### 7a. `apps/admin` — the platform console

```bash
pnpm --filter @hyperion/admin dev
```

Also a Vite app, own port (check terminal output). This is where tenant creation, suspend/reactivate, and per-tenant module toggling actually live — it's what step 6a's "via admin" option runs. Same `VITE_USE_MOCKS` convention as `apps/web`.

## 8. Run tests

```bash
pnpm test          # turbo run test across all packages
```

`apps/api` tests use **Testcontainers** — they spin up their own throwaway Postgres container per suite, so `pnpm docker:up` is not required for tests to pass (Docker itself must still be running). `apps/web` tests use Vitest + Testing Library + jsdom, no container needed.

## Quick reference — all scripts

| Command | What it does |
|---|---|
| `pnpm docker:up` / `docker:down` / `docker:ps` / `docker:logs` | manage postgres/redis/minio/clamav containers |
| `pnpm db:generate` / `db:migrate` | drizzle-kit generate/apply for the **platform** schema |
| `pnpm migrate:tenants [-- --tenant=slug]` | fan out pending tenant migrations to one or all tenant schemas |
| `pnpm dev` | turbo dev — runs `apps/api`, `apps/web`, and `apps/admin` together |
| `pnpm lint` / `typecheck` / `test` / `build` | turbo across all workspaces |
| `pnpm --filter @hyperion/api <script>` | run a script scoped to just the API (dev, db:generate, db:tenant:generate, migrate:tenants, seed:platform-admin) |
| `pnpm --filter @hyperion/web <script>` | run a script scoped to just the web app (dev, build, preview, msw:init) |
| `pnpm --filter @hyperion/admin <script>` | run a script scoped to just the admin console (dev, build, preview) |

## Known gaps as of 2026-07-23 (`docs/PROJECT-STATUS.md` is dated 2026-07-18 and is stale on several of these — trust the code over that file too)

- `GET /api/v1/users/me/companies` (the company/branch switcher `apps/web`'s header calls) **does not exist on the backend.** It was built frontend-first as a Zod contract + MSW mock (`packages/contracts/src/scope.ts`) so FE work wasn't blocked; the real endpoint was never speced in any numbered prompt and still needs to be built.
- `docker/docker-compose.yml` has local, uncommitted changes as of this writing (added `clamav`, dropped a `mailhog` service) — run `git status docker/docker-compose.yml` to check whether that's still true before assuming the service list above is what's actually committed.
- Masters (reference-data CRUD — countries, currencies, UOM, incoterms, etc.) live at `apps/api/src/core/masters/`, **not** `apps/api/src/modules/masters/` — don't be misled by the absence of a `modules/masters` directory into thinking this wasn't built.
