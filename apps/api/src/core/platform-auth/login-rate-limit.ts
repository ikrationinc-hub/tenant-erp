import { redis } from "../../config/redis.js";

const FAILURE_PREFIX = "platform-auth:login-failures:";
const MAX_FAILURES = 5;
const LOCKOUT_WINDOW_SECONDS = 15 * 60;

/**
 * Mirrors core/auth/login-rate-limit.ts, minus the tenant-schema component
 * of the key - a platform admin isn't scoped to any tenant, so email alone
 * is enough to key the lockout.
 */
function keyFor(email: string): string {
  return `${FAILURE_PREFIX}${email.toLowerCase()}`;
}

export async function isLockedOut(email: string): Promise<boolean> {
  const count = await redis.get(keyFor(email));
  return count !== null && Number(count) >= MAX_FAILURES;
}

export async function recordLoginFailure(email: string): Promise<void> {
  const key = keyFor(email);
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, LOCKOUT_WINDOW_SECONDS);
  }
}

export async function clearLoginFailures(email: string): Promise<void> {
  await redis.del(keyFor(email));
}
