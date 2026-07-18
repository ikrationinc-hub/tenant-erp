import { redis } from "../../config/redis.js";
import type { FieldPermission, ResolvedPermissions } from "./types.js";

const VERSION_PREFIX = "rbac:role-version:";
const RESOLVED_PREFIX = "rbac:resolved:";
const RESOLVED_TTL_SECONDS = 60 * 60;

/**
 * role_version is tracked per COMPANY, not per user: roles/permissions are
 * company-scoped, and a single role edit can affect every user holding
 * that role. Bumping one counter invalidates all of them at once, with no
 * need to enumerate which users are affected. Missing key = version 0,
 * NOT 1: Redis's INCR on a missing key sets it to 1, so if "missing" and
 * "post-first-bump" both read as 1, a company's very first-ever role
 * change would be invisible to the cache key (same version before and
 * after), leaving a stale cached result live under the "new" version too.
 * This was a real bug, caught by an equivalent single-bump test in
 * core/menu-engine/cache.ts before it was fixed here too - 0 as the
 * missing-key baseline means the first bump (0 -> 1 via INCR) is always a
 * genuine, cache-key-visible transition.
 */
export async function getRoleVersion(companyId: string): Promise<number> {
  const value = await redis.get(`${VERSION_PREFIX}${companyId}`);
  return value === null ? 0 : Number(value);
}

/** Called by every core/rbac mutation on a successful DB change - never anywhere else. */
export async function bumpRoleVersion(companyId: string): Promise<number> {
  return redis.incr(`${VERSION_PREFIX}${companyId}`);
}

function cacheKey(userId: string, roleVersion: number): string {
  return `${RESOLVED_PREFIX}${userId}:${roleVersion}`;
}

interface SerializedResolvedPermissions {
  permissions: string[];
  fieldPermissions: [string, FieldPermission][];
}

export async function getCachedResolvedPermissions(
  userId: string,
  roleVersion: number,
): Promise<ResolvedPermissions | undefined> {
  const raw = await redis.get(cacheKey(userId, roleVersion));
  if (raw === null) {
    return undefined;
  }
  const parsed = JSON.parse(raw) as SerializedResolvedPermissions;
  return {
    permissions: new Set(parsed.permissions),
    fieldPermissions: new Map(parsed.fieldPermissions),
  };
}

export async function setCachedResolvedPermissions(
  userId: string,
  roleVersion: number,
  resolved: ResolvedPermissions,
): Promise<void> {
  const serialized: SerializedResolvedPermissions = {
    permissions: [...resolved.permissions],
    fieldPermissions: [...resolved.fieldPermissions.entries()],
  };
  await redis.set(cacheKey(userId, roleVersion), JSON.stringify(serialized), "EX", RESOLVED_TTL_SECONDS);
}
