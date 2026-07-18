# 0009 - Provisioning engine

## Status

Accepted

## Context

One-click tenant + company setup - the milestone the plan doc calls the
week-6 go/no-go checkpoint. `provisionTenant` composes nearly every
engine built so far (migrations, RBAC, menus, numbering, module registry,
the invite flow) into one call, and needed two genuinely new pieces:
platform admin authentication ("separate auth entirely" - never existed
before this task) and reference/field-definition seed data.

## Decisions

- **Platform admin auth is a real, separate, minimal JWT scheme
  (`core/platform-auth/`), signed with its own `PLATFORM_JWT_SECRET`** -
  never `JWT_ACCESS_SECRET`. A platform admin token carries no tenant/
  company/branch claims at all (there is nothing to scope it to), and
  must never verify against tenant auth or vice versa. No refresh
  rotation: platform admin sessions are rare, manual, human-initiated
  actions, not the kind of long-lived session rotation exists for: an 8h
  token that expires is sufficient for this prototype's scope. Platform
  admins are not self-service - `insertPlatformAdmin` exists for tests
  and a future seed script, not an HTTP endpoint ("you/Knackroot",
  docs/Hyperion-ERP-Backend-Plan-v2.md).

- **`users.mobile` is now nullable**, mirroring `email`'s existing
  nullability (docs/adr/0006). `provisionTenant`'s input has no mobile
  field - a platform admin provisioning a tenant collects a name and
  email for the admin, never a phone number - and the schema needed to
  actually support a user row having email without mobile, not just the
  reverse (a provisioned ops user having mobile without email). Both
  carry the same soft-delete-aware partial unique index, so whichever
  identifier is present is never ambiguous about which user it means.

- **The tenant admin's Admin-role grant happens ONLY at invite-accept
  time, never during provisioning itself** - caught by this task's own
  end-to-end "admin can accept invite and log in" test. The admin's user
  row is created early (so every seed step after it can use the admin's
  own id as `createdBy`), and the invitation's `roles: [adminRoleId]`
  carries the intent - but actually calling `assignRoleToUser` during
  provisioning too, on top of the normal accept-invitation flow doing
  the same thing, double-assigned the same (user, role) pair and violated
  `user_roles`'s unique constraint. There is exactly one place a role
  grant happens for an invited user: accept time, matching the existing
  invite flow's semantics (docs/adr/0006) with no special case for the
  bootstrap admin.

- **`invitations.invited_by` (a NOT NULL FK to `users.id`) is satisfied by
  having the provisioned admin record themselves as their own inviter.**
  There is no other real tenant-side user at this point in a brand-new
  tenant's provisioning - the row must reference SOME valid `users.id`,
  and the invitee's own id (already committed by the time the invitation
  row is inserted) is the only one that's both valid and truthful about
  what actually happened: the tenant setup process created this account,
  not another human.

- **Failure cleanup (task item 3: drop schema + delete the platform row)
  only ever runs for a brand-new tenant that hasn't reached `active`
  yet.** A re-run against an already-active tenant
  (`reProvisionExistingTenant`) never calls it, deliberately - a failed
  re-run must not destroy a tenant that was already working. The two
  paths are structurally separate functions, not one function with a
  conditional cleanup branch, so this can't be accidentally miswired by
  a future edit to the new-tenant path.

- **"Idempotent, versioned, re-run applies only what's new" (task item 2)
  is satisfied by making every seed step's own persistence naturally
  idempotent (`onConflictDoUpdate`/`onConflictDoNothing` against each
  step's own natural key), rather than building a separate provisioning-
  version tracking table.** `core/rbac/mutations.ts`'s `createRole` and
  `core/menu-engine/mutations.ts`'s `createMenu` are the one exception -
  neither has "already exists" handling of its own (by design: normal
  runtime role/menu creation SHOULD fail loudly on a duplicate name), so
  `reProvisionExistingTenant` skips those two steps entirely once a
  tenant is active, rather than teaching two general-purpose mutation
  functions a special idempotency mode only provisioning needs.

- **Module enablement resolves the full dependency closure of the
  requested modules** (`core/module-registry/registry.ts`'s
  `resolveModuleClosure`), not just the requested keys verbatim -
  requesting "purchase" without also enabling "masters" and "roles" (its
  declared dependencies) would enable a module whose dependencies aren't
  available. "health" and "auth" are always in the closure regardless of
  what was requested: infrastructure, not a business module a tenant
  would meaningfully toggle off (see docs/adr/0008's note on why `/login`
  structurally can't even be gated).

- **`reference_masters` seeds once per TENANT (not per company)** -
  tenant-wide reference data (countries, currencies, UOM, incoterms) means
  the same thing for every company in the tenant, same reasoning as the
  `permissions` catalogue. `provisionCompany` (adding a second legal
  entity) deliberately does NOT re-seed it.
