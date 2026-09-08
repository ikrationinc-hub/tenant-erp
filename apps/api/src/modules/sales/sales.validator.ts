import { z } from "zod";

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const decimalStringSchema = z.string().regex(/^\d+(\.\d+)?$/, "Expected a positive decimal number as a string");

/** Mirrors purchase.validator.ts's shipmentInputSchema exactly - shipmentYear is server-derived, never accepted here. */
const shipmentInputSchema = z
  .object({
    lotNumber: z.string().min(1),
    containerId: z.string().uuid(),
    blNo: z.string().min(1),
    loadingDate: dateStringSchema,
    transportModeId: z.string().uuid(),
    vesselId: z.string().uuid().optional(),
    voyageNumber: z.string().min(1).optional(),
    portOfLoadingId: z.string().uuid(),
    portOfDischargeId: z.string().uuid(),
    warehouseId: z.string().uuid(),
    incotermId: z.string().uuid(),
  })
  .strict();
export type SalesShipmentInput = z.infer<typeof shipmentInputSchema>;

/**
 * salesNumber/status are never accepted here - auto-generated / workflow-
 * controlled exclusively (approve/cancel have their own endpoints).
 * pricingType only accepts "fixed" in this phase - S-3 scope was narrowed
 * during implementation: lme_records is hard-FK'd to purchases and cannot
 * be reused for Sales as-is; a real LME-sales-pricing mirror is deferred
 * (see docs/adr/0026). "lme" stays in the enum (schema-level) so a later
 * phase can add it without a migration, but this validator rejects it now
 * with a clear message rather than accepting and mishandling it.
 */
export const createSalesSchema = z
  .object({
    salesDate: dateStringSchema,
    divisionId: z.string().uuid(),
    pricingType: z.literal("fixed"),
    branchId: z.string().uuid(),
    sellerId: z.string().uuid(),
    customerId: z.string().uuid(),
    customerReferenceNo: z.string().min(1).optional(),
    shipment: shipmentInputSchema,
  })
  .strict();
export type CreateSalesInput = z.infer<typeof createSalesSchema>;

export const updateSalesSchema = z
  .object({
    salesDate: dateStringSchema.optional(),
    divisionId: z.string().uuid().optional(),
    pricingType: z.literal("fixed").optional(),
    branchId: z.string().uuid().optional(),
    sellerId: z.string().uuid().optional(),
    customerId: z.string().uuid().optional(),
    customerReferenceNo: z.string().min(1).optional(),
    shipment: shipmentInputSchema.partial().optional(),
  })
  .strict();
export type UpdateSalesInput = z.infer<typeof updateSalesSchema>;

export const salesIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const salesListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().min(1).optional(),
  status: z.enum(["draft", "approved", "closed", "cancelled"]).optional(),
  customerId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  divisionId: z.string().uuid().optional(),
  salesDateFrom: dateStringSchema.optional(),
  salesDateTo: dateStringSchema.optional(),
});
export type SalesListQuery = z.infer<typeof salesListQuerySchema>;

/** Decimal amounts travel the wire as strings, never JS numbers (rule 1/rule 3). */
export { decimalStringSchema };
