import { Queue } from "bullmq";
import { createRedisConnection } from "./config/redis.js";
import { logger } from "./config/logger.js";
import { startWorkerHeartbeat } from "./heartbeat.js";
import { closePlatformDbPool } from "./database/get-platform-db.js";
import { closeTenantDbPool } from "./database/get-tenant-db.js";
import { CLAUSE_PROMOTION_QUEUE_NAME, CLAUSE_PROMOTION_REPEAT_JOB_ID } from "./queues/clause-promotion.queue.js";
import { SALES_DASHBOARD_REFRESH_QUEUE_NAME, SALES_DASHBOARD_REFRESH_REPEAT_JOB_ID } from "./queues/sales-dashboard-refresh.queue.js";
import { createClausePromotionWorker } from "./workers/clause-promotion.worker.js";
import { createContractGenerationWorker } from "./workers/contract-generation.worker.js";
import { createExampleWorker } from "./workers/example.worker.js";
import { createSalesDashboardRefreshWorker } from "./workers/sales-dashboard-refresh.worker.js";

const connection = createRedisConnection();
const workers = [
  createExampleWorker(connection),
  createClausePromotionWorker(connection),
  createContractGenerationWorker(connection),
  createSalesDashboardRefreshWorker(connection),
];
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

// docs/SALES-MODULE-PLAN.md S-6: every 15 minutes - a heavier aggregate
// job than clause-promotion's simple status sweep (it re-derives Gross/
// Net Profit via cost-allocation over every delivered sales item in the
// company for the month), so a longer interval than clause-promotion's
// 5 minutes is appropriate; GET /sales/dashboard only ever reads the
// cache these refreshes write, never recomputing live.
const salesDashboardRefreshQueue = new Queue(SALES_DASHBOARD_REFRESH_QUEUE_NAME, { connection });
await salesDashboardRefreshQueue.add(
  "refresh",
  {},
  { repeat: { every: 15 * 60 * 1000 }, jobId: SALES_DASHBOARD_REFRESH_REPEAT_JOB_ID },
);

logger.info({ workerCount: workers.length }, "worker process started");

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "shutting down");
  clearInterval(heartbeatTimer);
  await Promise.all(workers.map((worker) => worker.close()));
  await clausePromotionQueue.close();
  await salesDashboardRefreshQueue.close();
  await closeTenantDbPool();
  await closePlatformDbPool();
  await connection.quit();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
