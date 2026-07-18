/**
 * Fiscal year is labeled by the calendar year it STARTS in, not the one it
 * ends in - e.g. fiscalYearStartMonth=4 (April), a document dated Feb 2025
 * falls in the fiscal year that started April 2024, so its fiscal year is
 * 2024, not 2025. All dates are read in UTC, matching how every other
 * timestamptz column in this codebase is handled.
 */
export function computeFiscalYear(date: Date, fiscalYearStartMonth: number): number {
  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();
  return month >= fiscalYearStartMonth ? year : year - 1;
}
