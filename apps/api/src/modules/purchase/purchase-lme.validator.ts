import { z } from "zod";

const decimalStringSchema = z.string().regex(/^\d+(\.\d+)?$/, "Expected a positive decimal number as a string");
const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

/**
 * Sub Tab 3, table A. FR-201/FR-202/FR-203. `finalPurchaseRateUsd` is never
 * accepted - always server-calculated. There's no separate "effective
 * date" input: the price being recorded is effective as of the fixing
 * date itself, so `fixingDate` doubles as market_prices.effective_date
 * when purchase-lme.service.ts calls the PriceSource.
 */
export const addLmeRecordSchema = z
  .object({
    lmeExchangeId: z.string().uuid(),
    metal: z.string().min(1),
    /** Prompt 21 item 3: a categorization field only - no calculation depends on it. Required on every new record (existing records, with no sensible value to backfill to, were left null - schema.ts's doc comment). */
    lmeType: z.enum(["open", "close", "cash"]),
    lmePriceUsd: decimalStringSchema,
    fixingDate: dateStringSchema,
    agreedPremiumPct: decimalStringSchema,
  })
  .strict();
export type AddLmeRecordInput = z.infer<typeof addLmeRecordSchema>;

/**
 * Prompt 23: same full shape as create, not a partial PATCH - an edit
 * re-records a fresh market_prices row the same way create does (never
 * mutating a raw number straight onto lme_records without passing
 * through that ledger first), so every field feeds the recompute
 * regardless of which ones actually changed. Only reachable while
 * purchase-lme.service.ts's isLmeRecordUsedByAnyItem is false for this
 * record.
 */
export const updateLmeRecordSchema = addLmeRecordSchema;
export type UpdateLmeRecordInput = AddLmeRecordInput;

export const lmeRecordIdParamsSchema = z.object({
  id: z.string().uuid(),
  lmeRecordId: z.string().uuid(),
});
