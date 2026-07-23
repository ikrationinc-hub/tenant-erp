/**
 * Shared event payload types - the ONLY thing a publisher and its
 * subscribers may depend on in common, so neither module ever imports the
 * other directly (this task's own instruction: "Modules must NOT call each
 * other directly"). modules/purchase publishes; modules/inventory
 * subscribes; both import from here, never from one another.
 */
export interface PurchaseApprovedEvent {
  purchaseId: string;
  companyId: string;
  branchId: string | null;
  warehouseId: string;
  approvedBy: string;
  /** A snapshot of what to move, gathered by the publisher BEFORE emitting - a subscriber must never reach back into another module's tables to find out what happened. `purchaseItemId` is the specific line the movement traces back to (stock_movements.reference_id); `itemId` is the traded item/master. */
  items: Array<{ purchaseItemId: string; itemId: string; gradeId: string | null; quantity: string; uomId: string }>;
}

export interface EventMap {
  "purchase.approved": PurchaseApprovedEvent;
}
