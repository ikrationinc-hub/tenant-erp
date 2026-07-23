import { Router } from "express";
import { requireModuleEnabled } from "../../common/middleware/require-module-enabled.js";
import { requirePermission } from "../../common/middleware/rbac.js";
import { scopeResolverMiddleware } from "../../common/middleware/scope-resolver.js";
import * as purchaseAllocationsController from "./purchase-allocations.controller.js";
import * as purchaseCostsController from "./purchase-costs.controller.js";
import * as purchaseHedgesController from "./purchase-hedges.controller.js";
import * as purchaseItemsController from "./purchase-items.controller.js";
import * as purchaseLmeController from "./purchase-lme.controller.js";
import * as purchaseController from "./purchase.controller.js";

export const purchaseRouter: Router = Router();

const requirePurchaseModule = requireModuleEnabled("purchase");
const readPermission = requirePermission("purchase.po.read");
const createPermission = requirePermission("purchase.po.create");
const updatePermission = requirePermission("purchase.po.update");
const approvePermission = requirePermission("purchase.po.approve");
const postPermission = requirePermission("purchase.po.post");

purchaseRouter.get("/", scopeResolverMiddleware, requirePurchaseModule, readPermission, purchaseController.list);
purchaseRouter.get("/:id", scopeResolverMiddleware, requirePurchaseModule, readPermission, purchaseController.getById);
purchaseRouter.post("/", scopeResolverMiddleware, requirePurchaseModule, createPermission, purchaseController.create);
purchaseRouter.patch("/:id", scopeResolverMiddleware, requirePurchaseModule, updatePermission, purchaseController.update);

// FR-107/FR-108 - each transition its own permission (this task's own
// instruction). Resolved open question #10: approve is where stock moves
// (core/workflow/transitions.ts, purchase.service.ts); post is a pure
// accounting lock (rule 8) with no inventory effect of its own.
purchaseRouter.patch("/:id/approve", scopeResolverMiddleware, requirePurchaseModule, approvePermission, purchaseController.approve);
purchaseRouter.patch("/:id/post", scopeResolverMiddleware, requirePurchaseModule, postPermission, purchaseController.post);

// FR-104 (Sub Tab 2, table D) - items are "one or multiple" per purchase,
// so adding is its own endpoint rather than only a create-time array
// (session (a)'s header+shipment already lets a purchase exist with zero
// items; this is how it gets one, and how it gets more). Same
// create/update permissions as the parent purchase - an item isn't a
// separately grantable capability.
purchaseRouter.post(
  "/:id/items",
  scopeResolverMiddleware,
  requirePurchaseModule,
  createPermission,
  purchaseItemsController.addItem,
);
purchaseRouter.patch(
  "/:id/items/:itemId",
  scopeResolverMiddleware,
  requirePurchaseModule,
  updatePermission,
  purchaseItemsController.updateItem,
);

// Sub Tab 2, table F - resolved open question #3: many reserved customers
// per purchase, so "add" rather than a single field on the purchase itself.
purchaseRouter.post(
  "/:id/allocations",
  scopeResolverMiddleware,
  requirePurchaseModule,
  createPermission,
  purchaseAllocationsController.addAllocation,
);

// Sub Tab 2, table G - resolved open question #4: one flat row per
// purchase, so a single upsert-style PATCH rather than an "add" endpoint.
purchaseRouter.patch(
  "/:id/costs",
  scopeResolverMiddleware,
  requirePurchaseModule,
  updatePermission,
  purchaseCostsController.setAdditionalCosts,
);

// Sub Tab 3, table A - resolved open question #6: lme_records has its own
// lifecycle, independent of the purchase's own status - not gated by
// requireModuleEnabled/draft in any special way beyond the standard
// create permission every "add" endpoint on this router already uses.
purchaseRouter.post(
  "/:id/lme-records",
  scopeResolverMiddleware,
  requirePurchaseModule,
  createPermission,
  purchaseLmeController.addLmeRecord,
);

// Sub Tab 3, table B - resolved open question #8: many hedges per
// purchase, also independent of the purchase's own status.
purchaseRouter.post(
  "/:id/hedges",
  scopeResolverMiddleware,
  requirePurchaseModule,
  createPermission,
  purchaseHedgesController.addHedge,
);
purchaseRouter.patch(
  "/:id/hedges/:hedgeId",
  scopeResolverMiddleware,
  requirePurchaseModule,
  updatePermission,
  purchaseHedgesController.updateStatus,
);
