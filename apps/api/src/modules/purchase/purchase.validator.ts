import { z } from "zod";

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const decimalStringSchema = z.string().regex(/^\d+(\.\d+)?$/, "Expected a positive decimal number as a string");

/**
 * Sub Tab 2, table C (Shipment Details) - session (a) fields only.
 * `shipmentYear` is never accepted here (open question #7, resolved):
 * server-derived from `loadingDate`'s calendar year in purchase.service.ts.
 * `containerId` (Prompt 21 item 5) replaced the old free-text
 * `containerNumber` - a lookup against the containers master, with
 * create-on-the-fly on the frontend (a new container is just POSTed to
 * that master first, same as any other master, then referenced here by id
 * like every other master-backed field already is).
 */
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
export type ShipmentInput = z.infer<typeof shipmentInputSchema>;

/**
 * Tables A+B (Purchase Header + Supplier Details) plus the nested Shipment
 * Details block - built together per this task's suggested session order.
 * `purchaseNumber`/`status` are never accepted here: FR-101's auto-generated
 * number and the Draft->Approved->Posted workflow (not yet built - session
 * (e)) are exclusively system-controlled.
 *
 * `divisionId`/`pricingType` (Prompt 21 items 1/2) are required here even
 * though both columns are nullable at the DB level - existing purchases
 * were deliberately left with neither rather than backfilled to a guessed
 * value (see schema.ts's doc comments), but every NEW purchase must have
 * both. `brokerId`/`brokerCommission` (item 4) are genuinely optional -
 * "not every deal has a broker".
 */
export const createPurchaseSchema = z
  .object({
    purchaseDate: dateStringSchema,
    divisionId: z.string().uuid(),
    pricingType: z.enum(["lme", "fixed"]),
    branchId: z.string().uuid(),
    buyerId: z.string().uuid(),
    supplierId: z.string().uuid(),
    supplierInvoiceNo: z.string().min(1).optional(),
    supplierReferenceNo: z.string().min(1).optional(),
    brokerId: z.string().uuid().optional(),
    brokerCommission: decimalStringSchema.optional(),
    // brokerCommissionType is deliberately NOT accepted here - the column
    // exists purely for forward-compatibility (schema.ts's doc comment on
    // brokerCommissionTypeEnum), nothing reads or writes it yet, so
    // accepting it from a client would let a value sit there unused
    // rather than actually meaning anything.
    shipment: shipmentInputSchema,
  })
  .strict();
export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;

/** All optional (a PATCH touches only what it sends); `shipment`, when present, is a partial merge into the existing 1:1 shipment row - not a replace. */
export const updatePurchaseSchema = z
  .object({
    purchaseDate: dateStringSchema.optional(),
    divisionId: z.string().uuid().optional(),
    pricingType: z.enum(["lme", "fixed"]).optional(),
    branchId: z.string().uuid().optional(),
    buyerId: z.string().uuid().optional(),
    supplierId: z.string().uuid().optional(),
    supplierInvoiceNo: z.string().min(1).optional(),
    supplierReferenceNo: z.string().min(1).optional(),
    brokerId: z.string().uuid().optional(),
    brokerCommission: decimalStringSchema.optional(),
    // brokerCommissionType is deliberately NOT accepted here - the column
    // exists purely for forward-compatibility (schema.ts's doc comment on
    // brokerCommissionTypeEnum), nothing reads or writes it yet, so
    // accepting it from a client would let a value sit there unused
    // rather than actually meaning anything.
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
  supplierId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  purchaseDateFrom: dateStringSchema.optional(),
  purchaseDateTo: dateStringSchema.optional(),
});
export type PurchasesListQuery = z.infer<typeof purchasesListQuerySchema>;
