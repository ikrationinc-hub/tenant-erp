import { z } from "zod";

const decimalStringSchema = z.string().regex(/^\d+(\.\d+)?$/, "Expected a positive decimal number as a string");
const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

/**
 * PL-2: the wire shape keeps Prompt 22's field names (invoiceDate,
 * invoiceAmountUsd) even though the entity is now internally "Bill"
 * (purchase_bills, billDate, billAmountUsd) - the REST path
 * (/purchases/:id/invoices), the field-definitions entity key
 * ("invoice"), and the attachment entity string ("purchase_invoice") are
 * ALL deliberately left unrenamed for this prompt (PL-2 is backend-only;
 * PL-4 does the coordinated API-surface + frontend cutover to Bill
 * vocabulary). purchase-bills.service.ts translates between this wire
 * shape and the renamed internal columns. `billNumber` is never accepted
 * on create/update - always server-generated (core/numbering, docType
 * "BILL").
 */
export const createPurchaseInvoiceSchema = z
  .object({
    supplierInvoiceNo: z.string().min(1).optional(),
    invoiceDate: dateStringSchema,
    dueDate: dateStringSchema.optional(),
    invoiceAmountUsd: decimalStringSchema,
    taxAmount: decimalStringSchema.optional(),
    /**
     * PL-2: which purchase item(s) this bill covers and how much of each
     * - optional, so the existing header-only create flow (no items,
     * pre-PL-2 UI) keeps working unchanged; a bill with items is how
     * partial billing (multiple bills per PO) and billed_status actually
     * get computed. Empty/omitted means "not itemized" - billed_status
     * treats such a bill as contributing nothing to any specific item's
     * billed quantity (it still exists and is approvable, just outside
     * the itemized-partial-billing tracking).
     */
    items: z
      .array(
        z
          .object({
            purchaseItemId: z.string().uuid(),
            billedQuantity: decimalStringSchema,
            billedAmountUsd: decimalStringSchema,
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
export type CreatePurchaseInvoiceInput = z.infer<typeof createPurchaseInvoiceSchema>;

export const updatePurchaseInvoiceSchema = z
  .object({
    supplierInvoiceNo: z.string().min(1).optional(),
    invoiceDate: dateStringSchema.optional(),
    dueDate: dateStringSchema.optional(),
    invoiceAmountUsd: decimalStringSchema.optional(),
    taxAmount: decimalStringSchema.optional(),
  })
  .strict();
export type UpdatePurchaseInvoiceInput = z.infer<typeof updatePurchaseInvoiceSchema>;

export const purchaseInvoiceIdParamsSchema = z.object({
  id: z.string().uuid(),
  invoiceId: z.string().uuid(),
});

/** PL-4: the standalone, cross-purchase "Purchase Bills" list screen's own query - server-side paging/filtering (rule 10). Wire field name `status` uses the bill's real status values, unaffected by the invoiceDate->invoiceDate wire-name preservation (there's no "billDate" leaking onto the wire here, only the filter key spelled to match the resource being listed). */
export const billsListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  status: z.enum(["draft", "approved", "reversed", "paid"]).optional(),
  billDateFrom: dateStringSchema.optional(),
  billDateTo: dateStringSchema.optional(),
});
export type BillsListQuery = z.infer<typeof billsListQuerySchema>;
