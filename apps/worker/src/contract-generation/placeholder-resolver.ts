import { Decimal } from "decimal.js";

Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

/**
 * C-2 (docs/CONTRACT-MODULE-BUILD.md Part 3): given a context object and a
 * clause's raw text containing {{dotted.tokens}}, resolve every token
 * against the context and substitute it in. A MISSING token is an explicit
 * error (ResolutionError below), never a silent blank - the spec's own
 * words: "a blank where a price belongs is a legal problem."
 *
 * The token namespace (docs/CONTRACT-MODULE-BUILD.md Part 6's open
 * question, proposed here): dotted paths into a context assembled from the
 * contract's own sections plus its linked purchase/sale, e.g.
 * seller.name, buyer.name, commercial.rate, commercial.currency,
 * shipment.port, shipment.eta, payment.terms, payment.dueDate. This is a
 * PROPOSAL, not a client-confirmed list - see this module's own ADR.
 */

export type PlaceholderContextValue = string | number | boolean | null | PlaceholderContext;
export interface PlaceholderContext {
  [key: string]: PlaceholderContextValue;
}

/** Tokens the caller marks as money/quantity get decimal-string formatting (thousands separator, fixed 2dp) instead of verbatim string interpolation - CLAUDE.md rule 1's spirit (never a raw numeric literal in generated output) extended to display formatting: the value must already be a decimal STRING in the context, never a JS number, and is never run through parseFloat/native arithmetic here. */
export interface PlaceholderResolverOptions {
  /** Dotted token paths (e.g. "commercial.rate") that must be formatted as money: thousands-separated, fixed 2 decimal places. */
  moneyTokens?: readonly string[];
}

export class MissingPlaceholderError extends Error {
  constructor(readonly token: string) {
    super(`Missing value for placeholder {{${token}}} - refusing to render a blank where a value belongs`);
    this.name = "MissingPlaceholderError";
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

/** Thousands-separated, fixed 2dp - "8,432.75", never "8432.749999" (decimal.js throughout, never native arithmetic or parseFloat). Value must already be a decimal-shaped string; a non-numeric string here is a caller bug, not a resolver concern. */
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
  /** token -> its resolved, display-ready string value. */
  values: Record<string, string>;
}

/**
 * Resolves every {{token}} referenced in `clauseText` against `context`.
 * Throws MissingPlaceholderError on the FIRST unresolvable token (fail
 * fast - a contract with even one unresolved legal value should never
 * proceed to rendering).
 */
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
