import { z } from "zod";

const decimalStringSchema = z.string().regex(/^\d+(\.\d+)?$/, "Expected a positive decimal number as a string");

/**
 * C-3a (docs/CONTRACT-MODULE-BUILD.md Part 2): a minimal contract header -
 * just enough to prove the division-scoped field engine has somewhere
 * real to read/write values (see docs/adr/0022). materialType/weightKg/
 * rateUsd/deliveryTerms are the PLACEHOLDER Scrap field set, not yet
 * client-confirmed - see defaults.ts's own doc comment on these entries.
 * The full contract document (templates, clauses, numbering) is C-3b's
 * job; this schema will grow then, never shrink.
 */
export const createContractSchema = z
  .object({
    divisionId: z.string().uuid().optional(),
    branchId: z.string().uuid().optional(),
    materialType: z.string().min(1).optional(),
    weightKg: decimalStringSchema.optional(),
    rateUsd: decimalStringSchema.optional(),
    deliveryTerms: z.string().min(1).optional(),
  })
  .strict();
export type CreateContractInput = z.infer<typeof createContractSchema>;

export const updateContractSchema = createContractSchema;
export type UpdateContractInput = z.infer<typeof updateContractSchema>;

export const contractIdParamsSchema = z.object({
  id: z.string().uuid(),
});
