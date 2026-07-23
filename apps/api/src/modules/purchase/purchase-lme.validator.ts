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
    lmePriceUsd: decimalStringSchema,
    fixingDate: dateStringSchema,
    agreedPremiumPct: decimalStringSchema,
  })
  .strict();
export type AddLmeRecordInput = z.infer<typeof addLmeRecordSchema>;
