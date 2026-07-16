import { Worker } from "bullmq";
import type { Redis } from "ioredis";
import { EXAMPLE_QUEUE_NAME } from "../queues/example.queue.js";
import { logger } from "../config/logger.js";

export function createExampleWorker(connection: Redis): Worker {
  const worker = new Worker(
    EXAMPLE_QUEUE_NAME,
    // eslint-disable-next-line @typescript-eslint/require-await -- BullMQ's Processor type requires a Promise-returning function
    async (job) => {
      logger.info({ jobId: job.id, jobName: job.name }, "processing job");
    },
    { connection },
  );

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id }, "job completed");
  });

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "job failed");
  });

  return worker;
}
