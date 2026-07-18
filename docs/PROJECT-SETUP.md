# Hyperion ERP — Project Setup & Run Guide

_Written 2026-07-18 against the state of the repo at that time — re-check `pnpm-workspace.yaml`, `apps/api/package.json`, and `apps/web/package.json` if scripts have moved on since._

## Prerequisites

- Node.js ≥ 22 (see `engines` in root `package.json`)
- pnpm 9.15.4 (`packageManager` field — use `corepack enable` to get the exact version)
- Docker + Docker Compose (Postgres/Redis/MinIO run in containers; Testcontainers also needs Docker for `pnpm test`)

## 1. Install dependencies

```bash
cd hyperion-erp
pnpm install
```

## 2. Environment files

Two `.env` files exist already in this repo (`.env` at root, `apps/web/.env`) — copy the `.example` versions if setting up fresh elsewhere:

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env
```

**Root `.env`** (consumed by `apps/api`, Zod-validated at boot — a missing var fails loudly):
- `DATABASE_URL` — superuser-ish connection, used for migrations
- `DATABASE_APP_URL` — the restricted `hyperion_app` role the running server actually uses (migrations create/grant this role automatically)
- `REDIS_URL`
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` / `PLATFORM_JWT_SECRET` — generate with `openssl rand -hex 32`, one each
- `S3_*` — MinIO, matches the docker-compose service
- `RESEND_API_KEY`, `MAIL_FROM_*` — email; Mailhog is mentioned in the prompts doc but the current `.env` uses Resend instead — check `apps/api/src/core/notification/mailer.ts` for which is actually wired

**Note the non-default ports** — `docker/docker-compose.yml` maps Postgres to host `5433` (not 5432) and Redis to `6380` (not 6379), specifically to avoid clashing with any Postgres/Redis you already run locally.

**`apps/web/.env`**:
- `VITE_API_BASE_URL=http://localhost:3000/api/v1`
- `VITE_USE_MOCKS=true|false` — `true` runs the whole frontend against MSW with **zero backend running**; `false` hits the real API at `VITE_API_BASE_URL`

## 3. Start infrastructure

```bash
pnpm docker:up      # postgres:17, redis:7, minio — all with healthchecks
pnpm docker:ps      # confirm all show healthy
```

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

## 6. Create a tenant (currently manual — see gap below)

The provisioning flow (`POST /api/v1/platform/tenants`) exists and is protected by `platformAdminAuthMiddleware` — it needs a row in `platform.platform_admins` to log in as first. **As of this writing there is no seed script or CLI for creating the first platform admin** — you'd need to insert one directly:

```sql
-- run against DATABASE_URL, schema "platform"
insert into platform.platform_admins (email, password_hash, name, status)
values ('admin@hyperion.local', '<argon2id-hash>', 'Platform Admin', 'active');
```

Generate the argon2id hash using the same helper the app uses (`apps/api/src/core/auth/password.ts` — hashing function), e.g. via a one-off `tsx` script, since there's no CLI for it yet. Once that row exists:

```bash
curl -X POST http://localhost:3000/api/v1/platform/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@hyperion.local","password":"..."}'

curl -X POST http://localhost:3000/api/v1/platform/tenants \
  -H "Authorization: Bearer <platform-admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Acme Metals","slug":"acme","adminEmail":"owner@acme.test","adminName":"Acme Owner","modules":["auth","users","roles","menus"]}'
```

This creates `tenant_acme`, runs tenant migrations against it, and (per `core/provisioning/provision-tenant.ts`) seeds roles/menus/field-definitions/number-series/reference-masters and invites the tenant admin — confirm the exact seeded shape by reading that file, since this part of the codebase is newer and still in flux (uncommitted as of 2026-07-18).

The invited tenant admin then accepts their invite (emailed via whichever mailer is wired — check current config) and logs in normally at `POST /api/v1/auth/login`.

## 7. Run the frontend

```bash
pnpm --filter @hyperion/web dev
```

Starts Vite on its default port (check terminal output, typically `http://localhost:5173`).

- With `VITE_USE_MOCKS=true` (the current default in `apps/web/.env`): the app runs standalone against MSW handlers generated from `packages/contracts` — no backend, no docker, no database needed at all. This is the fastest way to see the UI.
- With `VITE_USE_MOCKS=false`: requests go to the real API — needs steps 3–6 done first, and a real logged-in session.

## 8. Run tests

```bash
pnpm test          # turbo run test across all packages
```

`apps/api` tests use **Testcontainers** — they spin up their own throwaway Postgres container per suite, so `pnpm docker:up` is not required for tests to pass (Docker itself must still be running). `apps/web` tests use Vitest + Testing Library + jsdom, no container needed.

## Quick reference — all scripts

| Command | What it does |
|---|---|
| `pnpm docker:up` / `docker:down` / `docker:ps` / `docker:logs` | manage postgres/redis/minio containers |
| `pnpm db:generate` / `db:migrate` | drizzle-kit generate/apply for the **platform** schema |
| `pnpm migrate:tenants [-- --tenant=slug]` | fan out pending tenant migrations to one or all tenant schemas |
| `pnpm dev` | turbo dev — runs `apps/api` (tsx watch) and `apps/web` (vite) together |
| `pnpm lint` / `typecheck` / `test` / `build` | turbo across all workspaces |
| `pnpm --filter @hyperion/api <script>` | run a script scoped to just the API (dev, db:generate, db:tenant:generate, migrate:tenants) |
| `pnpm --filter @hyperion/web <script>` | run a script scoped to just the web app (dev, build, preview, msw:init) |

## Known gaps as of 2026-07-18 (see `docs/PROJECT-STATUS.md`)

- No seed script/CLI exists yet for the first platform admin — manual SQL insert required (step 6).
- `core/provisioning/` and `modules/platform/` are **uncommitted, in-progress** — re-verify they still exist and behave as described before relying on this doc.
- Frontend (`apps/web`) is new since the last audit — confirm what screens actually render today; the field-engine backend it will eventually depend on (Prompt 11) does not exist yet.
