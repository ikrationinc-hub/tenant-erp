import { semantic, slate, steelCobalt } from "../../theme/palette";

/**
 * Per-domain status -> color maps consumed by StatusTag. Real CSS hex
 * values (not AntD Tag preset names like "blue"/"green") since StatusTag
 * renders a plain colored bar, not a Tag. Purchase and Invoice don't share
 * a status vocabulary today, so each gets its own map rather than one
 * merged lookup.
 */

export const PURCHASE_STATUS_COLORS: Record<string, string> = {
  draft: slate[400],
  issued: steelCobalt.base,
  closed: semantic.success,
  cancelled: semantic.error,
};

export const INVOICE_STATUS_COLORS: Record<string, string> = {
  draft: slate[400],
  approved: semantic.success,
  reversed: semantic.error,
  // PL-5: a bill auto-transitions here once fully paid (purchase-payments.
  // service.ts) - steelCobalt so "Paid" (a Payment-driven terminal state)
  // reads distinctly from "Approved" (success green) rather than the same
  // color meaning two different things.
  paid: steelCobalt.base,
};

/** Bills share the invoice status vocabulary (draft/approved/reversed) - PL-2's wire shape kept the "invoice" name, this is that same status set under the Bill's own name for PL-4's standalone list screen. */
export const BILL_STATUS_COLORS: Record<string, string> = INVOICE_STATUS_COLORS;

export const RECEIPT_STATUS_COLORS: Record<string, string> = {
  draft: slate[400],
  confirmed: semantic.success,
  reversed: semantic.error,
};

export const USER_STATUS_COLORS: Record<string, string> = {
  invited: semantic.warning,
  active: semantic.success,
  suspended: semantic.error,
};
