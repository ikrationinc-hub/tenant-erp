import { z } from "zod";

const decimalStringSchema = z.string().regex(/^\d+(\.\d+)?$/, "Expected a positive decimal number as a string");
const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

/**
 * Prompt 22 Part 2. `invoiceNumber` is never accepted - always server-
 * generated (core/numbering, docType "SUPPLIER_INVOICE"), same treatment
 * as purchaseNumber/supplier code. `invoiceAmountUsd` - what the
 * supplier's own invoice states as its total - is mandatory on create
 * (the client confirmed this): it's the whole point of the document, and
 * is what getById's variance-vs-PO figure (purchase.service.ts) is
 * computed against. Reference only, never fed into a calculation itself
 * (rule 1/rule 3) - the variance is, but that's informational, never a
 * block on approval.
 */
export const createPurchaseInvoiceSchema = z
  .object({
    supplierInvoiceNo: z.string().min(1).optional(),
    invoiceDate: dateStringSchema,
    invoiceAmountUsd: decimalStringSchema,
  })
  .strict();
export type CreatePurchaseInvoiceInput = z.infer<typeof createPurchaseInvoiceSchema>;

export const updatePurchaseInvoiceSchema = z
  .object({
    supplierInvoiceNo: z.string().min(1).optional(),
    invoiceDate: dateStringSchema.optional(),
    invoiceAmountUsd: decimalStringSchema.optional(),
  })
  .strict();
export type UpdatePurchaseInvoiceInput = z.infer<typeof updatePurchaseInvoiceSchema>;

export const purchaseInvoiceIdParamsSchema = z.object({
  id: z.string().uuid(),
  invoiceId: z.string().uuid(),
});
