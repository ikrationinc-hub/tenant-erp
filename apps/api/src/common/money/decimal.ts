import { Decimal } from "decimal.js";

// The one place decimal.js's global config is touched (docs/adr/0012-money-rounding.md)
// - round half up, confirmed with the user over banker's rounding.
Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

export type { Decimal };

/** Repository boundary: parse a `numeric` column's driver string to `Decimal` immediately (CLAUDE.md rule 1) - never hold a raw numeric string past this point. */
export function parseMoney(raw: string): Decimal {
  return new Decimal(raw);
}

/** For `numeric(18,2)` columns (USD/AED amounts) - rounds the given full-precision `Decimal` to 2 places, half up. */
export function roundAmount(value: Decimal): string {
  return value.toFixed(2);
}

/** For `numeric(18,6)` columns (unit rates, quantities, exchange rates, premiums) - rounds to 6 places, half up. */
export function roundRate(value: Decimal): string {
  return value.toFixed(6);
}
