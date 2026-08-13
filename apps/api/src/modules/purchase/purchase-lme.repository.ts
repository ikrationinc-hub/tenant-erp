import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "../../database/get-db.js";
import { lmeRecords, purchasePricing } from "../../database/tenant/schema.js";

export type LmeRecordRow = typeof lmeRecords.$inferSelect;
export type LmeRecordInsert = typeof lmeRecords.$inferInsert;

/**
 * Only the repository layer touches SQL (rule 5) - service/controller
 * never import `db`. Update/delete exist (below) but purchase-lme.service.ts
 * only allows them while `isLmeRecordUsedByAnyItem` is false - once an
 * item has snapshotted this record's rate (purchase_pricing.lme_record_id),
 * it locks, matching rule 8's spirit ("corrections are reversal +
 * re-entry") without needing a formal reversal document for a record no
 * item has ever consumed yet.
 */

export async function listLmeRecordsForPurchase(tx: TenantTx, companyId: string, purchaseId: string): Promise<LmeRecordRow[]> {
  return tx
    .select()
    .from(lmeRecords)
    .where(and(eq(lmeRecords.purchaseId, purchaseId), eq(lmeRecords.companyId, companyId), isNull(lmeRecords.deletedAt)))
    .orderBy(asc(lmeRecords.createdAt));
}

export async function findLmeRecordById(tx: TenantTx, companyId: string, purchaseId: string, id: string): Promise<LmeRecordRow | undefined> {
  const [row] = await tx
    .select()
    .from(lmeRecords)
    .where(
      and(
        eq(lmeRecords.id, id),
        eq(lmeRecords.purchaseId, purchaseId),
        eq(lmeRecords.companyId, companyId),
        isNull(lmeRecords.deletedAt),
      ),
    )
    .limit(1);
  return row;
}

/** Prompt 21 item 2: the source of truth for an item's auto-filled rate under pricing_type='lme' (purchase-items.service.ts) - the MOST RECENT record if several exist. Snapshotted once onto purchase_pricing.lme_record_id at that item's own creation time - never re-derived later even if a newer record is added afterward. */
export async function findLatestLmeRecordForPurchase(tx: TenantTx, companyId: string, purchaseId: string): Promise<LmeRecordRow | undefined> {
  const [row] = await tx
    .select()
    .from(lmeRecords)
    .where(and(eq(lmeRecords.purchaseId, purchaseId), eq(lmeRecords.companyId, companyId), isNull(lmeRecords.deletedAt)))
    .orderBy(desc(lmeRecords.createdAt))
    .limit(1);
  return row;
}

/** Whether any item has ever snapshotted this record's rate - the gate on update/delete (see this file's own doc comment). */
export async function isLmeRecordUsedByAnyItem(tx: TenantTx, companyId: string, lmeRecordId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: purchasePricing.id })
    .from(purchasePricing)
    .where(and(eq(purchasePricing.lmeRecordId, lmeRecordId), eq(purchasePricing.companyId, companyId), isNull(purchasePricing.deletedAt)))
    .limit(1);
  return Boolean(row);
}

export async function insertLmeRecord(tx: TenantTx, values: LmeRecordInsert): Promise<LmeRecordRow> {
  const [row] = await tx.insert(lmeRecords).values(values).returning();
  if (!row) {
    throw new Error("failed to insert lme record");
  }
  return row;
}

export async function updateLmeRecord(
  tx: TenantTx,
  companyId: string,
  id: string,
  values: Partial<LmeRecordInsert>,
): Promise<LmeRecordRow | undefined> {
  const [row] = await tx
    .update(lmeRecords)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(lmeRecords.id, id), eq(lmeRecords.companyId, companyId), isNull(lmeRecords.deletedAt)))
    .returning();
  return row;
}

export async function softDeleteLmeRecord(tx: TenantTx, companyId: string, id: string, deletedBy: string): Promise<LmeRecordRow | undefined> {
  const [row] = await tx
    .update(lmeRecords)
    .set({ deletedAt: new Date(), updatedBy: deletedBy, updatedAt: new Date() })
    .where(and(eq(lmeRecords.id, id), eq(lmeRecords.companyId, companyId), isNull(lmeRecords.deletedAt)))
    .returning();
  return row;
}
