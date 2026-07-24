import { z } from "zod";

/**
 * Mirrors apps/api's attachments.repository.ts's AttachmentRow
 * (typeof attachments.$inferSelect). A row only ever exists post-scan
 * (scannedAt is NOT NULL, never a nullable "pending" state) - an infected
 * upload is rejected before insert (core/storage), so there's no
 * "scanning"/"infected" status to poll for; the upload request itself
 * either 201s with a row like this or fails.
 */
export const attachmentRowSchema = z.object({
  id: z.uuid(),
  companyId: z.uuid(),
  entity: z.string(),
  entityId: z.uuid(),
  fieldKey: z.string(),
  filename: z.string(),
  contentType: z.string(),
  size: z.number(),
  storageKey: z.string(),
  checksum: z.string(),
  scannedAt: z.string(),
  createdAt: z.string(),
  createdBy: z.uuid(),
});
export type AttachmentRow = z.infer<typeof attachmentRowSchema>;

// --- POST /api/v1/attachments/:entity/:entityId/:fieldKey ------------------

export const uploadAttachmentResponseSchema = attachmentRowSchema;

// --- GET /api/v1/attachments/:id/download-url -------------------------------

/** Mirrors core/storage/download.ts's PresignedDownloadUrl. */
export const presignedDownloadUrlResponseSchema = z.object({
  url: z.string(),
  expiresAt: z.string(),
});
export type PresignedDownloadUrlResponse = z.infer<typeof presignedDownloadUrlResponseSchema>;

// --- GET /api/v1/attachments?entity=&entityId= ------------------------------

export const listAttachmentsResponseSchema = z.object({
  items: z.array(attachmentRowSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type ListAttachmentsResponse = z.infer<typeof listAttachmentsResponseSchema>;
