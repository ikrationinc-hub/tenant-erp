import { redis } from "../../config/redis.js";

const VERSION_PREFIX = "menu:version:";
const TREE_PREFIX = "menu:tree:";
const TREE_TTL_SECONDS = 60 * 60;

/**
 * Mirrors core/rbac/cache.ts's role_version exactly - per COMPANY (menus
 * are company-scoped), missing key = version 0 (NOT 1 - see
 * core/rbac/cache.ts's getRoleVersion doc comment: Redis's INCR on a
 * missing key sets it to 1, so "missing" and "1" must not both mean the
 * same thing, or a company's first-ever change is invisible to the cache
 * key). Bumped by both core/menu-engine/mutations.ts (a menu itself
 * changed) AND core/module-registry/tenant-modules.ts's setModuleEnabled
 * (a module's enabled state changed, which can change which menu items
 * resolve to visible even though no menu row changed) - both are
 * "menu_version" changes from the cache key's point of view (task: "Cache
 * in Redis keyed user_id:role_version:menu_version. Invalidate on role,
 * menu, or module change" - role change is already covered by
 * role_version, which this cache key also incorporates).
 */
export async function getMenuVersion(companyId: string): Promise<number> {
  const value = await redis.get(`${VERSION_PREFIX}${companyId}`);
  return value === null ? 0 : Number(value);
}

export async function bumpMenuVersion(companyId: string): Promise<number> {
  return redis.incr(`${VERSION_PREFIX}${companyId}`);
}

function treeCacheKey(userId: string, roleVersion: number, menuVersion: number): string {
  return `${TREE_PREFIX}${userId}:${roleVersion}:${menuVersion}`;
}

export async function getCachedMenuTree<T>(
  userId: string,
  roleVersion: number,
  menuVersion: number,
): Promise<T | undefined> {
  const raw = await redis.get(treeCacheKey(userId, roleVersion, menuVersion));
  return raw === null ? undefined : (JSON.parse(raw) as T);
}

export async function setCachedMenuTree<T>(
  userId: string,
  roleVersion: number,
  menuVersion: number,
  tree: T,
): Promise<void> {
  await redis.set(
    treeCacheKey(userId, roleVersion, menuVersion),
    JSON.stringify(tree),
    "EX",
    TREE_TTL_SECONDS,
  );
}
