import { z } from "zod";

/**
 * Decimal amounts travel the wire as strings, never JS numbers (CLAUDE.md
 * rule 1 / rule 3 - "the API returns numeric as strings, never parseFloat
 * them" applies symmetrically to what it accepts). Shape-only here;
 * positivity is a business rule checked in purchase-items.service.ts
 * against the parsed `Decimal`, not a zod refinement.
 */
const decimalStringSchema = z.string().regex(/^\d+(\.\d+)?$/, "Expected a positive decimal number as a string");

/**
 * FR-104 (Sub Tab 2, table D) + Pricing (table E), attached per item
 * (resolved open questions #1/#2). `purchaseAmountUsd`/`purchaseAmountAed`
 * are never accepted - FR-105/FR-106's calculated fields, always
 * server-derived.
 */
export const addPurchaseItemSchema = z
  .object({
    itemId: z.string().uuid(),
    gradeId: z.string().uuid().optional(),
    quantity: decimalStringSchema,
    uomId: z.string().uuid(),
    purchaseRateUsd: decimalStringSchema,
    exchangeRate: decimalStringSchema,
  })
  .strict();
export type AddPurchaseItemInput = z.infer<typeof addPurchaseItemSchema>;

export const updatePurchaseItemSchema = z
  .object({
    itemId: z.string().uuid().optional(),
    gradeId: z.string().uuid().optional(),
    quantity: decimalStringSchema.optional(),
    uomId: z.string().uuid().optional(),
    purchaseRateUsd: decimalStringSchema.optional(),
    exchangeRate: decimalStringSchema.optional(),
  })
  .strict();
export type UpdatePurchaseItemInput = z.infer<typeof updatePurchaseItemSchema>;

export const purchaseItemParamsSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
});
