import { Router } from "express";
import { requireModuleEnabled } from "../../common/middleware/require-module-enabled.js";
import { requirePermission } from "../../common/middleware/rbac.js";
import { scopeResolverMiddleware } from "../../common/middleware/scope-resolver.js";
import * as suppliersController from "./suppliers.controller.js";

export const suppliersRouter: Router = Router();

const requireSuppliersModule = requireModuleEnabled("suppliers");
const readPermission = requirePermission("suppliers.supplier.read");
const createPermission = requirePermission("suppliers.supplier.create");
const updatePermission = requirePermission("suppliers.supplier.update");

suppliersRouter.get("/", scopeResolverMiddleware, requireSuppliersModule, readPermission, suppliersController.list);
suppliersRouter.get("/options", scopeResolverMiddleware, requireSuppliersModule, readPermission, suppliersController.listOptions);
suppliersRouter.get("/:id", scopeResolverMiddleware, requireSuppliersModule, readPermission, suppliersController.getById);
suppliersRouter.post("/", scopeResolverMiddleware, requireSuppliersModule, createPermission, suppliersController.create);
suppliersRouter.patch("/:id", scopeResolverMiddleware, requireSuppliersModule, updatePermission, suppliersController.update);
suppliersRouter.delete("/:id", scopeResolverMiddleware, requireSuppliersModule, updatePermission, suppliersController.remove);
suppliersRouter.patch(
  "/:id/activate",
  scopeResolverMiddleware,
  requireSuppliersModule,
  updatePermission,
  suppliersController.activate,
);
suppliersRouter.patch(
  "/:id/deactivate",
  scopeResolverMiddleware,
  requireSuppliersModule,
  updatePermission,
  suppliersController.deactivate,
);
