import { Router } from "express";
import { requireModuleEnabled } from "../../common/middleware/require-module-enabled.js";
import { requirePermission } from "../../common/middleware/rbac.js";
import { scopeResolverMiddleware } from "../../common/middleware/scope-resolver.js";
import * as companiesController from "./companies.controller.js";

export const companiesRouter: Router = Router();

const requireAdminModule = requireModuleEnabled("admin");
const readPermission = requirePermission("admin.company.read");
const createPermission = requirePermission("admin.company.create");
const updatePermission = requirePermission("admin.company.update");

// No activate/deactivate route (task item 1) - status is just a field on
// the record, edited through the normal PATCH like any other column.
companiesRouter.get("/", scopeResolverMiddleware, requireAdminModule, readPermission, companiesController.list);
companiesRouter.post("/", scopeResolverMiddleware, requireAdminModule, createPermission, companiesController.create);
companiesRouter.patch("/:id", scopeResolverMiddleware, requireAdminModule, updatePermission, companiesController.update);
