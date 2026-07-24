import { attachmentRowSchema, type AttachmentRow } from "@hyperion/contracts";
import { useAppStore } from "../store/app-store";
import { endpoints } from "../api/endpoints";

/**
 * Real upload progress needs XMLHttpRequest - `fetch` has no upload
 * progress event, so this deliberately bypasses core/api/client.ts's
 * apiFetch (JSON-only) for this one multipart/form-data call. No 401
 * refresh-retry here (unlike apiFetch): a mid-upload token expiry just
 * fails the upload, which the user retries - acceptable for a file input,
 * not worth the complexity of pausing/resuming a live upload stream.
 */
export function uploadAttachmentWithProgress(
  entity: string,
  entityId: string,
  fieldKey: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<AttachmentRow> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = `${import.meta.env.VITE_API_BASE_URL}${endpoints.uploadAttachment(entity, entityId, fieldKey)}`;
    xhr.open("POST", url);

    const { accessToken } = useAppStore.getState();
    if (accessToken) {
      xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(attachmentRowSchema.parse(JSON.parse(xhr.responseText)));
        } catch {
          reject(new Error("Upload succeeded but the response was not a valid attachment"));
        }
        return;
      }
      reject(new Error(extractErrorMessage(xhr.responseText)));
    };

    xhr.onerror = () => reject(new Error("Network error during upload"));

    const formData = new FormData();
    formData.append("file", file);
    xhr.send(formData);
  });
}

function extractErrorMessage(responseText: string): string {
  try {
    const body: unknown = JSON.parse(responseText);
    if (body && typeof body === "object" && "error" in body) {
      const error = (body as { error?: { message?: unknown } }).error;
      if (typeof error?.message === "string") {
        return error.message;
      }
    }
  } catch {
    // fall through to the default message below
  }
  return "Upload failed";
}
