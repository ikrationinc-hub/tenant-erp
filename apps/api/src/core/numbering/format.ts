import { ValidationError } from "../../common/errors/index.js";

export interface FormatDocumentNumberInput {
  pattern: string;
  branchCode: string | undefined;
  fiscalYear: number;
  sequence: number;
  padding: number;
}

/**
 * Token grammar: {BRANCH} -> branch code, {FY} -> fiscal year, and any run
 * of one-or-more zeros e.g. {0000} -> the sequence, zero-padded. The
 * padding WIDTH used is always the `padding` column's value, not the
 * number of zeros written in the token - the token's zero-count is a
 * human-readable convention, not machine-parsed (see number_series's
 * schema.ts doc comment).
 */
export function formatDocumentNumber(input: FormatDocumentNumberInput): string {
  if (input.pattern.includes("{BRANCH}") && !input.branchCode) {
    throw new ValidationError(
      "This number series' pattern requires {BRANCH}, but no branch was given",
    );
  }

  return input.pattern
    .replace(/\{BRANCH\}/g, input.branchCode ?? "")
    .replace(/\{FY\}/g, String(input.fiscalYear))
    .replace(/\{0+\}/g, String(input.sequence).padStart(input.padding, "0"));
}
