import { redis } from "../../config/redis.js";
import type { FieldPermission, ResolvedPermissions } from "./types.js";

const VERSION_PREFIX = "rbac:role-version:";
const RESOLVED_PREFIX = "rbac:resolved:";
const RESOLVED_TTL_SECONDS = 60 * 60;

/**
 * role_version is tracked per COMPANY, not per user: roles/permissions are
 * company-scoped, and a single role edit can affect every user holding
 * that role. Bumping one counter invalidates all of them at once, with no
 * need to enumerate which users are affected. Missing key = version 1,
 * matching a first-ever INCR's result, so the two paths agree on the
 * starting point for a company that's never had a change.
 */
export async function getRoleVersion(companyId: string): Promise<number> {
  const value = await redis.get(`${VERSION_PREFIX}${companyId}`);
  return value === null ? 1 : Number(value);
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
