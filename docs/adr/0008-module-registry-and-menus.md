# 0008 - Module registry and menu engine

## Status

Accepted

## Context

Two mechanisms that only matter once more than a handful of modules
exist, built now while there are few enough (health, auth, users, plus
three not-yet-routed placeholders) to retrofit cleanly: a module registry
that decides which routes/permissions exist and whether a given tenant
can reach them, and a menu engine that resolves a user's navigation tree
from the intersection of what they're permitted to see, what's enabled
for their tenant, and what's explicitly visible.

## Decisions

- **Module gating is a per-request middleware check
  (`common/middleware/require-module-enabled.ts`), not conditional route
  mounting.** A single Express process serves every tenant; the router
  tree is built once at boot, not per-tenant, so "only mount routes for
  enabled modules" can't mean what it sounds like literally - every
  module's router is always mounted, and `requireModuleEnabled(key)`
  decides per-request whether the request may proceed. It throws
  `NotFoundError` (404), never `ForbiddenError` (403) - task requirement:
  telling an unauthorized-but-otherwise-valid caller "this exists but you
  can't have it" leaks that the module exists at all.

- **`/login`, `/refresh`, and the public invitation-accept routes are
  structurally exempt from module gating**, not just conventionally
  excluded: `requireModuleEnabled` needs a resolved `tenantScope`, which
  requires an already-verified bearer token - there is no tenant to check
  enablement against before one exists. `/me`/`/logout` (already behind
  `scopeResolverMiddleware`) and `/me/password` do have a resolved scope
  by the time they'd run, but `/me/password` is deliberately left ungated
  too: it's the one endpoint a `password_change`-scoped token can reach at
  all (see docs/adr/0006), and locking a user out of clearing their own
  forced password because an admin toggled off the "users" module is a
  confusing trap with no real use case.

- **A genuine circular import** (`manifests.ts` -> a module's own routes
  -> ... -> `core/module-registry/tenant-modules.ts` ->
  `registry.ts` -> `manifests.ts`) surfaced while wiring `seedTenantModules`
  into the provisioner. Every module manifest needs its real `routes`
  Router to mount, and that Router's controller/service chain reaches
  `core/menu-engine/resolve.ts`, which needs `isModuleEnabledForTenant`
  from `tenant-modules.ts` - which, as originally written, imported
  `RESOLVED_MODULES` from `registry.ts` to seed a new tenant's rows,
  closing the loop back to `manifests.ts`. Fixed by having
  `seedTenantModules` take the manifest list as a parameter instead of
  importing it; only `provisioner.ts` (outside the cycle) needs to import
  `registry.ts` directly to supply it. `PermissionCatalogueEntry` and the
  `permissionEntry()` builder live in `core/rbac/types.ts` for the same
  reason - a genuine leaf module both `core/rbac/seed.ts` (which needs
  `getPermissionCatalogue` from the registry) and every manifest (which
  needs the type/builder to declare permissions) can import from without
  either side depending on the other.

- **A real bug in the existing role_version cache scheme, caught by a
  single-mutation invalidation test**: Redis's `INCR` on a missing key
  sets it to `1`. `core/rbac/cache.ts`'s `getRoleVersion` also treated a
  missing key as version `1` ("so the two paths agree on the starting
  point," per the original comment) - meaning a company's very *first*
  role/permission change was invisible to the cache key: version reads as
  1 before the change, and reads as 1 (via `INCR` from missing) after it
  too, so a stale cached result stays live under what looks like a "new"
  version. It went undetected in `core/rbac`'s own tests because every
  existing test chains 2-3 mutations before checking the cache (create
  role -> assign -> grant), and the second/third bump does move the
  version - masking the first bump's no-op. `core/menu-engine`'s
  single-mutation "cache invalidates on a menu change" test isolated it.
  Fixed in both `core/rbac/cache.ts` and `core/menu-engine/cache.ts`:
  missing key now reads as version `0`, so the first-ever bump (`0` -> `1`
  via `INCR`) is always a real, cache-key-visible transition.

- **The menu tree cache key omits an explicit "module_version"** even
  though task item 5 lists role/menu/module change as three independent
  invalidation triggers - `core/module-registry/tenant-modules.ts`'s
  `setModuleEnabled` bumps the same `menu_version` counter
  (`core/menu-engine/cache.ts`) that menu-row mutations bump, for every
  company in the tenant. From the cache key's perspective, "a module's
  enabled state changed" and "a menu row changed" are both just
  "something that can change which menu items resolve to visible" -
  giving them separate counters would only add a second thing every
  caller needs to remember to bump, for no invalidation-correctness
  benefit.

- **A menu node's three visibility gates
  (`required_permission`/`module_key`/`is_visible`) are ANDed, and a
  parent failing any gate excludes its entire subtree** - even for a
  child that would otherwise pass independently. A menu tree with
  permission gates at multiple levels only makes sense if a hidden
  section header hides what's under it; the alternative (re-parenting an
  orphaned child to the root, or dropping only the parent) has no obvious
  correct behavior and wasn't worth inventing one for.

- **Three placeholder manifests (`roles`, `masters`, `purchase`) declare
  permissions but no `routes`.** These permission keys already existed
  (hand-maintained in `core/rbac/seed.ts` before this task) and are
  already exercised by existing RBAC/onboarding tests
  (`purchase.po.approve`, etc.) - moving them into stub manifests is
  relocating already-in-scope permission declarations to their new owner
  under the registry model the task asks for, not inventing new surface
  area. `ModuleManifest.routes` is optional specifically to allow this.
