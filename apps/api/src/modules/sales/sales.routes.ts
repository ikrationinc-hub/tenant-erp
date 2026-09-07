import { Router } from "express";
import { requireModuleEnabled } from "../../common/middleware/require-module-enabled.js";
import { requirePermission } from "../../common/middleware/rbac.js";
import { scopeResolverMiddleware } from "../../common/middleware/scope-resolver.js";
import * as deliveriesController from "./deliveries.controller.js";
import * as salesCostsController from "./sales-costs.controller.js";
import * as salesItemLotsController from "./sales-item-lots.controller.js";
import * as salesItemsController from "./sales-items.controller.js";
import * as salesController from "./sales.controller.js";

export const salesRouter: Router = Router();

const requireSalesModule = requireModuleEnabled("sales");
const readPermission = requirePermission("sales.order.read");
const createPermission = requirePermission("sales.order.create");
const updatePermission = requirePermission("sales.order.update");
const approvePermission = requirePermission("sales.order.approve");
const cancelPermission = requirePermission("sales.order.cancel");
const deliveryCreatePermission = requirePermission("sales.delivery.create");
const deliveryConfirmPermission = requirePermission("sales.delivery.confirm");

salesRouter.get("/", scopeResolverMiddleware, requireSalesModule, readPermission, salesController.list);
// Registered BEFORE "/:id" - a literal path segment, not a nested sub-
// resource of one sale, so this must never be shadowed by the :id param
// route matching "lots-available" as an id (same ordering discipline the
// standalone Receipts/Bills list routers already follow in purchase.routes.ts).
salesRouter.get("/lots-available", scopeResolverMiddleware, requireSalesModule, readPermission, salesItemLotsController.listAvailable);
salesRouter.get("/:id", scopeResolverMiddleware, requireSalesModule, readPermission, salesController.getById);
salesRouter.post("/", scopeResolverMiddleware, requireSalesModule, createPermission, salesController.create);
salesRouter.patch("/:id", scopeResolverMiddleware, requireSalesModule, updatePermission, salesController.update);

// S-3 (docs/SALES-MODULE-PLAN.md): each transition its own permission,
// mirroring purchase.routes.ts's issue/cancel shape. "Closed" has no
// route - it's derived/automatic once S-4/S-5 exist, never user-invoked.
salesRouter.patch("/:id/approve", scopeResolverMiddleware, requireSalesModule, approvePermission, salesController.approve);
salesRouter.patch("/:id/cancel", scopeResolverMiddleware, requireSalesModule, cancelPermission, salesController.cancel);

// FR-104: items are "one or multiple" per sale - own endpoint, same
// create/update permissions as the parent sale.
salesRouter.post("/:id/items", scopeResolverMiddleware, requireSalesModule, createPermission, salesItemsController.addItem);
salesRouter.patch("/:id/items/:itemId", scopeResolverMiddleware, requireSalesModule, updatePermission, salesItemsController.updateItem);

// The lot-picking sub-resource - S-3's genuinely new concept (see
// database/tenant/schema.ts's own doc comment on why this is NOT
// purchase_allocations' sibling). Same create/update permissions as items.
salesRouter.post(
  "/:id/items/:itemId/lots",
  scopeResolverMiddleware,
  requireSalesModule,
  createPermission,
  salesItemLotsController.addLot,
);
salesRouter.delete(
  "/:id/items/:itemId/lots/:lotId",
  scopeResolverMiddleware,
  requireSalesModule,
  updatePermission,
  salesItemLotsController.removeLot,
);

// One flat row per sale - a single upsert-style PATCH, mirrors
// purchase.routes.ts's /:id/costs.
salesRouter.patch("/:id/costs", scopeResolverMiddleware, requireSalesModule, updatePermission, salesCostsController.setAdditionalCosts);

// S-4 (docs/SALES-MODULE-PLAN.md): Delivery - its own lifecycle (Draft ->
// Confirmed), own permissions, own numbering. This is where stock actually
// leaves (deliveries.service.ts's confirm, via core/inventory-lots'
// consumeReservation) - mirrors purchase.routes.ts's /:id/receipts exactly.
// A sale can have MULTIPLE deliveries (partial), so a real GET list here
// too, not just via GET /:id.
salesRouter.get("/:id/deliveries", scopeResolverMiddleware, requireSalesModule, readPermission, deliveriesController.list);
salesRouter.post("/:id/deliveries", scopeResolverMiddleware, requireSalesModule, deliveryCreatePermission, deliveriesController.create);
salesRouter.patch(
  "/:id/deliveries/:deliveryId/confirm",
  scopeResolverMiddleware,
  requireSalesModule,
  deliveryConfirmPermission,
  deliveriesController.confirm,
);

/**
 * The standalone "Deliveries" list screen (Zoho's own top-level nav item
 * shape) needs a cross-sale GET spanning every sale in the company -
 * `salesRouter` itself can't host that at a path like "/deliveries"
 * without colliding with its own "/:id" param route. A small standalone
 * router instead, mounted at its own top-level path in app.ts
 * ("/sales-deliveries"), same requireSalesModule/readPermission gating as
 * everything else here - mirrors purchase.routes.ts's own
 * purchaseReceiptsListRouter precedent exactly.
 */
export const salesDeliveriesListRouter: Router = Router();
salesDeliveriesListRouter.get("/", scopeResolverMiddleware, requireSalesModule, readPermission, deliveriesController.listAll);
