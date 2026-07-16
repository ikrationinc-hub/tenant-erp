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
