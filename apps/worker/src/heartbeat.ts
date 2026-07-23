import type { Redis } from "ioredis";
import { logger } from "./config/logger.js";

/**
 * Read by apps/api's GET /api/v1/platform/health (ADM-5,
 * modules/platform/platform-health.service.ts) - same key, duplicated
 * there since there's no shared package between apps/api and apps/worker
 * for a constant this small. Keep both in sync if it ever changes.
 */
export const WORKER_HEARTBEAT_KEY = "platform:worker:heartbeat";
const HEARTBEAT_INTERVAL_MS = 10_000;
/** Comfortably longer than the write interval - a stopped worker's key expires and the health check reads that as "down" with no separate staleness check needed. */
const HEARTBEAT_TTL_SECONDS = 30;

export function startWorkerHeartbeat(connection: Redis): NodeJS.Timeout {
  const write = (): void => {
    connection
      .set(WORKER_HEARTBEAT_KEY, new Date().toISOString(), "EX", HEARTBEAT_TTL_SECONDS)
      .catch((err: unknown) => {
        logger.error({ err }, "failed to write worker heartbeat");
      });
  };

  write();
  return setInterval(write, HEARTBEAT_INTERVAL_MS);
}
