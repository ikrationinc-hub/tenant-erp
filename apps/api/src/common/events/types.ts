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

/**
 * Superseded by ReceiptConfirmedEvent below (PL-1/ADR 0016) - kept only
 * because historical Prompt-22-era stock_movements rows still carry a
 * purchaseInvoiceId that resolves through this shape; no publisher emits
 * "invoice.approved" and no subscriber listens for it anymore.
 */
export interface InvoiceApprovedEvent {
  invoiceId: string;
  purchaseId: string;
  companyId: string;
  branchId: string | null;
  warehouseId: string;
  approvedBy: string;
  items: Array<{ purchaseItemId: string; itemId: string; gradeId: string | null; quantity: string; uomId: string }>;
}

/**
 * PL-1: THE stock-writing trigger. `items` is this ONE receipt's own
 * lines (not the purchase's current items, unlike the superseded
 * invoice.approved shape) - a receipt is immutable once confirmed
 * (rule 8), so there is no reconciliation/re-approval case to represent
 * here, only a single first-and-only write.
 */
export interface ReceiptConfirmedEvent {
  receiptId: string;
  purchaseId: string;
  companyId: string;
  branchId: string | null;
  warehouseId: string;
  confirmedBy: string;
  items: Array<{ purchaseItemId: string; itemId: string; gradeId: string | null; quantity: string; uomId: string }>;
}

export interface EventMap {
  "purchase.approved": PurchaseApprovedEvent;
  "invoice.approved": InvoiceApprovedEvent;
  "receipt.confirmed": ReceiptConfirmedEvent;
}
