import { presignedDownloadUrlResponseSchema } from "@hyperion/contracts";
import { apiFetch } from "../api/client";
import { endpoints } from "../api/endpoints";

/** Presigned URLs are short-lived (core/storage/download.ts) - always fetched fresh at click time, never cached. */
export async function openAttachmentDownload(attachmentId: string): Promise<void> {
  const { url } = await apiFetch(endpoints.attachmentDownloadUrl(attachmentId), {}, {
    schema: presignedDownloadUrlResponseSchema,
  });
  window.open(url, "_blank", "noopener,noreferrer");
}
