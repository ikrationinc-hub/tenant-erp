import { z } from "zod";

const amountStringSchema = z.string().regex(/^\d+(\.\d+)?$/, "Expected a non-negative decimal number as a string");

/** Mirrors purchase-costs.validator.ts's upsertAdditionalCostsSchema - a flat, one-row-per-sale total, no per-item allocation. All optional - PATCH touches only what it sends, upserting the row on first use. */
export const upsertSalesAdditionalCostsSchema = z
  .object({
    freight: amountStringSchema.optional(),
    insurance: amountStringSchema.optional(),
    customs: amountStringSchema.optional(),
    otherCharges: amountStringSchema.optional(),
  })
  .strict();
export type UpsertSalesAdditionalCostsInput = z.infer<typeof upsertSalesAdditionalCostsSchema>;
