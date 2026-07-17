# 0006 - User onboarding (invitations, provisioning exception, password-change scope)

## Status

Accepted

## Context

Admins never set a password for another user - `docs/adr/0004-authentication.md`
already establishes this and left `password_hash` nullable for exactly this
reason. This ADR builds the flow that makes it real: email invitations with
a self-set password, a narrow ops-provisioning exception with a temporary
password, and the mechanism that forces a password change before anything
else happens. Per `docs/Hyperion-ERP-Backend-Plan-v2.md` section 5: this is
non-repudiation for OTP-style financial approvals - if an admin could set or
know a user's password, the user's approval signature is worthless as
evidence of what that specific person authorized.

## Decisions

- **Invitations are a bare random token, hashed with SHA-256 - not a JWT.**
  Unlike refresh tokens (a jose-signed JWT; forging one needs the signing
  secret, so the DB row is a safe, non-redundant lookup key - see 0004),
  an invitation only stores `token_hash`. This matters because email
  delivery is a much weaker channel than a `Set-Cookie` or an `Authorization`
  header: a DB leak plus a forwarded/archived email must never be enough to
  take over an account. SHA-256, not argon2: this hashes a 256-bit random
  value, not a human-chosen secret, so there's no brute-force search space
  slow hashing needs to defend against - a fast hash used purely as a
  lookup key is the right tool (core/auth/invite-token.ts).

- **The `users` row is created at invite time, not at accept time.**
  `invitations` (per the task's own column list) has no `mobile` or `name`
  column - only `email`. Since POST /users/invite takes `{email, mobile,
  name, roles[]}`, `mobile`/`name` have to live somewhere, and `users`
  already has an `invited` status with exactly this purpose (0004). So
  invite() inserts the user immediately (status=`invited`,
  password_hash=NULL) and a separate `invitations` row tracks the
  token/expiry/roles-intent/status. Accept() looks the user up by
  `(company_id, email)`, not by a `user_id` FK invitations doesn't have.

- **`users.email` is nullable; `users.mobile` gets the same
  soft-delete-aware unique index email already had.** Ops staff provisioned
  through POST /users/provision (task item 4) have no email at all. Since
  login() needs a non-ambiguous identifier either way, mobile is promoted
  to a first-class login identifier alongside email - `loginSchema`'s field
  is renamed `email` -> `identifier`, and login() tries `findUserByEmail`
  first, then `findUserByMobile`.

- **A must-change-password login gets an access token with `scope:
  "password_change"` and NO refresh token at all.** `core/auth/jwt.ts`'s
  access-claims schema gains a required `scope: "full" | "password_change"`
  field (required, not optional-with-a-default, matching how `roles` is
  always passed explicitly even though nothing populates it yet).
  `common/middleware/password-change-scope.ts` rejects every protected
  route except POST /users/me/password whenever the resolved scope is
  `password_change`. No refresh token is issued in this case; forcing a
  fresh login after the password is actually changed is simpler than
  keeping a long-lived refresh token alive for an account that isn't
  secured yet. POST /users/me/password itself accepts either scope (it's
  the one endpoint a scoped token must be able to reach) and returns a
  fresh full-scope pair on success via the same `issueTokenPair` login()
  uses (now exported from auth.service.ts).

- **Provisioning rejects any requested role that holds an `action =
  'approve'` permission** (`core/rbac/queries.ts`'s
  `roleIdsHoldApprovalPermission`) - a DB column check against
  `permissions.action`, not a hardcoded permission-key list, so a future
  module's own `*.approve` permission is covered automatically. This is
  the enforcement mechanism for the non-repudiation requirement this ADR
  opened with: an admin cannot hand someone approval authority without that
  person having self-set credentials.

- **`audit_logs` is new, generic, and append-only** - no
  `updated_by`/`deleted_at`/`version`, matching the `login_history`/
  `permissions` precedent: a log entry is never edited or undeleted. It's
  entity/entity_id/action/metadata rather than one table per event, since
  the only requirement driving it (record `provisioned_by`) doesn't justify
  a bigger design; broader consumers can filter on `entity`. Every write
  happens inside the same transaction as the business change it describes
  (CLAUDE.md rule 6) via `core/audit/write.ts`'s `insertAuditLog(tx, ...)`,
  which - unlike `core/rbac/mutations.ts`'s writers - takes `tx` directly
  rather than opening its own transaction, specifically so it composes.

- **Role assignment on accept/provision happens AFTER the main transaction
  commits, not inside it.** `core/rbac/mutations.ts`'s `assignRoleToUser`
  opens its own transaction per call (it takes a schema name, not a `tx`) -
  it was never built to compose into a caller's transaction, and widening
  its signature would touch every existing call site and already-passing
  RBAC test. The accepted tradeoff: a crash between the user-activation
  commit and the role-assignment call could leave an active, roleless user
  - recoverable by an admin re-assigning roles, and a materially smaller
  risk than the alternative of duplicating `user_roles` insert logic
  outside the one file `scripts/check-rbac-boundary.mjs`'s docstring says
  should own it.

- **Mailer is a small injectable port (`core/notification/mailer.ts`), not
  a hardcoded Resend call.** Production uses `resendMailer` (native `fetch`
  against Resend's REST API - no SDK dependency needed for one JSON POST).
  Tests call `setMailer()` with a fake that captures sends in-process:
  the accept-invitation HTTP response never contains the raw token (it's
  only ever in the email), so the full invite -> accept -> login test needs
  some way to observe it, and hitting the real Resend API from CI would
  cost money, need a real key, and be non-deterministic.

- **Mailhog is gone.** The original prototype-plan wording ("Mailhog in
  dev") assumed dev/test and production would use different mailers; given
  Resend everywhere instead, the docker-compose mailhog service and the
  SMTP_HOST/SMTP_PORT env vars serve no purpose and were removed.
