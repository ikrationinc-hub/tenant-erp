import { Router } from "express";
import { requireModuleEnabled } from "../../common/middleware/require-module-enabled.js";
import { requirePermission } from "../../common/middleware/rbac.js";
import { scopeResolverMiddleware } from "../../common/middleware/scope-resolver.js";
import * as purchaseAllocationsController from "./purchase-allocations.controller.js";
import * as purchaseCostsController from "./purchase-costs.controller.js";
import * as purchaseHedgesController from "./purchase-hedges.controller.js";
import * as purchaseBillsController from "./purchase-bills.controller.js";
import * as purchaseItemsController from "./purchase-items.controller.js";
import * as purchaseLmeController from "./purchase-lme.controller.js";
import * as purchaseReceiptsController from "./purchase-receipts.controller.js";
import * as purchasePaymentsController from "./purchase-payments.controller.js";
import * as purchaseController from "./purchase.controller.js";

export const purchaseRouter: Router = Router();

const requirePurchaseModule = requireModuleEnabled("purchase");
const readPermission = requirePermission("purchase.po.read");
const createPermission = requirePermission("purchase.po.create");
const updatePermission = requirePermission("purchase.po.update");
const issuePermission = requirePermission("purchase.po.issue");
const cancelPermission = requirePermission("purchase.po.cancel");
const invoiceCreatePermission = requirePermission("purchase.invoice.create");
const invoiceUpdatePermission = requirePermission("purchase.invoice.update");
const invoiceApprovePermission = requirePermission("purchase.invoice.approve");
const receiptCreatePermission = requirePermission("purchase.receipt.create");
const receiptConfirmPermission = requirePermission("purchase.receipt.confirm");

purchaseRouter.get("/", scopeResolverMiddleware, requirePurchaseModule, readPermission, purchaseController.list);
purchaseRouter.get("/:id", scopeResolverMiddleware, requirePurchaseModule, readPermission, purchaseController.getById);
purchaseRouter.post("/", scopeResolverMiddleware, requirePurchaseModule, createPermission, purchaseController.create);
purchaseRouter.patch("/:id", scopeResolverMiddleware, requirePurchaseModule, updatePermission, purchaseController.update);

