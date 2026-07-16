import { redis } from "../../config/redis.js";

const DENYLIST_PREFIX = "auth:denylist:";

/** Denylists an access token's jti until it would have expired anyway - no point keeping it longer. */
export async function denylistJti(jti: string, ttlSeconds: number): Promise<void> {
  if (ttlSeconds <= 0) {
    return;
  }
  await redis.set(`${DENYLIST_PREFIX}${jti}`, "1", "EX", ttlSeconds);
}

export async function isJtiDenylisted(jti: string): Promise<boolean> {
  const value = await redis.get(`${DENYLIST_PREFIX}${jti}`);
  return value !== null;
}
