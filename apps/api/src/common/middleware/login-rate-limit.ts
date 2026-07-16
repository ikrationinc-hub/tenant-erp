import { rateLimit } from "express-rate-limit";
import RedisStore, { type RedisReply } from "rate-limit-redis";
import { redis } from "../../config/redis.js";

/**
 * IP-based volume throttle on /login, backed by Redis so it's consistent
 * across multiple API instances. Per-email failure lockout is the stricter,
 * security-relevant mechanism (core/auth/login-rate-limit.ts, 5 failures);
 * this one only guards against raw request-volume flooding from one IP
 * (many different emails, or a scripted retry loop), so the ceiling can
 * stay generous without weakening brute-force protection.
 */
export const loginIpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  store: new RedisStore({
    // Two interop casts, neither hiding a real type error: (1) ioredis's
    // `call` needs a non-empty tuple to match its overload, but rate-limit-
    // redis calls sendCommand with a plain string[] that is always non-empty
    // in practice; (2) `call`'s return is typed Promise<unknown> (it
    // multiplexes every redis reply shape) where rate-limit-redis wants
    // Promise<RedisReply> - both are correct about the same runtime values.
    sendCommand: (...args: string[]) =>
      redis.call(...(args as [string, ...string[]])) as Promise<RedisReply>,
  }),
});
