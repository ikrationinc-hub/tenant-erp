import { attachmentsRouter } from "../../modules/attachments/attachments.routes.js";
import { authRouter } from "../../modules/auth/auth.routes.js";
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
    // No HTTP surface yet - role/permission mutations are called directly
    // from core/rbac/mutations.ts by other modules (e.g. users' invite/
    // accept flow). This manifest exists to own the "roles" permission
    // namespace, not to route anything.
    permissions: [
      permissionEntry("roles", "role", "create", "Create a role"),
      permissionEntry("roles", "role", "read", "View roles"),
      permissionEntry("roles", "role", "update", "Edit a role's permissions"),
      permissionEntry("roles", "role", "assign", "Assign a role to a user"),
      permissionEntry("roles", "role", "delete", "Remove a role"),
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
