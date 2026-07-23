import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Upload } from "@aws-sdk/lib-storage";
import { ValidationError } from "../../common/errors/index.js";
import { env } from "../../config/env.js";
import { s3Client } from "./client.js";
import { buildStorageKey } from "./key.js";
import { getContentTypePolicy } from "./policy.js";
import { getScanner } from "./scanner.js";

export interface StoreUploadedFileInput {
  tenantSchema: string;
  companyId: string;
  entity: string;
  entityId: string;
  filename: string;
  contentType: string;
  stream: Readable;
}

export interface StoredFile {
  storageKey: string;
  filename: string;
  contentType: string;
  size: number;
  checksum: string;
  scannedAt: Date;
}

/** A distinguishable error type so the controller can report a scan rejection distinctly from a generic validation failure, while still being a plain 422 to the client. */
export class InfectedFileError extends ValidationError {
  constructor(readonly virusName: string) {
    super("Uploaded file failed the virus scan and was rejected", { virusName });
  }
}

/**
 * Streams the incoming file to a temp disk spool - never buffered whole in
 * memory - computing its SHA-256 checksum in the same pass, then scans the
 * SPOOLED file before a single byte reaches S3 (task item 2: "ClamAV scan
 * before the file is accepted"). An infected file is deleted from the
 * spool and rejected; nothing about it is ever uploaded or persisted. The
 * spool-then-scan-then-upload sequence (rather than tee-ing one live
 * stream into both the scanner and S3 concurrently) means there's never a
 * partially-uploaded S3 object to find and delete if the scan comes back
 * infected after the upload already started.
 */
export async function storeUploadedFile(input: StoreUploadedFileInput): Promise<StoredFile> {
  const policy = getContentTypePolicy(input.contentType);
  if (!policy) {
    input.stream.destroy();
    throw new ValidationError(`Content type "${input.contentType}" is not allowed`, {
      contentType: input.contentType,
    });
  }

  const spoolDir = await mkdtemp(join(tmpdir(), "hyperion-upload-"));
  const spoolPath = join(spoolDir, "spool");

  try {
    const hash = createHash("sha256");
    let size = 0;

    const hashing = new PassThrough();
    hashing.on("data", (chunk: Buffer) => {
      size += chunk.length;
      hash.update(chunk);
      if (size > policy.maxSizeBytes) {
        hashing.destroy(
          new ValidationError(
            `File exceeds the ${policy.maxSizeBytes}-byte limit for content type "${input.contentType}"`,
            { contentType: input.contentType, maxSizeBytes: policy.maxSizeBytes },
          ),
        );
      }
    });

    await pipeline(input.stream, hashing, createWriteStream(spoolPath));

    const scanResult = await getScanner().scan(createReadStream(spoolPath));
    if (!scanResult.clean) {
      throw new InfectedFileError(scanResult.reply);
    }

    const storageKey = buildStorageKey({
      tenantSchema: input.tenantSchema,
      companyId: input.companyId,
      entity: input.entity,
      entityId: input.entityId,
      filename: input.filename,
    });

    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: env.S3_BUCKET,
        Key: storageKey,
        Body: createReadStream(spoolPath),
        ContentType: input.contentType,
      },
    });
    await upload.done();

    return {
      storageKey,
      filename: input.filename,
      contentType: input.contentType,
      size,
      checksum: hash.digest("hex"),
      scannedAt: new Date(),
    };
  } finally {
    await rm(spoolDir, { recursive: true, force: true });
  }
}
