import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "../../database/get-db.js";
import { lmeRecords } from "../../database/tenant/schema.js";

export type LmeRecordRow = typeof lmeRecords.$inferSelect;
export type LmeRecordInsert = typeof lmeRecords.$inferInsert;

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. No update/delete: an lme_record is immutable once created (schema.ts's doc comment - "corrections are reversal + re-entry"). */

export async function listLmeRecordsForPurchase(tx: TenantTx, companyId: string, purchaseId: string): Promise<LmeRecordRow[]> {
  return tx
    .select()
    .from(lmeRecords)
    .where(and(eq(lmeRecords.purchaseId, purchaseId), eq(lmeRecords.companyId, companyId), isNull(lmeRecords.deletedAt)))
    .orderBy(asc(lmeRecords.createdAt));
}

/** Prompt 21 item 2: the source of truth for an item's auto-filled rate under pricing_type='lme' (purchase-items.service.ts) - the MOST RECENT record if several exist, since this codebase's LME/hedge/cost rows are all "add now, snapshot now" with no per-item linkage to a specific record (deliberately not hardwiring a more elaborate reconciliation than what's already built). */
export async function findLatestLmeRecordForPurchase(tx: TenantTx, companyId: string, purchaseId: string): Promise<LmeRecordRow | undefined> {
  const [row] = await tx
    .select()
    .from(lmeRecords)
    .where(and(eq(lmeRecords.purchaseId, purchaseId), eq(lmeRecords.companyId, companyId), isNull(lmeRecords.deletedAt)))
    .orderBy(desc(lmeRecords.createdAt))
    .limit(1);
  return row;
}

export async function insertLmeRecord(tx: TenantTx, values: LmeRecordInsert): Promise<LmeRecordRow> {
  const [row] = await tx.insert(lmeRecords).values(values).returning();
  if (!row) {
    throw new Error("failed to insert lme record");
  }
  return row;
}
