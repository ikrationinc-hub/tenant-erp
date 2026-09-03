import { Router } from "express";
import { requireModuleEnabled } from "../../common/middleware/require-module-enabled.js";
import { requirePermission } from "../../common/middleware/rbac.js";
import { scopeResolverMiddleware } from "../../common/middleware/scope-resolver.js";
import * as clausesController from "./clauses.controller.js";
import * as contractsController from "./contracts.controller.js";

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

/**
 * C-3a (docs/CONTRACT-MODULE-BUILD.md Part 2): the minimal contract
 * header - separate top-level router (mounted at /api/v1/contracts in
 * app.ts), same precedent as purchaseReceiptsListRouter/
 * purchasePaymentsRouter being their own routers under purchase.routes.ts
 * rather than nested under one router that can't host two different
 * top-level paths. Reuses contract.clause.read/.create for now (no
 * contract.header.* permission surface yet) - C-3b, once the full
 * contract document/lifecycle exists, is where a dedicated permission set
 * for the header itself belongs.
 */
export const contractsRouter: Router = Router();
contractsRouter.post("/", scopeResolverMiddleware, requireContractModule, createPermission, contractsController.create);
contractsRouter.get("/:id", scopeResolverMiddleware, requireContractModule, readPermission, contractsController.getById);
contractsRouter.patch("/:id", scopeResolverMiddleware, requireContractModule, createPermission, contractsController.update);
