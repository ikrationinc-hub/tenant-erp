import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../../config/env.js";
import { s3Client } from "./client.js";

const PRESIGNED_URL_TTL_SECONDS = 15 * 60;

export interface PresignedDownloadUrl {
  url: string;
  expiresAt: Date;
}

export async function getPresignedDownloadUrl(storageKey: string): Promise<PresignedDownloadUrl> {
  const command = new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: storageKey });
  const url = await getSignedUrl(s3Client, command, { expiresIn: PRESIGNED_URL_TTL_SECONDS });
  return { url, expiresAt: new Date(Date.now() + PRESIGNED_URL_TTL_SECONDS * 1000) };
}

/**
 * Reads an object's actual bytes - mirrors apps/worker's own
 * readObjectAsBuffer exactly (GetObjectCommand + async-iterate the Body
 * stream + Buffer.concat). The API side never needed this before C-4;
 * emailing a generated PDF is fetch-and-forward of an already-generated
 * file, not document GENERATION, so it doesn't belong in the worker.
 */
export async function readObjectAsBuffer(storageKey: string): Promise<Buffer> {
  const result = await s3Client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: storageKey }));
  const chunks: Buffer[] = [];
  for await (const chunk of result.Body as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
