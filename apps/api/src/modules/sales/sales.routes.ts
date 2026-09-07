import { Router } from "express";
import { requireModuleEnabled } from "../../common/middleware/require-module-enabled.js";
import { requirePermission } from "../../common/middleware/rbac.js";
import { scopeResolverMiddleware } from "../../common/middleware/scope-resolver.js";
import * as deliveriesController from "./deliveries.controller.js";
import * as salesCostsController from "./sales-costs.controller.js";
import * as salesDashboardController from "./sales-dashboard.controller.js";
import * as salesInvoicesController from "./sales-invoices.controller.js";
import * as salesItemLotsController from "./sales-item-lots.controller.js";
import * as salesItemsController from "./sales-items.controller.js";
import * as salesPaymentsReceivedController from "./sales-payments-received.controller.js";
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
const invoiceCreatePermission = requirePermission("sales.invoice.create");
const invoiceUpdatePermission = requirePermission("sales.invoice.update");
const invoiceApprovePermission = requirePermission("sales.invoice.approve");

salesRouter.get("/", scopeResolverMiddleware, requireSalesModule, readPermission, salesController.list);
// Registered BEFORE "/:id" - a literal path segment, not a nested sub-
// resource of one sale, so this must never be shadowed by the :id param
// route matching "lots-available" as an id (same ordering discipline the
// standalone Receipts/Bills list routers already follow in purchase.routes.ts).
salesRouter.get("/lots-available", scopeResolverMiddleware, requireSalesModule, readPermission, salesItemLotsController.listAvailable);
// S-6 (docs/SALES-MODULE-PLAN.md): the dashboard's own endpoint - also a
// literal path segment, registered before "/:id" for the same reason as
// "/lots-available" above. Reuses sales.order.read (no dedicated
// sales.dashboard.read key - every other Sales list screen has made the
// same call).
salesRouter.get("/dashboard", scopeResolverMiddleware, requireSalesModule, readPermission, salesDashboardController.getDashboard);
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

// S-5 (docs/SALES-MODULE-PLAN.md): the Sales Invoice - own lifecycle
// (Draft -> Approved), own permissions, own numbering. Purely financial,
// no stock/reservation interaction (unlike Delivery) - mirrors
// purchase.routes.ts's /:id/invoices exactly.
salesRouter.post("/:id/invoices", scopeResolverMiddleware, requireSalesModule, invoiceCreatePermission, salesInvoicesController.create);
salesRouter.patch("/:id/invoices/:invoiceId", scopeResolverMiddleware, requireSalesModule, invoiceUpdatePermission, salesInvoicesController.update);
salesRouter.patch(
  "/:id/invoices/:invoiceId/approve",
  scopeResolverMiddleware,
  requireSalesModule,
  invoiceApprovePermission,
  salesInvoicesController.approve,
);
// A sale can have MULTIPLE invoices (partial invoicing) - a real GET list
// here too, same reasoning as deliveries above.
salesRouter.get("/:id/invoices", scopeResolverMiddleware, requireSalesModule, readPermission, salesInvoicesController.list);

/** The standalone "Sales Invoices" list screen - mirrors salesDeliveriesListRouter exactly. */
export const salesInvoicesListRouter: Router = Router();
salesInvoicesListRouter.get("/", scopeResolverMiddleware, requireSalesModule, readPermission, salesInvoicesController.listAll);

/**
 * S-5: Payment Received - unlike Invoice, never nested under a single sale
 * at all (it's scoped to a CUSTOMER, potentially settling invoices across
 * several sales in one record), so its own top-level router from the
 * start, mirroring purchase.routes.ts's own purchasePaymentsRouter
 * exactly. "record" (not "create") is the permission action, matching
 * Purchase Payment's own Manager-tier bar for money actually changing
 * hands (see manifests.ts's doc comment on this permission entry) - here
 * money coming IN rather than going out, same tier reasoning either way.
 */
const receiptRecordPermission = requirePermission("sales.receipt.record");

export const salesPaymentsReceivedRouter: Router = Router();
salesPaymentsReceivedRouter.get("/", scopeResolverMiddleware, requireSalesModule, readPermission, salesPaymentsReceivedController.listAll);
salesPaymentsReceivedRouter.get("/:id", scopeResolverMiddleware, requireSalesModule, readPermission, salesPaymentsReceivedController.getById);
salesPaymentsReceivedRouter.post("/", scopeResolverMiddleware, requireSalesModule, receiptRecordPermission, salesPaymentsReceivedController.create);
salesPaymentsReceivedRouter.get(
  "/outstanding-invoices/:customerId",
  scopeResolverMiddleware,
  requireSalesModule,
  readPermission,
  salesPaymentsReceivedController.listOutstandingInvoices,
);