// PL-3 (docs/PURCHASE-LIFECYCLE-4DOC.md, ADR 0018) - each transition its
// own permission. "approve"/"post" are gone: issue commits the PO to the
// supplier (core/workflow/transitions.ts, purchase.service.ts); cancel
// kills an unfulfilled PO before anything's been received/billed against
// it. "Closed" has no route at all - it's derived and automatic
// (purchase.service.ts's maybeAutoClosePurchase), never user-invoked.
purchaseRouter.patch("/:id/issue", scopeResolverMiddleware, requirePurchaseModule, issuePermission, purchaseController.issue);
purchaseRouter.patch("/:id/cancel", scopeResolverMiddleware, requirePurchaseModule, cancelPermission, purchaseController.cancel);

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
// Prompt 23: edit/remove, same po.update permission as everything else on
// this sub-resource - gated Draft-only by assertDraft, same as add.
purchaseRouter.patch(
  "/:id/allocations/:allocationId",
  scopeResolverMiddleware,
  requirePurchaseModule,
  updatePermission,
  purchaseAllocationsController.updateAllocation,
);
purchaseRouter.delete(
  "/:id/allocations/:allocationId",
  scopeResolverMiddleware,
  requirePurchaseModule,
  updatePermission,
  purchaseAllocationsController.removeAllocation,
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
// Prompt 23: edit/remove - purchase-lme.service.ts locks a record once any
// item has snapshotted its rate (isLmeRecordUsedByAnyItem), regardless of
// the purchase's own status - same non-gating as add above.
purchaseRouter.patch(
  "/:id/lme-records/:lmeRecordId",
  scopeResolverMiddleware,
  requirePurchaseModule,
  updatePermission,
  purchaseLmeController.updateLmeRecord,
);
purchaseRouter.delete(
  "/:id/lme-records/:lmeRecordId",
  scopeResolverMiddleware,
  requirePurchaseModule,
  updatePermission,
  purchaseLmeController.removeLmeRecord,
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

// PL-2 (docs/PURCHASE-LIFECYCLE-4DOC.md, ADR 0017): the Bill - own
// lifecycle, own permissions (create/update/approve, not the purchase's
// po.* ones). Renamed internally from Prompt 22's "supplier invoice"
// (purchase-bills.*), but the ROUTE PATH, PARAM NAME, and PERMISSION KEYS
// are deliberately kept as /invoices, :invoiceId, purchase.invoice.* -
// this prompt is backend-only; PL-4 does the coordinated REST-surface +
// frontend cutover to Bill vocabulary. No GET list/byId of its own, same
// convention as items/allocations/lme-records/hedges - the full set comes
// back via GET /:id (purchase.service.ts's getById).
purchaseRouter.post(
  "/:id/invoices",
  scopeResolverMiddleware,
  requirePurchaseModule,
  invoiceCreatePermission,
  purchaseBillsController.create,
);
purchaseRouter.patch(
  "/:id/invoices/:invoiceId",
  scopeResolverMiddleware,
  requirePurchaseModule,
  invoiceUpdatePermission,
  purchaseBillsController.update,
);
purchaseRouter.patch(
  "/:id/invoices/:invoiceId/approve",
  scopeResolverMiddleware,
  requirePurchaseModule,
  invoiceApprovePermission,
  purchaseBillsController.approve,
);
// PL-4: the itemized per-purchase bill list (with nested items) - a real
// GET, unlike the header-only invoices array embedded in GET /:id. The
// Bill form's "default to un-billed qty" needs each bill's own line
// items, not just the purchase-level billedStatus aggregate.
purchaseRouter.get(
  "/:id/invoices",
  scopeResolverMiddleware,
  requirePurchaseModule,
  readPermission,
  purchaseBillsController.list,
);

// PL-1 (docs/PURCHASE-LIFECYCLE-4DOC.md): the Purchase Receipt - its own
// lifecycle (Draft -> Confirmed), own permissions, own numbering. This is
// where stock actually moves (purchase-receipts.service.ts's confirm),
// superseding invoice-approval-moves-stock (ADR 0015 -> ADR 0016). Has a
// real GET list (unlike items/allocations/lme-records/hedges/invoices)
// since a purchase can have MULTIPLE receipts and the fulfilment strip
// needs to enumerate them, not just see the latest one via GET /:id.
purchaseRouter.get(
  "/:id/receipts",
  scopeResolverMiddleware,
  requirePurchaseModule,
  readPermission,
  purchaseReceiptsController.list,
);
purchaseRouter.post(
  "/:id/receipts",
  scopeResolverMiddleware,
  requirePurchaseModule,
  receiptCreatePermission,
  purchaseReceiptsController.create,
);
purchaseRouter.patch(
  "/:id/receipts/:receiptId/confirm",
  scopeResolverMiddleware,
  requirePurchaseModule,
  receiptConfirmPermission,
  purchaseReceiptsController.confirm,
);

/**
 * PL-4: the standalone "Purchase Receipts" and "Purchase Bills" list
 * screens (Zoho's own top-level nav items for these documents) need a
 * cross-purchase GET spanning every purchase in the company - `purchaseRouter`
 * itself can't host that at a path like "/receipts" or "/bills" without
 * colliding with its own "/:id" param route (Express would match "id" =
 * "receipts"). Two small standalone routers instead, mounted at their own
 * top-level paths in app.ts ("/purchase-receipts", "/purchase-bills") -
 * same requirePurchaseModule/readPermission gating as everything else here
 * (reusing purchase.po.read rather than adding new purchase.receipt.read/
 * purchase.invoice.read permissions, since the per-purchase routes above
 * already gate reads the same way).
 */
export const purchaseReceiptsListRouter: Router = Router();
purchaseReceiptsListRouter.get("/", scopeResolverMiddleware, requirePurchaseModule, readPermission, purchaseReceiptsController.listAll);

export const purchaseBillsListRouter: Router = Router();
purchaseBillsListRouter.get("/", scopeResolverMiddleware, requirePurchaseModule, readPermission, purchaseBillsController.listAll);

/**
 * PL-5: Payment - unlike Receipt/Bill, never nested under a single
 * purchase at all (it's scoped to a SUPPLIER, potentially settling bills
 * across several purchases in one record), so it was never going to fit
 * under purchaseRouter's own "/:id/..." shape to begin with - its own
 * top-level router from the start, not a later standalone-list carve-out
 * like the two above. "record" (not "create") is the permission action -
 * seed-roles.ts's own Manager-tier bar for money actually leaving the
 * company, see manifests.ts's doc comment on this permission entry.
 */
const paymentRecordPermission = requirePermission("purchase.payment.record");

export const purchasePaymentsRouter: Router = Router();
purchasePaymentsRouter.get("/", scopeResolverMiddleware, requirePurchaseModule, readPermission, purchasePaymentsController.listAll);
purchasePaymentsRouter.get("/:id", scopeResolverMiddleware, requirePurchaseModule, readPermission, purchasePaymentsController.getById);
purchasePaymentsRouter.post("/", scopeResolverMiddleware, requirePurchaseModule, paymentRecordPermission, purchasePaymentsController.create);
purchasePaymentsRouter.get(
  "/outstanding-bills/:supplierId",
  scopeResolverMiddleware,
  requirePurchaseModule,
  readPermission,
  purchasePaymentsController.listOutstandingBills,
);
