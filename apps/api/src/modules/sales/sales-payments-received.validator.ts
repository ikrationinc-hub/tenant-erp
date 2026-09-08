import { z } from "zod";

const decimalStringSchema = z.string().regex(/^\d+(\.\d+)?$/, "Expected a positive decimal number as a string");
const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

/**
 * S-5 (docs/SALES-MODULE-PLAN.md): mirrors purchase-payments.validator.ts's
 * createPaymentSchema exactly, substituting customer/invoice for supplier/
 * bill. `paymentNumber` is never accepted - always server-generated (core/
 * numbering, docType "RECEIPT"). `allocations` requires at least one entry.
 */
export const createPaymentReceivedSchema = z
  .object({
    customerId: z.string().uuid(),
    paymentDate: dateStringSchema,
    paymentMode: z.enum(["cash", "cheque", "bank_transfer", "other"]),
    referenceNumber: z.string().min(1).optional(),
    notes: z.string().min(1).optional(),
    allocations: z
      .array(
        z
          .object({
            invoiceId: z.string().uuid(),
            appliedAmountUsd: decimalStringSchema,
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type CreatePaymentReceivedInput = z.infer<typeof createPaymentReceivedSchema>;

export const paymentReceivedIdParamsSchema = z.object({
  id: z.string().uuid(),
});

/** The standalone "Payments Received" list screen's own query - server-side paging/filtering (rule 10). */
export const paymentsReceivedListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  customerId: z.string().uuid().optional(),
  paymentDateFrom: dateStringSchema.optional(),
  paymentDateTo: dateStringSchema.optional(),
});
export type PaymentsReceivedListQuery = z.infer<typeof paymentsReceivedListQuerySchema>;

/** The invoice-picker's own query - GET /payments-received/outstanding-invoices/:customerId. */
export const outstandingInvoicesParamsSchema = z.object({
  customerId: z.string().uuid(),
});
