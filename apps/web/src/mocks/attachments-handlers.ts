import { http, HttpResponse } from "msw";
import { attachmentRowSchema, type AttachmentRow } from "@hyperion/contracts";
import { endpoints } from "../core/api/endpoints";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

const attachments: AttachmentRow[] = [];

/**
 * Not `instanceof File` - MSW's node-side XMLHttpRequest interceptor
 * reconstructs the multipart body's file part using a File implementation
 * from a different realm than this module's global `File` (jsdom vs
 * undici), so `instanceof` never matches even for a genuine upload. Duck-typing
 * is the only reliable check across that boundary.
 */
function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    "size" in value &&
    typeof value.name === "string" &&
    typeof value.size === "number"
  );
}

/**
 * Mirrors the real backend's synchronous-scan design (see
 * packages/contracts/src/attachments.ts's attachmentRowSchema comment): a
 * row only ever exists post-scan. A filename containing "infected" (this
 * mock's only trigger - there's no real ClamAV here) simulates what an
 * infected upload looks like client-side: a rejected request, never a row.
 */
export const attachmentsHandlers = [
  http.post(`${API_BASE}${endpoints.uploadAttachment(":entity", ":entityId", ":fieldKey")}`, async ({ params, request }) => {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!isUploadedFile(file)) {
      return HttpResponse.json({ error: { code: "VALIDATION_ERROR", message: "No file provided" } }, { status: 400 });
    }
    if (file.name.toLowerCase().includes("infected")) {
      return HttpResponse.json(
        { error: { code: "VIRUS_DETECTED", message: `"${file.name}" failed the virus scan and was rejected` } },
        { status: 422 },
      );
    }
    const entity = typeof params.entity === "string" ? params.entity : "";
    const entityId = typeof params.entityId === "string" ? params.entityId : "";
    const fieldKey = typeof params.fieldKey === "string" ? params.fieldKey : "";
    const row = attachmentRowSchema.parse({
      id: crypto.randomUUID(),
      companyId: "22222222-2222-4222-8222-222222222222",
      entity,
      entityId,
      fieldKey,
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      size: file.size,
      storageKey: `mock/${entity}/${entityId}/${fieldKey}/${file.name}`,
      checksum: "mock-checksum",
      scannedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      createdBy: "11111111-1111-4111-8111-111111111111",
    });
    attachments.push(row);
    return HttpResponse.json(row, { status: 201 });
  }),

  http.get(`${API_BASE}${endpoints.attachmentDownloadUrl(":id")}`, ({ params }) => {
    const attachment = attachments.find((row) => row.id === params.id);
    if (!attachment) {
      return HttpResponse.json({ error: { code: "NOT_FOUND", message: "Attachment not found" } }, { status: 404 });
    }
    return HttpResponse.json({
      url: `https://mock-storage.test/${attachment.storageKey}`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
  }),

  http.get(`${API_BASE}${endpoints.attachments}`, ({ request }) => {
    const url = new URL(request.url);
    const entity = url.searchParams.get("entity");
    const entityId = url.searchParams.get("entityId");
    const items = attachments.filter((row) => row.entity === entity && row.entityId === entityId);
    return HttpResponse.json({ items, total: items.length, page: 1, pageSize: items.length || 1 });
  }),
];
