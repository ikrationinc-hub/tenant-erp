/**
 * Money is never a JS number anywhere in this form (frontend rule 3 /
 * backend rule 1). These are pure string patterns - no parseFloat, no
 * arithmetic, just keystroke filtering and final-shape validation.
 */
const PARTIAL_NUMERIC_PATTERN = /^-?\d*\.?\d*$/;
export const NUMERIC_STRING_PATTERN = /^-?\d+(\.\d+)?$/;

/** True while the user is mid-typing a number (e.g. "-", "12.", ""), not just once it's complete. */
export function isPartialNumericString(value: string): boolean {
  return PARTIAL_NUMERIC_PATTERN.test(value);
}
