import { z } from "zod";

const decimalStringSchema = z.string().regex(/^\d+(\.\d+)?$/, "Expected a positive decimal number as a string");
const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

/**
 * receiptNumber is never accepted - always server-generated (core/
 * numbering, docType "PURCHASE_RECEIPT"), same treatment as
 * purchaseNumber/invoiceNumber. `items` must be non-empty at create time
 * too (not just at confirm) - a receipt with zero lines has nothing for
 * the create endpoint to do, same reasoning purchase.service.ts applies
 * at its own approve guard, just enforced earlier here since there's no
 * separate "add item to receipt" endpoint (unlike purchase items).
 */
export const createPurchaseReceiptSchema = z
  .object({
    receiptDate: dateStringSchema,
    warehouseId: z.string().uuid(),
    items: z
      .array(
        z
          .object({
            purchaseItemId: z.string().uuid(),
            receivedQuantity: decimalStringSchema,
          })
          .strict(),
      )
      .min(1, "A receipt must have at least one item"),
  })
  .strict();
export type CreatePurchaseReceiptInput = z.infer<typeof createPurchaseReceiptSchema>;

export const purchaseReceiptIdParamsSchema = z.object({
  id: z.string().uuid(),
  receiptId: z.string().uuid(),
});

/** PL-4: the standalone, cross-purchase "Purchase Receipts" list screen's own query - server-side paging/filtering (rule 10), mirroring purchase.validator.ts's purchasesListQuerySchema shape. */
export const receiptsListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  status: z.enum(["draft", "confirmed", "reversed"]).optional(),
  warehouseId: z.string().uuid().optional(),
  receiptDateFrom: dateStringSchema.optional(),
  receiptDateTo: dateStringSchema.optional(),
});
export type ReceiptsListQuery = z.infer<typeof receiptsListQuerySchema>;
