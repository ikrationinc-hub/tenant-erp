import { rateLimit } from "express-rate-limit";
import RedisStore, { type RedisReply } from "rate-limit-redis";
import { redis } from "../../config/redis.js";

/**
 * IP-based volume throttle on /platform/auth/login, mirroring
 * common/middleware/login-rate-limit.ts's loginIpRateLimiter exactly except
 * for the `prefix` - a distinct prefix keeps platform login traffic from
 * sharing (and thus skewing) the tenant login IP-rate-limit counters, even
 * though both limiters watch the same Redis instance.
 */
export const platformLoginIpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  store: new RedisStore({
    prefix: "platform-rl:",
    sendCommand: (...args: string[]) =>
      redis.call(...(args as [string, ...string[]])) as Promise<RedisReply>,
  }),
});
