import type { Readable } from "node:stream";
import type { RequestContext } from "../../common/context/request-context.js";
import { NotFoundError, UnauthorizedError } from "../../common/errors/index.js";
import { insertAuditLog } from "../../core/audit/write.js";
import type { PaginatedRows } from "../../core/masters/types.js";
import { getPresignedDownloadUrl, type PresignedDownloadUrl } from "../../core/storage/download.js";
import { InfectedFileError, storeUploadedFile } from "../../core/storage/upload.js";
import { withTenantDb } from "../../database/get-db.js";
import {
  findAttachmentById,
  insertAttachment,
  listAttachmentsForEntity,
  type AttachmentRow,
} from "./attachments.repository.js";

export interface UploadAttachmentInput {
  entity: string;
  entityId: string;
  fieldKey: string;
  filename: string;
  contentType: string;
  stream: Readable;
}

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

/**
 * The scan happens OUTSIDE any DB transaction (core/storage/upload.ts's
 * storeUploadedFile is pure I/O against the filesystem/clamd/S3, no
 * tenant schema access) - only once a file is clean and stored does a DB
 * transaction open, to insert the row and its audit entry together (rule
 * 6). An infected file never gets a row at all; it gets an audit entry
 * against the TARGET entity instead ("Infected -> reject + audit", task
 * item 2) - there is no attachment row to make that write atomic with, so
 * it's its own transaction.
 */
export async function uploadAttachment(ctx: RequestContext, input: UploadAttachmentInput): Promise<AttachmentRow> {
  const scope = requireTenantScope(ctx);

  try {
    const stored = await storeUploadedFile({
      tenantSchema: scope.tenantSchema,
      companyId: scope.companyId,
      entity: input.entity,
      entityId: input.entityId,
      filename: input.filename,
      contentType: input.contentType,
      stream: input.stream,
    });

    return await withTenantDb(ctx, async (tx) => {
      const row = await insertAttachment(tx, {
        companyId: scope.companyId,
        entity: input.entity,
        entityId: input.entityId,
        fieldKey: input.fieldKey,
        filename: stored.filename,
        contentType: stored.contentType,
        size: stored.size,
        storageKey: stored.storageKey,
        checksum: stored.checksum,
        scannedAt: stored.scannedAt,
        createdBy: scope.userId,
      });

      await insertAuditLog(tx, {
        companyId: scope.companyId,
        changedBy: scope.userId,
        entity: "attachment",
        entityId: row.id,
        action: "attachment.uploaded",
        after: {
          entity: row.entity,
          entityId: row.entityId,
          fieldKey: row.fieldKey,
          filename: row.filename,
          contentType: row.contentType,
          size: row.size,
          checksum: row.checksum,
        },
      });

      return row;
    });
  } catch (error) {
    if (error instanceof InfectedFileError) {
      await withTenantDb(ctx, (tx) =>
        insertAuditLog(tx, {
          companyId: scope.companyId,
          changedBy: scope.userId,
          entity: input.entity,
          entityId: input.entityId,
          action: "attachment.rejected",
          after: {
            fieldKey: input.fieldKey,
            filename: input.filename,
            contentType: input.contentType,
            virusName: error.virusName,
          },
        }),
      );
    }
    throw error;
  }
}

export async function getAttachmentDownloadUrl(ctx: RequestContext, id: string): Promise<PresignedDownloadUrl> {
  const scope = requireTenantScope(ctx);
  const row = await withTenantDb(ctx, (tx) => findAttachmentById(tx, scope.companyId, id));
  if (!row) {
    throw new NotFoundError("Attachment not found");
  }
  return getPresignedDownloadUrl(row.storageKey);
}

export interface ListAttachmentsInput {
  entity: string;
  entityId: string;
  page: number;
  pageSize: number;
}

export async function listAttachments(
  ctx: RequestContext,
  input: ListAttachmentsInput,
): Promise<PaginatedRows<AttachmentRow>> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, (tx) => listAttachmentsForEntity(tx, scope.companyId, input));
}
