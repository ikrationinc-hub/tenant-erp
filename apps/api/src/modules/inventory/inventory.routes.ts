import { Router } from "express";
import { requireModuleEnabled } from "../../common/middleware/require-module-enabled.js";
import { requirePermission } from "../../common/middleware/rbac.js";
import { scopeResolverMiddleware } from "../../common/middleware/scope-resolver.js";
import * as inventoryController from "./inventory.controller.js";

export const inventoryRouter: Router = Router();

const requireInventoryModule = requireModuleEnabled("inventory");
const readPermission = requirePermission("inventory.stock.read");

// Read-only over the API (no PATCH/DELETE anywhere in this module) - a
// correction is a new, offsetting movement, never an edit to history,
// same principle as posted-document immutability (rule 8).

inventoryRouter.get("/balances", scopeResolverMiddleware, requireInventoryModule, readPermission, inventoryController.balances);
inventoryRouter.get("/movements", scopeResolverMiddleware, requireInventoryModule, readPermission, inventoryController.movements);
inventoryRouter.get(
  "/movements/:itemId/:warehouseId",
  scopeResolverMiddleware,
  requireInventoryModule,
  readPermission,
  inventoryController.movementsForBalance,
);
