import { Decimal } from "decimal.js";
import { ValidationError } from "../../common/errors/index.js";

Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

/**
 * Mirrors apps/worker/src/contract-generation/placeholder-resolver.ts
 * EXACTLY - apps/api needs this for the "preview" endpoint (item 5:
 * "resolve placeholders against this contract's data" - a read-only
 * preview, no document generation), and apps/worker isn't set up as an
 * importable workspace package (no exports/main/types pointing at a build
 * output), the same reason C-1's clause-promotion job keeps its own
 * tenant-schema mirror rather than reaching into apps/api's src/. Keep
 * both copies in sync if the token-resolution algorithm ever changes -
 * the actual document GENERATION (DOCX/PDF) still only ever runs in the
 * worker (CLAUDE.md: "document generation runs in the worker, never the
 * API"); this copy is resolution-only, used for preview text.
 */

export type PlaceholderContextValue = string | number | boolean | null | PlaceholderContext;
export interface PlaceholderContext {
  [key: string]: PlaceholderContextValue;
}

export interface PlaceholderResolverOptions {
  moneyTokens?: readonly string[];
}

/**
 * A ValidationError (422), not a bare Error - this is a client-fixable
 * content problem (a clause referencing a token this contract's context
 * doesn't have, e.g. a typo'd token or a placeholder used outside a real
 * generation flow), never a server fault. Before this fix it fell through
 * to the generic error handler as an unhandled 500 with a raw stack
 * trace - every caller (addClause/preview/generate) now surfaces this as
 * a clean, actionable 422 instead.
 */
export class MissingPlaceholderError extends ValidationError {
  readonly token: string;

  constructor(token: string) {
    super(`Missing value for placeholder {{${token}}} - refusing to render a blank where a value belongs`, { token });
    this.token = token;
  }
}

const TOKEN_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export function extractPlaceholderTokens(clauseText: string): string[] {
  const tokens = new Set<string>();
  for (const match of clauseText.matchAll(TOKEN_PATTERN)) {
    const token = match[1];
    if (token) {
      tokens.add(token);
    }
  }
  return [...tokens];
}

function resolveDottedPath(context: PlaceholderContext, token: string): PlaceholderContextValue | undefined {
  const segments = token.split(".");
  let current: PlaceholderContextValue | undefined = context;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function formatMoney(rawValue: string): string {
  const decimal = new Decimal(rawValue);
  const fixed = decimal.toFixed(2);
  const [whole, fraction] = fixed.split(".");
  const withSeparators = (whole ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${withSeparators}.${fraction}`;
}

function stringifyValue(token: string, value: PlaceholderContextValue, isMoneyToken: boolean): string {
  if (value === null) {
    throw new MissingPlaceholderError(token);
  }
  if (typeof value === "object") {
    throw new Error(`Placeholder {{${token}}} resolved to an object, not a leaf value - check the token path`);
  }
  if (isMoneyToken) {
    return formatMoney(String(value));
  }
  return String(value);
}

export interface ResolvedPlaceholders {
  values: Record<string, string>;
}

export function resolvePlaceholders(
  clauseText: string,
  context: PlaceholderContext,
  options: PlaceholderResolverOptions = {},
): ResolvedPlaceholders {
  const moneyTokenSet = new Set(options.moneyTokens ?? []);
  const tokens = extractPlaceholderTokens(clauseText);
  const values: Record<string, string> = {};

  for (const token of tokens) {
    const resolved = resolveDottedPath(context, token);
    if (resolved === undefined) {
      throw new MissingPlaceholderError(token);
    }
    values[token] = stringifyValue(token, resolved, moneyTokenSet.has(token));
  }

  return { values };
}
