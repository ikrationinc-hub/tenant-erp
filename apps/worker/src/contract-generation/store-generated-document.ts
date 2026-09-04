import { randomUUID } from "node:crypto";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { env } from "../config/env.js";

/**
 * Worker-local mirror of apps/api/src/core/storage/{client,key}.ts's shape,
 * scoped to what the generation job needs: put a buffer, get back a key.
 * No ClamAV scan step (core/storage/upload.ts's own reason for scanning -
 * "before an UNTRUSTED upload is accepted" - does not apply here: these
 * bytes are produced by docxtemplater/LibreOffice from this system's own
 * data, never from a user's uploaded file). Does not write an `attachments`
 * row either - that table's `scanned_at NOT NULL` column encodes exactly
 * the "this went through the upload+scan path" invariant that a
 * system-generated file never satisfies; C-3b's "generate Word/PDF" work
 * is where a proper contract-generated-documents table, if warranted,
 * belongs. For this spike, the returned storage key IS the artifact
 * reference the spec asks for ("store both, return both references").
 */
const s3Client = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
});

export interface StoreGeneratedDocumentInput {
  tenantSchema: string;
  companyId: string;
  /** clauseVersionId for C-2's single-clause spike, contractId for C-3b's whole-contract generation - either way, the key under which this generation run's own files are grouped. */
  storageScopeId: string;
  filename: string;
  contentType: string;
  body: Buffer;
}

function sanitizeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
  return cleaned.length > 0 ? cleaned : "file";
}

/** tenant/company/contract-generation/scope_id/uuid-filename - same shaping convention as apps/api's buildStorageKey. */
function buildGeneratedDocumentKey(input: StoreGeneratedDocumentInput): string {
  const safeFilename = sanitizeFilename(input.filename);
  return `${input.tenantSchema}/${input.companyId}/contract-generation/${input.storageScopeId}/${randomUUID()}-${safeFilename}`;
}

export async function storeGeneratedDocument(input: StoreGeneratedDocumentInput): Promise<string> {
  const storageKey = buildGeneratedDocumentKey(input);
  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: env.S3_BUCKET,
      Key: storageKey,
      Body: input.body,
      ContentType: input.contentType,
    },
  });
  await upload.done();
  return storageKey;
}
