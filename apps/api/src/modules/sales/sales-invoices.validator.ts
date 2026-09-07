import { z } from "zod";

const decimalStringSchema = z.string().regex(/^\d+(\.\d+)?$/, "Expected a positive decimal number as a string");
const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

/**
 * S-5 (docs/SALES-MODULE-PLAN.md): mirrors purchase-bills.validator.ts's
 * createPurchaseInvoiceSchema, minus the legacy wire-name translation
 * layer that exists there for historical reasons (Purchase Bill kept
 * Prompt 22's field names on the wire; Sales Invoice has no prior name to
 * preserve, so its own column names ARE its wire names). `invoiceNumber`
 * is never accepted on create/update - always server-generated (core/
 * numbering, docType "INVOICE"). `items` is optional, same reasoning as
 * Purchase Bill's own - an itemless invoice is still a valid, approvable
 * document (this is what makes "invoice independent of delivery"
 * possible, docs/adr/0028).
 */
export const createSalesInvoiceSchema = z
  .object({
    customerReferenceNo: z.string().min(1).optional(),
    invoiceDate: dateStringSchema,
    dueDate: dateStringSchema.optional(),
    invoiceAmountUsd: decimalStringSchema,
    taxAmount: decimalStringSchema.optional(),
    items: z
      .array(
        z
          .object({
            salesItemId: z.string().uuid(),
            invoicedQuantity: decimalStringSchema,
            invoicedAmountUsd: decimalStringSchema,
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
export type CreateSalesInvoiceInput = z.infer<typeof createSalesInvoiceSchema>;

export const updateSalesInvoiceSchema = z
  .object({
    customerReferenceNo: z.string().min(1).optional(),
    invoiceDate: dateStringSchema.optional(),
    dueDate: dateStringSchema.optional(),
    invoiceAmountUsd: decimalStringSchema.optional(),
    taxAmount: decimalStringSchema.optional(),
  })
  .strict();
export type UpdateSalesInvoiceInput = z.infer<typeof updateSalesInvoiceSchema>;

export const salesInvoiceIdParamsSchema = z.object({
  id: z.string().uuid(),
  invoiceId: z.string().uuid(),
});

/** The standalone, cross-sale "Sales Invoices" list screen's own query - server-side paging/filtering (rule 10), mirroring billsListQuerySchema shape. */
export const invoicesListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  status: z.enum(["draft", "approved", "reversed", "paid"]).optional(),
  invoiceDateFrom: dateStringSchema.optional(),
  invoiceDateTo: dateStringSchema.optional(),
});
export type InvoicesListQuery = z.infer<typeof invoicesListQuerySchema>;
