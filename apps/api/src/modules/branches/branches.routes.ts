import { Router } from "express";
import { requireModuleEnabled } from "../../common/middleware/require-module-enabled.js";
import { requirePermission } from "../../common/middleware/rbac.js";
import { scopeResolverMiddleware } from "../../common/middleware/scope-resolver.js";
import * as branchesController from "./branches.controller.js";

export const branchesRouter: Router = Router();

const requireAdminModule = requireModuleEnabled("admin");
const readPermission = requirePermission("admin.branch.read");
const createPermission = requirePermission("admin.branch.create");
const updatePermission = requirePermission("admin.branch.update");

// "/options" registered before "/" - same precedent as core/masters/
// registry.ts and roles.routes.ts's GET /options: other modules' own
// Dropdown fields (e.g. Purchase's branchId) source options from here,
// so it needs to resolve before any future "/:id"-shaped route could
// swallow it.
branchesRouter.get("/options", scopeResolverMiddleware, requireAdminModule, readPermission, branchesController.listOptions);

branchesRouter.get("/", scopeResolverMiddleware, requireAdminModule, readPermission, branchesController.list);
branchesRouter.post("/", scopeResolverMiddleware, requireAdminModule, createPermission, branchesController.create);
branchesRouter.patch("/:id", scopeResolverMiddleware, requireAdminModule, updatePermission, branchesController.update);
