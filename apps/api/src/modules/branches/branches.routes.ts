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

branchesRouter.get("/", scopeResolverMiddleware, requireAdminModule, readPermission, branchesController.list);
branchesRouter.post("/", scopeResolverMiddleware, requireAdminModule, createPermission, branchesController.create);
branchesRouter.patch("/:id", scopeResolverMiddleware, requireAdminModule, updatePermission, branchesController.update);
