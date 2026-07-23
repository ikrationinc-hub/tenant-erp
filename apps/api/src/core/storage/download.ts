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
