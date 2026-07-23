import { z } from "zod";

const decimalStringSchema = z.string().regex(/^\d+(\.\d+)?$/, "Expected a positive decimal number as a string");
const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

/** Sub Tab 3, table B. FR-204. `status` is never accepted here - every hedge starts "open" (updatePurchaseHedgeStatusSchema is the only way to change it). */
export const addHedgeSchema = z
  .object({
    hedgePlatformId: z.string().uuid(),
    contractNumber: z.string().min(1),
    position: z.enum(["buy", "sell"]),
    quantity: decimalStringSchema,
    rate: decimalStringSchema,
    hedgeDate: dateStringSchema,
  })
  .strict();
export type AddHedgeInput = z.infer<typeof addHedgeSchema>;

/** Contract terms are immutable once entered (schema.ts's doc comment) - only `status` (the position's own open->closed lifecycle) is ever patched. */
export const updateHedgeStatusSchema = z
  .object({
    status: z.enum(["open", "closed"]),
  })
  .strict();
export type UpdateHedgeStatusInput = z.infer<typeof updateHedgeStatusSchema>;

export const hedgeParamsSchema = z.object({
  id: z.string().uuid(),
  hedgeId: z.string().uuid(),
});
