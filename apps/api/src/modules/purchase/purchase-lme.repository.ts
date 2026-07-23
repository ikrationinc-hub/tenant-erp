import { and, asc, eq, isNull } from "drizzle-orm";
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

export async function insertLmeRecord(tx: TenantTx, values: LmeRecordInsert): Promise<LmeRecordRow> {
  const [row] = await tx.insert(lmeRecords).values(values).returning();
  if (!row) {
    throw new Error("failed to insert lme record");
  }
  return row;
}
