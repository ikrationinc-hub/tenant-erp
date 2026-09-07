import { z } from "zod";

const decimalStringSchema = z.string().regex(/^\d+(\.\d+)?$/, "Expected a positive decimal number as a string");
const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

/**
 * deliveryOrderNo is never accepted - always server-generated (core/
 * numbering, docType "DELIVERY"), same treatment as salesNumber. `items`
 * must be non-empty at create time (mirrors createPurchaseReceiptSchema's
 * own reasoning - there's no separate "add item to delivery" endpoint).
 * The new Tier-1 fields (vehicleNumber/transportCompany/driverName/
 * gatePassNo/podReceived/customerAcknowledgement) are all optional -
 * docs/SALES-MODULE-PLAN.md's Sub Tab 4 doesn't mark any of them mandatory.
 */
export const createDeliverySchema = z
  .object({
    dispatchDate: dateStringSchema,
    warehouseId: z.string().uuid(),
    vehicleNumber: z.string().min(1).optional(),
    transportCompany: z.string().min(1).optional(),
    driverName: z.string().min(1).optional(),
    gatePassNo: z.string().min(1).optional(),
    podReceived: z.boolean().optional(),
    customerAcknowledgement: z.string().min(1).optional(),
    items: z
      .array(
        z
          .object({
            salesItemId: z.string().uuid(),
            deliveredQuantity: decimalStringSchema,
          })
          .strict(),
      )
      .min(1, "A delivery must have at least one item"),
  })
  .strict();
export type CreateDeliveryInput = z.infer<typeof createDeliverySchema>;

export const deliveryIdParamsSchema = z.object({
  id: z.string().uuid(),
  deliveryId: z.string().uuid(),
});

/** The standalone, cross-sale "Deliveries" list screen's own query - server-side paging/filtering (rule 10), mirroring receiptsListQuerySchema shape. */
export const deliveriesListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  status: z.enum(["draft", "confirmed", "reversed"]).optional(),
  warehouseId: z.string().uuid().optional(),
  dispatchDateFrom: dateStringSchema.optional(),
  dispatchDateTo: dateStringSchema.optional(),
});
export type DeliveriesListQuery = z.infer<typeof deliveriesListQuerySchema>;
