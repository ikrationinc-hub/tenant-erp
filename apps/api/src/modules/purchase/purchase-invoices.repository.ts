import { and, asc, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "../../database/get-db.js";
import { purchaseInvoices } from "../../database/tenant/schema.js";

export type PurchaseInvoiceRow = typeof purchaseInvoices.$inferSelect;
export type PurchaseInvoiceInsert = typeof purchaseInvoices.$inferInsert;

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. */

export async function listInvoicesForPurchase(tx: TenantTx, companyId: string, purchaseId: string): Promise<PurchaseInvoiceRow[]> {
  return tx
    .select()
    .from(purchaseInvoices)
    .where(and(eq(purchaseInvoices.purchaseId, purchaseId), eq(purchaseInvoices.companyId, companyId), isNull(purchaseInvoices.deletedAt)))
    .orderBy(asc(purchaseInvoices.createdAt));
}

/** Prompt 21 item 4-style "single by default" check: any non-deleted invoice at all, regardless of status - a draft one still counts as "the purchase already has its one invoice" when ALLOW_PARTIAL_INVOICING is off. */
export async function findAnyInvoiceForPurchase(tx: TenantTx, companyId: string, purchaseId: string): Promise<PurchaseInvoiceRow | undefined> {
  const [row] = await tx
    .select()
    .from(purchaseInvoices)
    .where(and(eq(purchaseInvoices.purchaseId, purchaseId), eq(purchaseInvoices.companyId, companyId), isNull(purchaseInvoices.deletedAt)))
    .limit(1);
  return row;
}

export async function findInvoiceById(tx: TenantTx, companyId: string, purchaseId: string, id: string): Promise<PurchaseInvoiceRow | undefined> {
  const [row] = await tx
    .select()
    .from(purchaseInvoices)
    .where(
      and(
        eq(purchaseInvoices.id, id),
        eq(purchaseInvoices.purchaseId, purchaseId),
        eq(purchaseInvoices.companyId, companyId),
        isNull(purchaseInvoices.deletedAt),
      ),
    )
    .limit(1);
  return row;
}

export async function insertInvoice(tx: TenantTx, values: PurchaseInvoiceInsert): Promise<PurchaseInvoiceRow> {
  const [row] = await tx.insert(purchaseInvoices).values(values).returning();
  if (!row) {
    throw new Error("failed to insert purchase invoice");
  }
  return row;
}

export async function updateInvoiceFields(
  tx: TenantTx,
  companyId: string,
  id: string,
  values: Partial<PurchaseInvoiceInsert>,
): Promise<PurchaseInvoiceRow | undefined> {
  const [row] = await tx
    .update(purchaseInvoices)
    .set(values)
    .where(and(eq(purchaseInvoices.id, id), eq(purchaseInvoices.companyId, companyId), isNull(purchaseInvoices.deletedAt)))
    .returning();
  return row;
}

/** CAS transition, same shape as purchase.repository.ts's transitionPurchaseStatus - a concurrent double-approve loses the race cleanly (zero rows matched) rather than double-writing stock. */
export async function transitionInvoiceStatus(
  tx: TenantTx,
  companyId: string,
  id: string,
  input: { from: PurchaseInvoiceRow["status"]; to: PurchaseInvoiceRow["status"]; extra?: Record<string, unknown> },
): Promise<PurchaseInvoiceRow | undefined> {
  const [row] = await tx
    .update(purchaseInvoices)
    .set({ status: input.to, ...(input.extra ?? {}), updatedAt: new Date() })
    .where(
      and(
        eq(purchaseInvoices.id, id),
        eq(purchaseInvoices.companyId, companyId),
        eq(purchaseInvoices.status, input.from),
        isNull(purchaseInvoices.deletedAt),
      ),
    )
    .returning();
  return row;
}

/**
 * Prompt 22 Part 4: called by purchase-items.service.ts after a
 * stock-relevant item add/quantity-change, in the SAME transaction as
 * that edit. A purchase with no approved invoice (still Draft, or an
 * invoice that's already Draft) naturally updates zero rows - this
 * doesn't need its own "is there anything to flip" check first, the
 * WHERE clause already only matches what needs flipping.
 */
export async function flipApprovedInvoicesToDraft(
  tx: TenantTx,
  companyId: string,
  purchaseId: string,
  updatedBy: string,
): Promise<PurchaseInvoiceRow[]> {
  return tx
    .update(purchaseInvoices)
    .set({ status: "draft", updatedBy, updatedAt: new Date() })
    .where(
      and(
        eq(purchaseInvoices.purchaseId, purchaseId),
        eq(purchaseInvoices.companyId, companyId),
        eq(purchaseInvoices.status, "approved"),
        isNull(purchaseInvoices.deletedAt),
      ),
    )
    .returning();
}
