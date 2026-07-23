import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { PaginatedRows } from "../../core/masters/types.js";
import type { TenantTx } from "../../database/get-db.js";
import { attachments } from "../../database/tenant/schema.js";

export type AttachmentRow = typeof attachments.$inferSelect;
export type AttachmentInsert = typeof attachments.$inferInsert;

export async function insertAttachment(tx: TenantTx, values: AttachmentInsert): Promise<AttachmentRow> {
  const [row] = await tx.insert(attachments).values(values).returning();
  if (!row) {
    throw new Error("failed to insert attachment");
  }
  return row;
}

export async function findAttachmentById(
  tx: TenantTx,
  companyId: string,
  id: string,
): Promise<AttachmentRow | undefined> {
  const [row] = await tx
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, id), eq(attachments.companyId, companyId), isNull(attachments.deletedAt)))
    .limit(1);
  return row;
}

export interface ListAttachmentsParams {
  entity: string;
  entityId: string;
  page: number;
  pageSize: number;
}

export async function listAttachmentsForEntity(
  tx: TenantTx,
  companyId: string,
  params: ListAttachmentsParams,
): Promise<PaginatedRows<AttachmentRow>> {
  const where = and(
    eq(attachments.companyId, companyId),
    eq(attachments.entity, params.entity),
    eq(attachments.entityId, params.entityId),
    isNull(attachments.deletedAt),
  );
  const offset = (params.page - 1) * params.pageSize;

  const [rows, totalRows] = await Promise.all([
    tx
      .select()
      .from(attachments)
      .where(where)
      .orderBy(desc(attachments.createdAt))
      .limit(params.pageSize)
      .offset(offset),
    tx.select({ value: sql<number>`count(*)::int` }).from(attachments).where(where),
  ]);

  return { items: rows, total: totalRows[0]?.value ?? 0, page: params.page, pageSize: params.pageSize };
}
