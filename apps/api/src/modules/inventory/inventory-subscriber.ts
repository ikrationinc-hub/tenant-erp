import { eventBus } from "../../common/events/bus.js";
import type { PurchaseApprovedEvent } from "../../common/events/types.js";
import { insertAuditLog } from "../../core/audit/write.js";
import type { TenantTx } from "../../database/get-db.js";
import { insertStockMovement } from "./stock-movements.repository.js";

/** Resolved open question #10: stock moves at Approved, not Posted - FR-108's own wording. One movement per purchase line, in the SAME transaction as the approval (common/events/bus.ts's doc comment: a failure here rolls back the approval too). */
async function handlePurchaseApproved(tx: TenantTx, event: PurchaseApprovedEvent): Promise<void> {
  const movementDate = new Date().toISOString().slice(0, 10);

  for (const item of event.items) {
    const movement = await insertStockMovement(tx, {
      companyId: event.companyId,
      ...(event.branchId ? { branchId: event.branchId } : {}),
      itemId: item.itemId,
      ...(item.gradeId ? { gradeId: item.gradeId } : {}),
      warehouseId: event.warehouseId,
      quantity: item.quantity,
      uomId: item.uomId,
      movementType: "purchase_receipt",
      movementDate,
      referenceType: "purchase_item",
      referenceId: item.purchaseItemId,
      createdBy: event.approvedBy,
    });

    await insertAuditLog(tx, {
      companyId: event.companyId,
      changedBy: event.approvedBy,
      entity: "stock_movement",
      entityId: movement.id,
      action: "stock_movement.created",
      after: { itemId: movement.itemId, warehouseId: movement.warehouseId, quantity: movement.quantity, referenceId: movement.referenceId },
    });
  }
}

/**
 * Registers this module's event subscription as a module-load side effect
 * (app.ts imports this file purely for that effect - `import
 * "./modules/inventory/inventory-subscriber.js"`, no named export used) -
 * NOT a function the caller invokes, because ESM module evaluation is
 * cached/once-per-process while `createApp()` runs once per test file
 * (sometimes several times per file); a callable `register()` invoked
 * from inside `createApp()` would re-register this handler on every call,
 * duplicating every stock movement it ever writes. Importing
 * modules/inventory's own repository here (never modules/purchase's) is
 * the entire coupling between the two modules, and it's one-directional,
 * mediated by common/events' shared types.
 */
eventBus.on("purchase.approved", handlePurchaseApproved);
