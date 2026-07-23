import { z } from "zod";

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

/**
 * Sub Tab 2, table C (Shipment Details) - session (a) fields only.
 * `shipmentYear` is never accepted here (open question #7, resolved):
 * server-derived from `loadingDate`'s calendar year in purchase.service.ts.
 */
const shipmentInputSchema = z
  .object({
    lotNumber: z.string().min(1),
    containerNumber: z.string().min(1),
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
export type ShipmentInput = z.infer<typeof shipmentInputSchema>;

/**
 * Tables A+B (Purchase Header + Supplier Details) plus the nested Shipment
 * Details block - built together per this task's suggested session order.
 * `purchaseNumber`/`status` are never accepted here: FR-101's auto-generated
 * number and the Draft->Approved->Posted workflow (not yet built - session
 * (e)) are exclusively system-controlled.
 */
export const createPurchaseSchema = z
  .object({
    purchaseDate: dateStringSchema,
    branchId: z.string().uuid(),
    buyerId: z.string().uuid(),
    supplierId: z.string().uuid(),
    supplierInvoiceNo: z.string().min(1).optional(),
    supplierReferenceNo: z.string().min(1).optional(),
    shipment: shipmentInputSchema,
  })
  .strict();
export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;

/** All optional (a PATCH touches only what it sends); `shipment`, when present, is a partial merge into the existing 1:1 shipment row - not a replace. */
export const updatePurchaseSchema = z
  .object({
    purchaseDate: dateStringSchema.optional(),
    branchId: z.string().uuid().optional(),
    buyerId: z.string().uuid().optional(),
    supplierId: z.string().uuid().optional(),
    supplierInvoiceNo: z.string().min(1).optional(),
    supplierReferenceNo: z.string().min(1).optional(),
    shipment: shipmentInputSchema.partial().optional(),
  })
  .strict();
export type UpdatePurchaseInput = z.infer<typeof updatePurchaseSchema>;

export const purchaseIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const purchasesListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().min(1).optional(),
  status: z.enum(["draft", "approved", "posted"]).optional(),
});
export type PurchasesListQuery = z.infer<typeof purchasesListQuerySchema>;
