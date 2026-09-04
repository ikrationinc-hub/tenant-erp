import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import { CONTRACT_GENERATION_QUEUE_NAME } from "../queues/contract-generation.queue.js";
import { buildDefaultContractDocx } from "../contract-generation/default-docx-template.js";
import { generateDocument, type GenerateDocumentResult } from "../contract-generation/generate-document.js";
import type { PlaceholderContext } from "../contract-generation/placeholder-resolver.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

const s3Client = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
});

async function readObjectAsBuffer(bucket: string, key: string): Promise<Buffer> {
  const result = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks: Buffer[] = [];
  for await (const chunk of result.Body as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * C-3b: the template's .docx bytes now come from S3 (the SAME bucket/
 * client apps/api's core/storage uploads templates into via the existing
 * attachments mechanism - contract-generation.service.ts on the API side
 * looks up the template's attachment row and passes its storageKey
 * through as job data), replacing C-2 spike's local-filesystem readFile.
 * generateDocument itself needed ZERO changes for this - it already took
 * a Buffer, decoupled from where it came from (see that file's own doc
 * comment) - only this processor's own template-loading step changed.
 */
export interface ContractGenerationJobData {
  tenantSchema: string;
  companyId: string;
  clauseText: string;
  /** null when the contract has no template, or its template has no .docx uploaded yet - falls back to buildDefaultContractDocx() below instead of reading S3. */
  templateStorageKey: string | null;
  context: PlaceholderContext;
  moneyTokens: string[];
  filenameBase: string;
  storageScopeId: string;
}

export function createContractGenerationWorker(connection: Redis): Worker<ContractGenerationJobData, GenerateDocumentResult> {
  const worker = new Worker<ContractGenerationJobData, GenerateDocumentResult>(
    CONTRACT_GENERATION_QUEUE_NAME,
    async (job: Job<ContractGenerationJobData>) => {
      const templateBuffer = job.data.templateStorageKey
        ? await readObjectAsBuffer(env.S3_BUCKET, job.data.templateStorageKey)
        : buildDefaultContractDocx();
      return generateDocument({
        tenantSchema: job.data.tenantSchema,
        companyId: job.data.companyId,
        clauseText: job.data.clauseText,
        templateBuffer,
        context: job.data.context,
        moneyTokens: job.data.moneyTokens,
        filenameBase: job.data.filenameBase,
        storageScopeId: job.data.storageScopeId,
      });
    },
    { connection },
  );

  worker.on("completed", (job, result: GenerateDocumentResult) => {
    logger.info({ jobId: job.id, ...result }, "contract document generation completed");
  });

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "contract document generation failed");
  });

  return worker;
}
