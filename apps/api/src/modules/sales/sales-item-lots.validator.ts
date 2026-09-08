import { z } from "zod";

const decimalStringSchema = z.string().regex(/^\d+(\.\d+)?$/, "Expected a positive decimal number as a string");

/** FR-104's "pick a lot" - Draft-only add, mirrors the shape of every other add-endpoint on this router. */
export const addSalesItemLotSchema = z
  .object({
    stockLotId: z.string().uuid(),
    qty: decimalStringSchema,
  })
  .strict();
export type AddSalesItemLotInput = z.infer<typeof addSalesItemLotSchema>;

export const salesItemLotParamsSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
  lotId: z.string().uuid(),
});

/**
 * The lot-picker's own read - GET /sales/lots-available?itemId=...&gradeId=...&salesItemId=...
 * `salesItemId` is optional (the endpoint predates it) but should always
 * be sent by the drawer that's actually picking for one sales item - see
 * sales-item-lots.service.ts's listAvailableLots for why: without it,
 * availableQty can't account for what THIS sales item has already picked
 * from a lot (a real, unreserved pick that addLot's own create-time check
 * already subtracts, but this read-side query didn't used to).
 */
export const availableStockLotsQuerySchema = z.object({
  itemId: z.string().uuid(),
  gradeId: z.string().uuid().optional(),
  salesItemId: z.string().uuid().optional(),
});
export type AvailableStockLotsQuery = z.infer<typeof availableStockLotsQuerySchema>;
