import { Router } from "express";
import { requireModuleEnabled } from "../../common/middleware/require-module-enabled.js";
import { requirePermission } from "../../common/middleware/rbac.js";
import { scopeResolverMiddleware } from "../../common/middleware/scope-resolver.js";
import * as customersController from "./customers.controller.js";

export const customersRouter: Router = Router();

const requireCustomersModule = requireModuleEnabled("customers");
const readPermission = requirePermission("customers.customer.read");
const createPermission = requirePermission("customers.customer.create");
const updatePermission = requirePermission("customers.customer.update");

customersRouter.get("/", scopeResolverMiddleware, requireCustomersModule, readPermission, customersController.list);
customersRouter.get("/options", scopeResolverMiddleware, requireCustomersModule, readPermission, customersController.listOptions);
customersRouter.get("/:id", scopeResolverMiddleware, requireCustomersModule, readPermission, customersController.getById);
customersRouter.post("/", scopeResolverMiddleware, requireCustomersModule, createPermission, customersController.create);
customersRouter.patch("/:id", scopeResolverMiddleware, requireCustomersModule, updatePermission, customersController.update);
customersRouter.delete("/:id", scopeResolverMiddleware, requireCustomersModule, updatePermission, customersController.remove);
customersRouter.patch(
  "/:id/activate",
  scopeResolverMiddleware,
  requireCustomersModule,
  updatePermission,
  customersController.activate,
);
customersRouter.patch(
  "/:id/deactivate",
  scopeResolverMiddleware,
  requireCustomersModule,
  updatePermission,
  customersController.deactivate,
);
