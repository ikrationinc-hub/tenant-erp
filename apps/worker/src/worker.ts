import { Queue } from "bullmq";
import { createRedisConnection } from "./config/redis.js";
import { logger } from "./config/logger.js";
import { startWorkerHeartbeat } from "./heartbeat.js";
import { closePlatformDbPool } from "./database/get-platform-db.js";
import { closeTenantDbPool } from "./database/get-tenant-db.js";
import { CLAUSE_PROMOTION_QUEUE_NAME, CLAUSE_PROMOTION_REPEAT_JOB_ID } from "./queues/clause-promotion.queue.js";
import { createClausePromotionWorker } from "./workers/clause-promotion.worker.js";
import { createContractGenerationWorker } from "./workers/contract-generation.worker.js";
import { createExampleWorker } from "./workers/example.worker.js";

const connection = createRedisConnection();
const workers = [createExampleWorker(connection), createClausePromotionWorker(connection), createContractGenerationWorker(connection)];
const heartbeatTimer = startWorkerHeartbeat(connection);

// docs/CONTRACT-MODULE-BUILD.md C-1 item 5: every 5 minutes is frequent
// enough that a future-dated clause version goes Active within minutes of
// its effectiveFrom arriving, without the DB-round-trip cost of anything
// tighter - the on-access fallback (apps/api's clauses.service.ts) covers
// the gap for anyone who reads a clause before this next tick anyway.
const clausePromotionQueue = new Queue(CLAUSE_PROMOTION_QUEUE_NAME, { connection });
await clausePromotionQueue.add(
  "promote",
  {},
  { repeat: { every: 5 * 60 * 1000 }, jobId: CLAUSE_PROMOTION_REPEAT_JOB_ID },
);

logger.info({ workerCount: workers.length }, "worker process started");

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "shutting down");
  clearInterval(heartbeatTimer);
  await Promise.all(workers.map((worker) => worker.close()));
  await clausePromotionQueue.close();
  await closeTenantDbPool();
  await closePlatformDbPool();
  await connection.quit();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
