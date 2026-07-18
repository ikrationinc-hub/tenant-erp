import { authRouter } from "../../modules/auth/auth.routes.js";
import { healthRouter } from "../../modules/health/health.routes.js";
import { menusRouter } from "../../modules/menus/menus.routes.js";
import { usersRouter } from "../../modules/users/users.routes.js";
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
    key: "masters",
    name: "Masters",
    version: "1.0.0",
    // Not built yet (90-day plan, week 7+) - permissions declared ahead of
    // the routes so roles can be configured to reference them today.
    permissions: [
      permissionEntry("masters", "supplier", "create", "Create a supplier master record"),
      permissionEntry("masters", "supplier", "read", "View supplier master records"),
      permissionEntry("masters", "supplier", "update", "Edit a supplier master record"),
      permissionEntry("masters", "supplier", "delete", "Remove a supplier master record"),
      permissionEntry("masters", "customer", "create", "Create a customer master record"),
      permissionEntry("masters", "customer", "read", "View customer master records"),
      permissionEntry("masters", "customer", "update", "Edit a customer master record"),
      permissionEntry("masters", "customer", "delete", "Remove a customer master record"),
    ],
    dependsOn: ["auth", "roles"],
    migrations: [],
  },
  {
    key: "purchase",
    name: "Purchase",
    version: "1.0.0",
    // Not built yet (90-day plan, week 9+).
    permissions: [
      permissionEntry("purchase", "po", "create", "Create a purchase order"),
      permissionEntry("purchase", "po", "read", "View purchase orders"),
      permissionEntry("purchase", "po", "update", "Edit a draft purchase order"),
      permissionEntry("purchase", "po", "approve", "Approve a purchase order"),
      permissionEntry("purchase", "po", "delete", "Delete a draft purchase order"),
    ],
    dependsOn: ["auth", "roles", "masters"],
    migrations: [],
  },
];
