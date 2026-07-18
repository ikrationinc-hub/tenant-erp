import { Router, type RequestHandler } from "express";
import { requireModuleEnabled } from "../../common/middleware/require-module-enabled.js";
import { requirePermission } from "../../common/middleware/rbac.js";
import { scopeResolverMiddleware } from "../../common/middleware/scope-resolver.js";

export interface MasterRouteHandlers {
  list: RequestHandler;
  getById: RequestHandler;
  create: RequestHandler;
  update: RequestHandler;
  activate: RequestHandler;
  deactivate: RequestHandler;
}

/**
 * The routes half of the generic master-data pattern. No hard DELETE
 * route - CLAUDE.md rule 8 ("no hard deletes"); deactivate (PATCH
 * .../:id/deactivate) is how a master record stops being offered without
 * breaking rows that already reference it. activate/deactivate are gated
 * by the same `update` permission as PATCH /:id - they're a specific kind
 * of edit, not a distinct capability a role would grant separately.
 */
export function createMasterRouter(entity: string, controller: MasterRouteHandlers): Router {
  const router = Router();
  const requireMastersModule = requireModuleEnabled("masters");
  const readPermission = requirePermission(`masters.${entity}.read`);
  const createPermission = requirePermission(`masters.${entity}.create`);
  const updatePermission = requirePermission(`masters.${entity}.update`);

  router.get("/", scopeResolverMiddleware, requireMastersModule, readPermission, controller.list);
  router.get("/:id", scopeResolverMiddleware, requireMastersModule, readPermission, controller.getById);
  router.post("/", scopeResolverMiddleware, requireMastersModule, createPermission, controller.create);
  router.patch("/:id", scopeResolverMiddleware, requireMastersModule, updatePermission, controller.update);
  router.patch("/:id/activate", scopeResolverMiddleware, requireMastersModule, updatePermission, controller.activate);
  router.patch("/:id/deactivate", scopeResolverMiddleware, requireMastersModule, updatePermission, controller.deactivate);

  return router;
}
