import { redis } from "../../config/redis.js";

const FAILURE_PREFIX = "auth:login-failures:";
const MAX_FAILURES = 5;
const LOCKOUT_WINDOW_SECONDS = 15 * 60;

/**
 * Keyed by the raw attempted email (tenant-scoped), not by whether that
 * email belongs to a real user - an attacker hammering a made-up address
 * gets locked out identically to one hammering a real one, so this can't
 * itself become an email-enumeration signal.
 */
function keyFor(tenantSchema: string, email: string): string {
  return `${FAILURE_PREFIX}${tenantSchema}:${email.toLowerCase()}`;
}

export async function isLockedOut(tenantSchema: string, email: string): Promise<boolean> {
  const count = await redis.get(keyFor(tenantSchema, email));
  return count !== null && Number(count) >= MAX_FAILURES;
}

export async function recordLoginFailure(tenantSchema: string, email: string): Promise<void> {
  const key = keyFor(tenantSchema, email);
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, LOCKOUT_WINDOW_SECONDS);
  }
}

export async function clearLoginFailures(tenantSchema: string, email: string): Promise<void> {
  await redis.del(keyFor(tenantSchema, email));
}
