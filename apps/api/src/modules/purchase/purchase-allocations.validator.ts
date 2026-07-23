import { z } from "zod";

const percentStringSchema = z.string().regex(/^\d+(\.\d+)?$/, "Expected a positive decimal number as a string");

/** Sub Tab 2, table F - resolved open question #3: many reserved customers per purchase, each with their own split percentage. */
export const addAllocationSchema = z
  .object({
    reservedCustomerId: z.string().uuid(),
    allocationPct: percentStringSchema,
  })
  .strict();
export type AddAllocationInput = z.infer<typeof addAllocationSchema>;
