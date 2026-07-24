import { attachmentsRouter } from "../../modules/attachments/attachments.routes.js";
import { authRouter } from "../../modules/auth/auth.routes.js";
import { companiesRouter } from "../../modules/companies/companies.routes.js";
import { fieldDefinitionsRouter } from "../../modules/field-definitions/field-definitions.routes.js";
import { healthRouter } from "../../modules/health/health.routes.js";
import { menusRouter } from "../../modules/menus/menus.routes.js";
import { purchaseRouter } from "../../modules/purchase/purchase.routes.js";
import { suppliersRouter } from "../../modules/suppliers/suppliers.routes.js";
import { usersRouter } from "../../modules/users/users.routes.js";
import { ALL_MASTER_PERMISSIONS, mastersRouter } from "../masters/registry.js";
import { permissionEntry } from "../rbac/types.js";
import type { ModuleManifest } from "./types.js";

/**
 * The concrete list of modules this build ships. Order here doesn't
 * matter - registry.ts's resolveLoadOrder topologically sorts by
 * dependsOn. `health` and `auth`'s pre-authentication routes (login,
 * refresh) are structurally exempt from module-enabled gating: gating
 * requires a resolved tenant scope (common/middleware/require-module-
 * enabled.ts), and neither the health check nor an as-yet-unauthenticated
 * login request has one yet - see that middleware's doc comment.
 */
