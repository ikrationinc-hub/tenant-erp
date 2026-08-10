import { Router } from "express";
import { requireModuleEnabled } from "../../common/middleware/require-module-enabled.js";
import { requirePermission } from "../../common/middleware/rbac.js";
import { scopeResolverMiddleware } from "../../common/middleware/scope-resolver.js";
import * as brokersController from "./brokers.controller.js";

export const brokersRouter: Router = Router();

const requireBrokersModule = requireModuleEnabled("brokers");
const readPermission = requirePermission("brokers.broker.read");
const createPermission = requirePermission("brokers.broker.create");
const updatePermission = requirePermission("brokers.broker.update");

brokersRouter.get("/", scopeResolverMiddleware, requireBrokersModule, readPermission, brokersController.list);
brokersRouter.get("/options", scopeResolverMiddleware, requireBrokersModule, readPermission, brokersController.listOptions);
brokersRouter.get("/:id", scopeResolverMiddleware, requireBrokersModule, readPermission, brokersController.getById);
brokersRouter.post("/", scopeResolverMiddleware, requireBrokersModule, createPermission, brokersController.create);
brokersRouter.patch("/:id", scopeResolverMiddleware, requireBrokersModule, updatePermission, brokersController.update);
brokersRouter.delete("/:id", scopeResolverMiddleware, requireBrokersModule, updatePermission, brokersController.remove);
brokersRouter.patch("/:id/activate", scopeResolverMiddleware, requireBrokersModule, updatePermission, brokersController.activate);
brokersRouter.patch("/:id/deactivate", scopeResolverMiddleware, requireBrokersModule, updatePermission, brokersController.deactivate);
