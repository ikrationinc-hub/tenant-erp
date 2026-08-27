import { eventBus } from "../../common/events/bus.js";
import type { ReceiptConfirmedEvent } from "../../common/events/types.js";
import { insertAuditLog } from "../../core/audit/write.js";
import type { TenantTx } from "../../database/get-db.js";
import { insertStockMovement } from "./stock-movements.repository.js";

/**
 * PL-1 (docs/PURCHASE-LIFECYCLE-4DOC.md, ADR 0016): THE stock-writing
 * handler - neither purchase.approved nor invoice.approved has one
 * anymore (a purchase order is intent; a bill is a financial fact;
 * physical stock only exists once the RECEIPT is confirmed). Runs in the
 * SAME transaction as the receipt's Draft->Confirmed status change
 * (common/events/bus.ts: a throw here rolls back the confirmation too).
 *
 * Unlike the superseded invoice.approved handler this replaces, there is
 * no reverse-then-reissue reconciliation: a confirmed receipt is
 * immutable (rule 8 - no re-confirm path exists), so this only ever
 * writes fresh purchase_receipt rows, once, for this one receipt's own
 * lines - never a reversal, never a re-run for the same receiptId.
 */
async function handleReceiptConfirmed(tx: TenantTx, event: ReceiptConfirmedEvent): Promise<void> {
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
      receiptId: event.receiptId,
      createdBy: event.confirmedBy,
    });

    await insertAuditLog(tx, {
      companyId: event.companyId,
      changedBy: event.confirmedBy,
      entity: "stock_movement",
      entityId: movement.id,
      action: "stock_movement.created",
      after: {
        itemId: movement.itemId,
        warehouseId: movement.warehouseId,
        quantity: movement.quantity,
        movementType: movement.movementType,
        receiptId: movement.receiptId,
      },
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
eventBus.on("receipt.confirmed", handleReceiptConfirmed);
