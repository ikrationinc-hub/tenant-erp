import { eq } from "drizzle-orm";
import type { RequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import { withTenantDb } from "../../database/get-db.js";
import { menus } from "../../database/tenant/schema.js";
import { isModuleEnabledForTenant } from "../module-registry/tenant-modules.js";
import { getRoleVersion } from "../rbac/cache.js";
import { resolve } from "../rbac/resolve.js";
import { getCachedMenuTree, getMenuVersion, setCachedMenuTree } from "./cache.js";

export interface MenuNode {
  id: string;
  key: string;
  label: string;
  path: string | null;
  icon: string | null;
  sortOrder: number;
  children: MenuNode[];
}

type MenuRow = typeof menus.$inferSelect;

/**
 * A node is visible only if ALL three gates pass (task item 5: "filtered
 * ... by permissions AND enabled modules"), plus its own is_visible flag.
 * A parent that fails any gate excludes its entire subtree, even for a
 * child that would otherwise pass on its own - a hidden section header
 * hiding what's under it, not leaving orphaned children floating at the
 * top level, is the only sane interpretation of a tree with permission
 * gates at multiple levels.
 */
function isNodeVisible(
  row: MenuRow,
  permissions: Set<string>,
  enabledModuleKeys: Set<string>,
): boolean {
  if (!row.isVisible) {
    return false;
  }
  if (row.requiredPermission && !permissions.has(row.requiredPermission)) {
    return false;
  }
  if (row.moduleKey && !enabledModuleKeys.has(row.moduleKey)) {
    return false;
  }
  return true;
}

function toNode(row: MenuRow): MenuNode {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    path: row.path,
    icon: row.icon,
    sortOrder: row.sortOrder,
    children: [],
  };
}

function buildTree(
  rows: MenuRow[],
  permissions: Set<string>,
  enabledModuleKeys: Set<string>,
): MenuNode[] {
  const byParent = new Map<string | null, MenuRow[]>();
  for (const row of rows) {
    const key = row.parentId ?? null;
    const siblings = byParent.get(key) ?? [];
    siblings.push(row);
    byParent.set(key, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  function walk(parentId: string | null): MenuNode[] {
    const children = byParent.get(parentId) ?? [];
    const nodes: MenuNode[] = [];
    for (const row of children) {
      if (!isNodeVisible(row, permissions, enabledModuleKeys)) {
        continue;
      }
      const node = toNode(row);
      node.children = walk(row.id);
      nodes.push(node);
    }
    return nodes;
  }

  return walk(null);
}

export async function resolveMenuTree(ctx: RequestContext): Promise<MenuNode[]> {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  const { userId, companyId, tenantId } = scope;

  const [roleVersion, menuVersion] = await Promise.all([
    getRoleVersion(companyId),
    getMenuVersion(companyId),
  ]);

  const cached = await getCachedMenuTree<MenuNode[]>(userId, roleVersion, menuVersion);
  if (cached) {
    return cached;
  }

  const [resolved, rows] = await Promise.all([
    resolve(ctx),
    withTenantDb(ctx, (tx) => tx.select().from(menus).where(eq(menus.companyId, companyId))),
  ]);

  const distinctModuleKeys = [...new Set(rows.map((row) => row.moduleKey).filter((key) => key !== null))];
  const enabledFlags = await Promise.all(
    distinctModuleKeys.map((key) => isModuleEnabledForTenant(tenantId, key)),
  );
  const enabledModuleKeys = new Set(
    distinctModuleKeys.filter((_key, index) => enabledFlags[index]),
  );

  const tree = buildTree(rows, resolved.permissions, enabledModuleKeys);

  await setCachedMenuTree(userId, roleVersion, menuVersion, tree);
  return tree;
}
