import { z } from "zod";

export const uploadParamsSchema = z.object({
  entity: z.string().min(1),
  entityId: z.string().uuid(),
  fieldKey: z.string().min(1),
});
export type UploadParams = z.infer<typeof uploadParamsSchema>;

export const attachmentIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const listAttachmentsQuerySchema = z.object({
  entity: z.string().min(1),
  entityId: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});
export type ListAttachmentsQuery = z.infer<typeof listAttachmentsQuerySchema>;
