import { z } from "zod";

const amountStringSchema = z.string().regex(/^\d+(\.\d+)?$/, "Expected a non-negative decimal number as a string");

/**
 * Sub Tab 2, table G - resolved open question #4: a flat, one-row-per-purchase
 * total, no per-item allocation. All optional (spec's Mandatory column is
 * "No" throughout) - PATCH touches only what it sends, upserting the row on
 * first use. Field keys match core/field-engine/defaults.ts's Tier-2
 * entries verbatim (`otherCharges`/`otherCharges2`/`otherCharges3`) -
 * renaming their LABEL via PATCH /field-definitions/:id never touches this
 * schema.
 */
export const upsertAdditionalCostsSchema = z
  .object({
    freight: amountStringSchema.optional(),
    insurance: amountStringSchema.optional(),
    customs: amountStringSchema.optional(),
    otherCharges: amountStringSchema.optional(),
    otherCharges2: amountStringSchema.optional(),
    otherCharges3: amountStringSchema.optional(),
  })
  .strict();
export type UpsertAdditionalCostsInput = z.infer<typeof upsertAdditionalCostsSchema>;