export const MODULE_MANIFESTS: ModuleManifest[] = [
  {
    key: "health",
    name: "Health",
    version: "1.0.0",
    routes: healthRouter,
    permissions: [],
    dependsOn: [],
    migrations: [],
  },
  {
    key: "auth",
    name: "Authentication",
    version: "1.0.0",
    routes: authRouter,
    permissions: [],
    dependsOn: [],
    migrations: ["0000_mysterious_blindfold", "0001_high_outlaw_kid"],
  },
  {
    key: "users",
    name: "User Management",
    version: "1.0.0",
    routes: usersRouter,
    permissions: [
      permissionEntry("users", "user", "create", "Invite a new user"),
      permissionEntry("users", "user", "read", "View users"),
      permissionEntry("users", "user", "update", "Edit a user"),
      permissionEntry("users", "user", "delete", "Deactivate a user"),
      permissionEntry(
        "users",
        "user",
        "provision",
        "Provision a user with a temporary password, bypassing the email invite flow (no email address)",
      ),
    ],
    dependsOn: ["auth"],
    migrations: ["0006_sad_trish_tilby"],
  },
  {
    key: "roles",
    name: "Roles & Permissions",
    version: "1.0.0",
    // Real HTTP surface as of the tenant-admin API task: CRUD + permission
    // grant/revoke + field-permission get/save, all REST layers over
    // core/rbac/mutations.ts's existing engine (that file's own doc
    // comment: it's the ONLY way role/permission/field-permission data
    // changes - this router calls it, never reimplements it). `routes` is
    // deliberately omitted here (unlike most manifests) - modules/roles/
    // roles.controller.ts's permissions-catalogue handler imports this
    // very registry.js (getPermissionCatalogue), so importing rolesRouter
    // back into manifests.ts would close a real cycle: manifests.ts ->
    // roles.routes.ts -> roles.controller.ts -> registry.ts ->
    // manifests.ts. `routes` is purely informational (registry.ts's own
    // mountModules doesn't exist - every router is mounted directly in
    // app.ts, "users"+"invitationsRouter" is the existing precedent for a
    // module whose full surface isn't captured by this one field), so
    // dropping it costs nothing real. rolesRouter/permissionsRouter are
    // still mounted in app.ts exactly like every other router.
    // module="admin", not "roles" (this manifest's own key) - the task's
    // explicit convention: admin.company/admin.branch/admin.role all share
    // the "admin" permission namespace, matching apps/web's mock catalogue
    // (apps/web/src/mocks/admin-handlers.ts) exactly. "assign"/"delete"
    // (the old roles.role.* placeholders) are gone: assigning a role to a
    // user is users.user.update's job now (PUT /users/:id/roles), and no
    // FR in this spec ever asked for role deletion.
    permissions: [
      permissionEntry("admin", "role", "create", "Create a role"),
      permissionEntry("admin", "role", "read", "View roles"),
      permissionEntry("admin", "role", "update", "Rename a role, manage its permissions"),
    ],
    dependsOn: ["auth"],
    migrations: ["0002_silent_white_tiger"],
  },
  {
    key: "menus",
    name: "Navigation Menus",
    version: "1.0.0",
    routes: menusRouter,
    permissions: [],
    dependsOn: ["auth", "roles"],
    migrations: ["0007_menus"],
  },
  {
    key: "field-definitions",
    name: "Field Engine (Tier 2)",
    version: "1.0.0",
    routes: fieldDefinitionsRouter,
    permissions: [
      permissionEntry("field_definitions", "field", "read", "View a module/entity's resolved field definitions"),
      permissionEntry(
        "field_definitions",
        "field",
        "update",
        "Override a Tier 2 field's label, visibility, mandatory flag, or sort order",
      ),
    ],
    dependsOn: ["auth", "roles"],
    migrations: ["0010_modern_adam_warlock"],
  },
  {
    key: "masters",
    name: "Masters",
    version: "1.0.0",
    routes: mastersRouter,
    permissions: [
      // customer remains a stub - not built yet, declared ahead of its
      // own future module. supplier used to be declared here too, but now
      // has a real implementation (see the "suppliers" manifest below) -
      // module="suppliers", not "masters", is its real permission
      // namespace.
      permissionEntry("masters", "customer", "create", "Create a customer master record"),
      permissionEntry("masters", "customer", "read", "View customer master records"),
      permissionEntry("masters", "customer", "update", "Edit a customer master record"),
      permissionEntry("masters", "customer", "delete", "Remove a customer master record"),
      // The 15 generic masters (countries, cities, currencies, ...) -
      // create/read/update per entity, generated from
      // core/masters/registry.ts so a 16th master needs no changes here.
      ...ALL_MASTER_PERMISSIONS,
    ],
    dependsOn: ["auth", "roles"],
    migrations: [
      "0011_chubby_blockbuster",
      "0012_dry_robbie_robertson",
      "0013_faulty_black_tarantula",
    ],
  },
  {
    key: "admin",
    name: "Tenant Admin (Companies & Branches)",
    version: "1.0.0",
    // Companies/branches REST layer under FE-5.5's tenant-admin screens.
    // routes only names one of the two routers this manifest owns
    // (companiesRouter) - branchesRouter is mounted separately in app.ts,
    // same precedent as "users" (routes: usersRouter, but app.ts also
    // mounts invitationsRouter on its own).
    routes: companiesRouter,
    permissions: [
      permissionEntry("admin", "company", "create", "Add a company"),
      permissionEntry("admin", "company", "read", "View companies"),
      permissionEntry("admin", "company", "update", "Edit a company"),
      permissionEntry("admin", "branch", "create", "Add a branch"),
      permissionEntry("admin", "branch", "read", "View branches"),
      permissionEntry("admin", "branch", "update", "Edit a branch"),
    ],
    // "masters": companies.country_id/currency_id FK into core/masters'
    // countries/currencies tables (this task's own resolved decision).
    dependsOn: ["auth", "roles", "masters"],
    migrations: ["0020_companies_country_currency_fk", "0021_companies_drop_country_currency_code"],
  },
  {
    key: "storage",
    name: "Storage & Attachments",
    version: "1.0.0",
    routes: attachmentsRouter,
    permissions: [
      permissionEntry("storage", "attachment", "create", "Upload a file attachment"),
      permissionEntry("storage", "attachment", "read", "View/download a file attachment"),
    ],
    dependsOn: ["auth"],
    migrations: ["0014_shiny_lilandra"],
  },
  {
    key: "suppliers",
    name: "Supplier Master",
    version: "1.0.0",
    routes: suppliersRouter,
    permissions: [
      permissionEntry("suppliers", "supplier", "create", "Create a supplier"),
      permissionEntry("suppliers", "supplier", "read", "View suppliers"),
      permissionEntry("suppliers", "supplier", "update", "Edit a supplier, or activate/deactivate it"),
    ],
    // "masters": suppliers.supplier_type_id/country_id/city_id/payment_term_id/currency_id all FK into core/masters tables.
    dependsOn: ["auth", "roles", "masters"],
    migrations: ["0014_shiny_lilandra"],
  },
  {
    key: "purchase",
    name: "Purchase",
    version: "1.0.0",
    // Built incrementally, session by session (docs/spec/Purchase-V2.md Sub
    // Tab 2 + 3 - "the big one", deliberately split rather than attempted in
    // one pass, now complete): (a) header+shipment, (b) items+pricing, (c)
    // allocation+costs (attachments needed no new code - core/storage's
    // existing entity-agnostic module already covers FR-110), (d) LME +
    // hedging, and (e) workflow + stock (this session) are all live.
    // "delete" stays declared but unexercised - no FR in this spec ever
    // asked for one, and it costs nothing to leave the permission stable
    // for whenever it's actually built.
    routes: purchaseRouter,
    permissions: [
      permissionEntry("purchase", "po", "create", "Create a purchase order"),
      permissionEntry("purchase", "po", "read", "View purchase orders"),
      permissionEntry("purchase", "po", "update", "Edit a draft purchase order"),
      permissionEntry("purchase", "po", "approve", "Approve a purchase order"),
      permissionEntry("purchase", "po", "post", "Post an approved purchase order"),
      permissionEntry("purchase", "po", "delete", "Delete a draft purchase order"),
    ],
    dependsOn: ["auth", "roles", "masters", "suppliers", "storage"],
    migrations: [
      "0015_lumpy_karnak",
      "0016_slim_hellion",
      "0017_serious_ricochet",
      "0018_loose_mastermind",
      "0019_lucky_sleeper",
    ],
  },
];
