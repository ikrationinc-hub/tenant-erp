import { S3Client } from "@aws-sdk/client-s3";
import { env } from "../../config/env.js";

/**
 * MinIO speaks the S3 API but isn't AWS - forcePathStyle is required
 * (MinIO doesn't do virtual-hosted-style bucket addressing by default),
 * and the region is whatever MinIO was configured with, not a real AWS
 * region.
 */
export const s3Client = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
});
