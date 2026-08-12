import { eventBus } from "../../common/events/bus.js";
import type { InvoiceApprovedEvent } from "../../common/events/types.js";
import { parseMoney, roundRate } from "../../common/money/decimal.js";
import { insertAuditLog } from "../../core/audit/write.js";
import type { TenantTx } from "../../database/get-db.js";
import { insertStockMovement, listActiveReceiptsForInvoice } from "./stock-movements.repository.js";

/**
 * Prompt 22 Part 3/4: THE stock-writing handler - purchase.approved no
 * longer has one (a purchase order is intent, it never moves stock).
 * Runs on EVERY invoice.approved, first approval and every re-approval
 * alike, in the SAME transaction as the invoice's status change (common/
 * events/bus.ts: a throw here rolls back the approval too). Two-phase,
 * always in this order:
 *
 *   1. Reverse whatever this invoice's PREVIOUS approval(s) still have
 *      active (a no-op on a genuine first approval - there's nothing to
 *      reverse yet). NEVER an UPDATE/DELETE of the original row (rule 8's
 *      spirit, append-only ledger) - a NEW purchase_reversal row,
 *      negative, pointing back at what it offsets via
 *      reversal_of_movement_id.
 *   2. Write a fresh purchase_receipt for every one of the purchase's
 *      CURRENT items.
 *
 * This uniform "reverse-then-reissue" shape is deliberately not a smart
 * per-item diff (skip items that didn't change) - Part 4 asks for
 * reconciliation on ANY stock-relevant edit, and full reverse+reissue is
 * correct regardless of what specifically changed (an item added,
 * removed, or resized), never assumes what changed, and is exactly as
 * simple on a first approval as on a tenth re-approval.
 */
async function handleInvoiceApproved(tx: TenantTx, event: InvoiceApprovedEvent): Promise<void> {
  const movementDate = new Date().toISOString().slice(0, 10);

  const activeReceipts = await listActiveReceiptsForInvoice(tx, event.companyId, event.invoiceId);
  for (const receipt of activeReceipts) {
    const reversalQuantity = roundRate(parseMoney(receipt.quantity).negated());
    const reversal = await insertStockMovement(tx, {
      companyId: event.companyId,
      ...(receipt.branchId ? { branchId: receipt.branchId } : {}),
      itemId: receipt.itemId,
      ...(receipt.gradeId ? { gradeId: receipt.gradeId } : {}),
      warehouseId: receipt.warehouseId,
      quantity: reversalQuantity,
      uomId: receipt.uomId,
      movementType: "purchase_reversal",
      movementDate,
      referenceType: receipt.referenceType,
      referenceId: receipt.referenceId,
      purchaseInvoiceId: event.invoiceId,
      reversalOfMovementId: receipt.id,
      createdBy: event.approvedBy,
    });

    await insertAuditLog(tx, {
      companyId: event.companyId,
      changedBy: event.approvedBy,
      entity: "stock_movement",
      entityId: reversal.id,
      action: "stock_movement.created",
      after: {
        itemId: reversal.itemId,
        warehouseId: reversal.warehouseId,
        quantity: reversal.quantity,
        movementType: reversal.movementType,
        reversalOfMovementId: reversal.reversalOfMovementId,
      },
    });
  }

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
      purchaseInvoiceId: event.invoiceId,
      createdBy: event.approvedBy,
    });

    await insertAuditLog(tx, {
      companyId: event.companyId,
      changedBy: event.approvedBy,
      entity: "stock_movement",
      entityId: movement.id,
      action: "stock_movement.created",
      after: {
        itemId: movement.itemId,
        warehouseId: movement.warehouseId,
        quantity: movement.quantity,
        movementType: movement.movementType,
        purchaseInvoiceId: movement.purchaseInvoiceId,
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
eventBus.on("invoice.approved", handleInvoiceApproved);
