import { redis } from "../../config/redis.js";

const VERSION_PREFIX = "field:version:";
const DEFS_PREFIX = "field:defs:";
const DEFS_TTL_SECONDS = 60 * 60;

function versionKey(companyId: string, module: string, entity: string): string {
  return `${VERSION_PREFIX}${companyId}:${module}:${entity}`;
}

/**
 * Per (company, module, entity), NOT per user - the merged code-defaults-
 * plus-company-overrides result is identical for every user in a company
 * (task's literal cache key: "company_id:module:entity:field_version",
 * no user/role component at all). Per-user narrowing (RBAC field
 * permissions) is applied AFTER this cached result, uncached, in
 * core/field-engine/resolve.ts - cheap once you already have both the
 * base field list and the user's already-separately-cached resolved
 * permissions (core/rbac/cache.ts).
 *
 * Missing key = version 0, not 1 - see core/rbac/cache.ts's
 * getRoleVersion doc comment for why (Redis's INCR on a missing key
 * returns 1, so "missing" and "1" must not both mean the same version or
 * a company's first-ever field override is invisible to the cache key).
 */
export async function getFieldVersion(companyId: string, module: string, entity: string): Promise<number> {
  const value = await redis.get(versionKey(companyId, module, entity));
  return value === null ? 0 : Number(value);
}

export async function bumpFieldVersion(companyId: string, module: string, entity: string): Promise<number> {
  return redis.incr(versionKey(companyId, module, entity));
}

function defsCacheKey(companyId: string, module: string, entity: string, fieldVersion: number): string {
  return `${DEFS_PREFIX}${companyId}:${module}:${entity}:${fieldVersion}`;
}

export async function getCachedFieldDefinitions<T>(
  companyId: string,
  module: string,
  entity: string,
  fieldVersion: number,
): Promise<T | undefined> {
  const raw = await redis.get(defsCacheKey(companyId, module, entity, fieldVersion));
  return raw === null ? undefined : (JSON.parse(raw) as T);
}

export async function setCachedFieldDefinitions<T>(
  companyId: string,
  module: string,
  entity: string,
  fieldVersion: number,
  definitions: T,
): Promise<void> {
  await redis.set(
    defsCacheKey(companyId, module, entity, fieldVersion),
    JSON.stringify(definitions),
    "EX",
    DEFS_TTL_SECONDS,
  );
}
