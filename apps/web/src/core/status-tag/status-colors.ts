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
  approved: steelCobalt.base,
  posted: semantic.success,
};

export const INVOICE_STATUS_COLORS: Record<string, string> = {
  draft: slate[400],
  approved: semantic.success,
  reversed: semantic.error,
};

export const USER_STATUS_COLORS: Record<string, string> = {
  invited: semantic.warning,
  active: semantic.success,
  suspended: semantic.error,
};
