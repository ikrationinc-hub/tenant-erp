import { randomUUID } from "node:crypto";

export interface BuildStorageKeyInput {
  tenantSchema: string;
  companyId: string;
  entity: string;
  entityId: string;
  filename: string;
}

/** Strips any path component and anything not safe inside an S3 key, so a crafted filename (e.g. "../../etc/passwd") can never influence the key beyond its own basename. */
function sanitizeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
  return cleaned.length > 0 ? cleaned : "file";
}

/** tenant/company/entity/entity_id/uuid-filename - the uuid guarantees uniqueness even for two uploads of the same filename to the same entity. */
export function buildStorageKey(input: BuildStorageKeyInput): string {
  const safeFilename = sanitizeFilename(input.filename);
  return `${input.tenantSchema}/${input.companyId}/${input.entity}/${input.entityId}/${randomUUID()}-${safeFilename}`;
}
