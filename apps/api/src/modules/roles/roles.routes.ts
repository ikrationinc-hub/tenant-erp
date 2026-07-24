import { Router } from "express";
import { requireModuleEnabled } from "../../common/middleware/require-module-enabled.js";
import { requirePermission } from "../../common/middleware/rbac.js";
import { scopeResolverMiddleware } from "../../common/middleware/scope-resolver.js";
import * as rolesController from "./roles.controller.js";

export const rolesRouter: Router = Router();
export const permissionsRouter: Router = Router();

const requireRolesModule = requireModuleEnabled("roles");
const readPermission = requirePermission("admin.role.read");
const createPermission = requirePermission("admin.role.create");
const updatePermission = requirePermission("admin.role.update");

// "/options" registered as its own literal route, same reasoning as
// core/masters/registry.ts's GET /:master/options - there's no GET
// "/:id" on this router at all (task item 10 only specs list/create/
// rename), so there's no ordering hazard either way, but matching that
// precedent keeps the two "list options for a dropdown" endpoints in this
// codebase consistent.
rolesRouter.get("/options", scopeResolverMiddleware, requireRolesModule, readPermission, rolesController.listOptions);

rolesRouter.get("/", scopeResolverMiddleware, requireRolesModule, readPermission, rolesController.list);
rolesRouter.post("/", scopeResolverMiddleware, requireRolesModule, createPermission, rolesController.create);
rolesRouter.patch("/:id", scopeResolverMiddleware, requireRolesModule, updatePermission, rolesController.update);

// Permission grant/revoke (task item 13) - one call per moved Transfer
// item, not a batch endpoint (apps/web's PermissionAssignment calls these
// once per moved item).
rolesRouter.get(
  "/:roleId/permissions",
  scopeResolverMiddleware,
  requireRolesModule,
  readPermission,
  rolesController.getGrantedPermissions,
);
rolesRouter.post(
  "/:roleId/permissions",
  scopeResolverMiddleware,
  requireRolesModule,
  updatePermission,
  rolesController.grantPermission,
);
rolesRouter.delete(
  "/:roleId/permissions/:permissionKey",
  scopeResolverMiddleware,
  requireRolesModule,
  updatePermission,
  rolesController.revokePermission,
);

// Field permissions (task items 14/15) - GET returns overrides only, PUT
// upserts the whole matrix for one (role, module, entity) in a batch.
rolesRouter.get(
  "/:roleId/field-permissions",
  scopeResolverMiddleware,
  requireRolesModule,
  readPermission,
  rolesController.getFieldPermissions,
);
rolesRouter.put(
  "/:roleId/field-permissions",
  scopeResolverMiddleware,
  requireRolesModule,
  updatePermission,
  rolesController.saveFieldPermissions,
);

// GET /api/v1/permissions - the full catalogue (task item 11), a
// standalone top-level route (not nested under /roles) - no module gate
// beyond authentication itself, same as GET /users/me/permissions: every
// authenticated user can see what a permission KEY means (its
// description), the module/role gates are all about who gets GRANTED one.
permissionsRouter.get("/", scopeResolverMiddleware, rolesController.getPermissionsCatalogue);
