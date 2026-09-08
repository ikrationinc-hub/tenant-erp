import { z } from "zod";

const decimalStringSchema = z.string().regex(/^\d+(\.\d+)?$/, "Expected a positive decimal number as a string");

/**
 * Mirrors purchase-items.validator.ts's addPurchaseItemSchema. salesAmountUsd/
 * salesAmountAed are never accepted - server-calculated. salesRateUsd is
 * required here (not optional) since S-3 only supports pricingType='fixed'
 * for now (see sales.validator.ts's own doc comment) - once LME sales
 * pricing exists, this becomes optional/derived the same way Purchase's does.
 */
export const addSalesItemSchema = z
  .object({
    itemId: z.string().uuid(),
    gradeId: z.string().uuid().optional(),
    quantity: decimalStringSchema,
    uomId: z.string().uuid(),
    salesRateUsd: decimalStringSchema,
    exchangeRate: decimalStringSchema,
  })
  .strict();
export type AddSalesItemInput = z.infer<typeof addSalesItemSchema>;

export const updateSalesItemSchema = z
  .object({
    itemId: z.string().uuid().optional(),
    gradeId: z.string().uuid().optional(),
    quantity: decimalStringSchema.optional(),
    uomId: z.string().uuid().optional(),
    salesRateUsd: decimalStringSchema.optional(),
    exchangeRate: decimalStringSchema.optional(),
  })
  .strict();
export type UpdateSalesItemInput = z.infer<typeof updateSalesItemSchema>;

export const salesItemParamsSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
});
