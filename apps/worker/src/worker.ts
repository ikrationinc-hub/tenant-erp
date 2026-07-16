import { createRedisConnection } from "./config/redis.js";
import { logger } from "./config/logger.js";
import { createExampleWorker } from "./workers/example.worker.js";

const connection = createRedisConnection();
const workers = [createExampleWorker(connection)];

logger.info({ workerCount: workers.length }, "worker process started");

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "shutting down");
  await Promise.all(workers.map((worker) => worker.close()));
  await connection.quit();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
