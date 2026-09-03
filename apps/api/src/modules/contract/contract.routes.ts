import { Router } from "express";
import { requireModuleEnabled } from "../../common/middleware/require-module-enabled.js";
import { requirePermission } from "../../common/middleware/rbac.js";
import { scopeResolverMiddleware } from "../../common/middleware/scope-resolver.js";
import * as clausesController from "./clauses.controller.js";
import * as contractTemplatesController from "./contract-templates.controller.js";
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
 * C-3b (docs/CONTRACT-MODULE-BUILD.md Part 2), item 6's real permission
 * surface: create/edit/assemble/generate - "assemble" covers every
 * assembly action (add/remove/reorder/edit-text/resnapshot) AND every
 * workflow transition (approve/sign/close), matching the spec's own
 * flat 4-permission list rather than inventing one permission per
 * transition the way purchase.po.issue/cancel does - the prompt itself
 * names exactly these four, no more.
 */
const contractReadPermission = requirePermission("contract.clause.read");
const contractCreatePermission = requirePermission("contract.document.create");
const contractEditPermission = requirePermission("contract.document.edit");
const contractAssemblePermission = requirePermission("contract.document.assemble");
const contractGeneratePermission = requirePermission("contract.document.generate");

export const contractsRouter: Router = Router();
contractsRouter.get("/", scopeResolverMiddleware, requireContractModule, contractReadPermission, contractsController.list);
contractsRouter.post("/", scopeResolverMiddleware, requireContractModule, contractCreatePermission, contractsController.create);
contractsRouter.get("/:id", scopeResolverMiddleware, requireContractModule, contractReadPermission, contractsController.getById);
contractsRouter.patch("/:id", scopeResolverMiddleware, requireContractModule, contractEditPermission, contractsController.update);
contractsRouter.patch("/:id/approve", scopeResolverMiddleware, requireContractModule, contractAssemblePermission, contractsController.approve);
contractsRouter.patch("/:id/sign", scopeResolverMiddleware, requireContractModule, contractAssemblePermission, contractsController.sign);
contractsRouter.patch("/:id/close", scopeResolverMiddleware, requireContractModule, contractAssemblePermission, contractsController.close);

// --- Assembly (item 5) -------------------------------------------------------
contractsRouter.post("/:id/clauses", scopeResolverMiddleware, requireContractModule, contractAssemblePermission, contractsController.addClause);
contractsRouter.delete(
  "/:id/clauses/:contractClauseId",
  scopeResolverMiddleware,
  requireContractModule,
  contractAssemblePermission,
  contractsController.removeClause,
);
contractsRouter.patch(
  "/:id/clauses/reorder",
  scopeResolverMiddleware,
  requireContractModule,
  contractAssemblePermission,
  contractsController.reorderClauses,
);
contractsRouter.patch(
  "/:id/clauses/:contractClauseId",
  scopeResolverMiddleware,
  requireContractModule,
  contractAssemblePermission,
  contractsController.editClauseText,
);
contractsRouter.post(
  "/:id/clauses/resnapshot",
  scopeResolverMiddleware,
  requireContractModule,
  contractAssemblePermission,
  contractsController.resnapshot,
);
contractsRouter.get("/:id/preview", scopeResolverMiddleware, requireContractModule, contractReadPermission, contractsController.preview);

// --- Generation (item 5) ------------------------------------------------------
contractsRouter.post("/:id/generate", scopeResolverMiddleware, requireContractModule, contractGeneratePermission, contractsController.generate);
contractsRouter.get(
  "/:id/generate/:jobId",
  scopeResolverMiddleware,
  requireContractModule,
  contractReadPermission,
  contractsController.getGenerationStatus,
);

/** Templates (item 1) - master-style CRUD, own top-level router (mounted at /api/v1/contract-templates), same "own top-level path" precedent as purchaseReceiptsListRouter. */
export const contractTemplatesRouter: Router = Router();
contractTemplatesRouter.get("/", scopeResolverMiddleware, requireContractModule, contractReadPermission, contractTemplatesController.list);
contractTemplatesRouter.post("/", scopeResolverMiddleware, requireContractModule, contractCreatePermission, contractTemplatesController.create);
contractTemplatesRouter.get("/:id", scopeResolverMiddleware, requireContractModule, contractReadPermission, contractTemplatesController.getById);
contractTemplatesRouter.patch("/:id", scopeResolverMiddleware, requireContractModule, contractEditPermission, contractTemplatesController.update);
contractTemplatesRouter.post(
  "/:id/clauses",
  scopeResolverMiddleware,
  requireContractModule,
  contractEditPermission,
  contractTemplatesController.addClause,
);
contractTemplatesRouter.delete(
  "/:id/clauses/:clauseId",
  scopeResolverMiddleware,
  requireContractModule,
  contractEditPermission,
  contractTemplatesController.removeClause,
);
