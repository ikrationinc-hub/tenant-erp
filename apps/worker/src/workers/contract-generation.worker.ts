import { readFile } from "node:fs/promises";
import { Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import { CONTRACT_GENERATION_QUEUE_NAME } from "../queues/contract-generation.queue.js";
import { generateDocument, type GenerateDocumentResult } from "../contract-generation/generate-document.js";
import type { PlaceholderContext } from "../contract-generation/placeholder-resolver.js";
import { logger } from "../config/logger.js";

/**
 * C-2 item 4: the BullMQ job wrapping generateDocument's pipeline. Job data
 * carries a TEMPLATE FILE PATH, not the template bytes themselves - BullMQ
 * job data round-trips through Redis as JSON, so a multi-hundred-KB .docx
 * buffer has no business living there. C-3b (once a real contract_templates
 * table exists) will source this path from a template's own stored
 * location (S3) instead of the local filesystem this spike uses - the job
 * processor's own logic (resolve -> render -> convert -> store) does not
 * change either way.
 */
export interface ContractGenerationJobData {
  tenantSchema: string;
  companyId: string;
  clauseVersionId: string;
  clauseText: string;
  templateFilePath: string;
  context: PlaceholderContext;
  moneyTokens: string[];
  filenameBase: string;
}

export function createContractGenerationWorker(connection: Redis): Worker<ContractGenerationJobData, GenerateDocumentResult> {
  const worker = new Worker<ContractGenerationJobData, GenerateDocumentResult>(
    CONTRACT_GENERATION_QUEUE_NAME,
    async (job: Job<ContractGenerationJobData>) => {
      const templateBuffer = await readFile(job.data.templateFilePath);
      return generateDocument({
        tenantSchema: job.data.tenantSchema,
        companyId: job.data.companyId,
        clauseVersionId: job.data.clauseVersionId,
        clauseText: job.data.clauseText,
        templateBuffer,
        context: job.data.context,
        moneyTokens: job.data.moneyTokens,
        filenameBase: job.data.filenameBase,
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
