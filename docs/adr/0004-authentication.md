# 0004 - Authentication (login, refresh rotation, logout, /me)

## Status

Accepted

## Context

First real identity: `users`/`refresh_tokens`/`login_history` in the tenant
schema, jose-signed JWTs, argon2id password hashing, and scope-resolver
wired to real tokens instead of the base64url stub from
[0002](0002-tenant-boundary.md). Per
`docs/Hyperion-ERP-Backend-Plan-v2.md` section 5: admins never set an
employee's password (non-repudiation for OTP-style financial approvals),
subdomain-first tenant resolution with a tenant-code fallback, and no
email-enumeration leak through login.

## Decisions

- **`password_hash` is nullable and login treats "no hash yet" identically to
  "wrong password."** An invited user has no password until they set one via
  a (not-yet-built) invite-link flow; revealing "this account exists but
  hasn't activated yet" is itself an enumeration leak, so it gets the same
  generic response as everything else that isn't a fully-correct
  known-active-user credential pair.
- **Account-status checks (invited/suspended) only run after password
  verification succeeds.** The anti-enumeration requirement is specifically
  "unknown email vs wrong password" - once a caller has proven they know a
  correct password, telling them the account is suspended isn't a new
  enumeration vector, and doing the check earlier would mean an attacker
  could distinguish "exists but suspended" from "wrong password" for free.
- **`refresh_tokens.id` doubles as the refresh JWT's `jti`.** No separate
  token-hash column: the token is a jose-signed JWT (forging one requires
  the signing secret, which a DB leak doesn't hand out), so the id is a
  sufficient, non-redundant lookup key. `signRefreshToken` takes that id as
  a parameter rather than generating its own, precisely so the caller can
  insert the matching row first.
- **Rotation is one transaction; reuse-triggered family revocation is a
  separate one, committed before the rejection is thrown.** This was a real
  bug caught by the reuse test itself: revoking the family and then throwing
  `UnauthorizedError` from inside the *same* `withTenantSchema` transaction
  rolled the revocation back too (drizzle's `.transaction()` rolls back on
  any throw from its callback) - the family was never actually revoked, and
  a token issued by the legitimate rotation right before the reuse would
  still work. Splitting the read, the revoke, and the throw across separate
  transaction boundaries fixed it. See `auth.service.ts`'s `refresh()`.
- **The IP-based login rate limit (`common/middleware/login-rate-limit.ts`)
  is a generous volume cap (100/15min), not the brute-force defense.** The
  per-email failure lockout (`core/auth/login-rate-limit.ts`, 5 failures/15
  min, Redis-backed) is what actually protects a given account, and it's
  keyed by the raw attempted email string regardless of whether that email
  is real - so lockout timing/behavior can't itself become an enumeration
  signal. The IP limiter only guards against raw flooding.
- **Tenant resolution for login lives in `core/auth/tenant-resolver.ts`,
  reading the Host header directly**, because this repo has no Nginx layer
  yet to resolve the subdomain before the request arrives (the plan doc
  assumes one exists). Tenant-code (the platform tenant's `slug`) is the
  documented fallback. An unresolved tenant produces the exact same generic
  "Invalid email or password" response as an unknown user - never a
  distinct "no such tenant" message.
- **`get-db.ts` gained `withTenantSchema(schemaName, fn)`**, a schema-name-
  keyed sibling to `withTenantDb(ctx, fn)`. Login is the one call site that
  legitimately has no `RequestContext.tenantScope` yet - it's what produces
  the token a scope would otherwise come from - so it needs the tenant
  boundary without needing a full ctx. `withTenantDb` is now a two-line
  wrapper over it. This keeps `search_path` handling inside get-db.ts alone.
- **`roles: []` for now.** Claims include `roles` per the task's fixed shape,
  but no roles/permissions engine exists yet (that's field-level RBAC,
  section 6 of the plan doc, a separate task) - every token is issued with
  an empty roles array until that engine lands and populates it for real.
- **`TenantScope` grew optional `userId`/`roles`.** Existing tests
  (tenant-isolation, migration-runner) construct scopes without a real
  logged-in user behind them, so both fields are optional rather than
  forcing every call site to supply them.

## A real cross-cutting bug this caught

`test/global-setup.ts` starts a fresh Testcontainers Postgres per `vitest
run` invocation, but Redis is the long-lived docker-compose instance shared
across every local run. Login rate-limit counters, per-email lockout
counters, and denylisted jtis accumulated across every manual test
invocation during development, eventually tripping the IP rate limiter
mid-suite and producing confusing, unrelated-looking 429s in unrelated
tests. Fixed by flushing the Redis db once in global setup, right after
resolving `REDIS_URL` - same file, same "don't import src/ modules here"
constraint as the Postgres migration bootstrap already documented in
[0003](0003-cross-tenant-migration-runner.md).

## Deliberate scope cuts (not forgotten)

- No invite-link / set-password flow - `password_hash` starts `NULL` and
  there is currently no way to set it. Login against an invited user always
  fails (correctly, since there's nothing to verify against).
- No refresh-token-family race protection: reading the existing token and
  rotating it are two separate `withTenantSchema` calls (necessarily, per
  the bug above), leaving a narrow window for two concurrent `/refresh`
  calls with the same token to both pass the reuse check. A future
  hardening pass could close this with `SELECT ... FOR UPDATE` or a single
  atomic UPDATE ... RETURNING; not done here since it's a race, not the
  reuse-after-rotation scenario the task asks for.
- Cookies were considered for refresh-token transport (httpOnly, secure) and
  deliberately not used - this repo has no cookie-parsing middleware and no
  CSRF story yet, and the task didn't ask for one. Both tokens are returned
  in the JSON body; the client is responsible for storage.
