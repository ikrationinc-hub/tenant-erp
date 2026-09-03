import { Router } from "express";
import { requireModuleEnabled } from "../../common/middleware/require-module-enabled.js";
import { requirePermission } from "../../common/middleware/rbac.js";
import { scopeResolverMiddleware } from "../../common/middleware/scope-resolver.js";
import * as clausesController from "./clauses.controller.js";

export const clausesRouter: Router = Router();

const requireContractModule = requireModuleEnabled("contract");
const readPermission = requirePermission("contract.clause.read");
const createPermission = requirePermission("contract.clause.create");
const versionPermission = requirePermission("contract.clause.version");
const approvePermission = requirePermission("contract.clause.approve");
const deactivatePermission = requirePermission("contract.clause.deactivate");

clausesRouter.get("/", scopeResolverMiddleware, requireContractModule, readPermission, clausesController.list);
clausesRouter.post("/", scopeResolverMiddleware, requireContractModule, createPermission, clausesController.create);
clausesRouter.get("/:id/versions", scopeResolverMiddleware, requireContractModule, readPermission, clausesController.listVersions);
clausesRouter.post("/:id/versions", scopeResolverMiddleware, requireContractModule, versionPermission, clausesController.addVersion);
clausesRouter.patch(
  "/:id/versions/:versionId/approve",
  scopeResolverMiddleware,
  requireContractModule,
  approvePermission,
  clausesController.approveVersion,
);
clausesRouter.patch(
  "/:id/deactivate",
  scopeResolverMiddleware,
  requireContractModule,
  deactivatePermission,
  clausesController.deactivate,
);
