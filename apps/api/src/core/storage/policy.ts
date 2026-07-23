/**
 * Task item 4: "Enforce per-type limits and an allowlist of content types."
 * This engine is entity-agnostic (any module can attach a file to any
 * entity), and no per-attachment-field taxonomy exists yet to hang a
 * finer-grained policy off of (the Purchase module's own Attachments
 * section H field-by-field rules - Invoice is PDF/Image, BL/Packing List/
 * COO are PDF-only, "Other Documents" is "Any" - isn't built yet). This is
 * therefore one global allowlist, keyed by content type, each entry
 * carrying its own max size ("per-type limits") - a consuming module can
 * layer a narrower, field-specific allowlist on top later without this
 * module changing.
 */
export interface ContentTypePolicy {
  maxSizeBytes: number;
}

const DOCUMENT_MAX_SIZE_BYTES = 20 * 1024 * 1024;
const IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024;

export const ALLOWED_CONTENT_TYPES: Readonly<Record<string, ContentTypePolicy>> = {
  "application/pdf": { maxSizeBytes: DOCUMENT_MAX_SIZE_BYTES },
  "image/jpeg": { maxSizeBytes: IMAGE_MAX_SIZE_BYTES },
  "image/png": { maxSizeBytes: IMAGE_MAX_SIZE_BYTES },
  "application/msword": { maxSizeBytes: DOCUMENT_MAX_SIZE_BYTES },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    maxSizeBytes: DOCUMENT_MAX_SIZE_BYTES,
  },
  "application/vnd.ms-excel": { maxSizeBytes: DOCUMENT_MAX_SIZE_BYTES },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    maxSizeBytes: DOCUMENT_MAX_SIZE_BYTES,
  },
};

export function getContentTypePolicy(contentType: string): ContentTypePolicy | undefined {
  return ALLOWED_CONTENT_TYPES[contentType];
}
