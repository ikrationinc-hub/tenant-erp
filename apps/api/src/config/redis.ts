import { Redis } from "ioredis";
import { env } from "./env.js";
import { logger } from "./logger.js";

export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

redis.on("error", (err) => {
  logger.error({ err }, "unexpected error on redis client");
});

export async function closeRedis(): Promise<void> {
  await redis.quit();
}

/** Read by GET /api/v1/platform/health (ADM-5) - a real PING, not just "the client object exists". */
export async function checkRedisHealth(): Promise<boolean> {
  try {
    return (await redis.ping()) === "PONG";
  } catch (err) {
    logger.error({ err }, "redis health check failed");
    return false;
  }
}
