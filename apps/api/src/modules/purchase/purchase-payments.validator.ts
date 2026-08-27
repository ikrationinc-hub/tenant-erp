import { z } from "zod";

const decimalStringSchema = z.string().regex(/^\d+(\.\d+)?$/, "Expected a positive decimal number as a string");
const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

/**
 * PL-5: Payment - a new document, no legacy wire-shape translation needed
 * (unlike Bill/Receipt, which each preserve an older field-naming
 * convention on the wire). `paymentNumber` is never accepted - always
 * server-generated (core/numbering, docType "PAYMENT"). `allocations`
 * requires at least one entry - a payment with nothing applied to any
 * bill isn't a real payment record (mirrors Receipt/Bill's own "at least
 * one line" guard at the service layer, enforced here at the shape level
 * since it's a hard structural requirement, not a business-data check).
 */
export const createPaymentSchema = z
  .object({
    supplierId: z.string().uuid(),
    paymentDate: dateStringSchema,
    paymentMode: z.enum(["cash", "cheque", "bank_transfer", "other"]),
    referenceNumber: z.string().min(1).optional(),
    notes: z.string().min(1).optional(),
    allocations: z
      .array(
        z
          .object({
            billId: z.string().uuid(),
            appliedAmountUsd: decimalStringSchema,
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

export const paymentIdParamsSchema = z.object({
  id: z.string().uuid(),
});

/** The standalone "Payments Made" list screen's own query - server-side paging/filtering (rule 10). */
export const paymentsListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  supplierId: z.string().uuid().optional(),
  paymentDateFrom: dateStringSchema.optional(),
  paymentDateTo: dateStringSchema.optional(),
});
export type PaymentsListQuery = z.infer<typeof paymentsListQuerySchema>;

/** The bill-picker's own query - GET /suppliers/:id/outstanding-bills. */
export const outstandingBillsParamsSchema = z.object({
  supplierId: z.string().uuid(),
});
