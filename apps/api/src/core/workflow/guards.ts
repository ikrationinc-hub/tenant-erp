import { ConflictError } from "../../common/errors/index.js";

/**
 * The reusable half of "an approved/posted document must represent real
 * goods/value" - an ERP-wide invariant, not Purchase-specific (Sales will
 * need the identical shape for its own allocations once it's built).
 * Callers supply their own line type and their own per-line validity
 * check (what makes a line "valid" is domain-specific and stays in the
 * calling module, e.g. purchase.service.ts's validatePurchaseItemForApproval);
 * this only owns the "empty, or any line invalid" control flow, and stops
 * at the first failing line so the caller gets one specific reason, not
 * a batch of every violation at once.
 */
export function requireAtLeastOneValidLine<TLine>(
  lines: TLine[],
  validateLine: (line: TLine) => string | undefined,
  emptyMessage: string,
): void {
  if (lines.length === 0) {
    throw new ConflictError(emptyMessage);
  }
  for (const line of lines) {
    const reason = validateLine(line);
    if (reason) {
      throw new ConflictError(reason);
    }
  }
}
