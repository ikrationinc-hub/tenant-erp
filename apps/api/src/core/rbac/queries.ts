import { and, eq, inArray, isNull } from "drizzle-orm";
import type { TenantTx } from "../../database/get-db.js";
import { permissions, roles, rolePermissions } from "../../database/tenant/schema.js";

/**
 * Read-only, so (unlike core/rbac/mutations.ts's writers) this takes `tx`
 * directly - it composes into a caller's existing transaction rather than
 * opening its own. Lives in core/rbac/ alongside resolve.ts/mutations.ts so
 * every query against role_permissions/permissions has one home, even
 * though this specific query wouldn't trip scripts/check-rbac-boundary.mjs
 * either way (it filters on the `action` column, not a role-name string).
 */
export async function roleIdsExist(
  tx: TenantTx,
  companyId: string,
  roleIds: string[],
): Promise<Set<string>> {
  if (roleIds.length === 0) {
    return new Set();
  }
  const rows = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.companyId, companyId), inArray(roles.id, roleIds), isNull(roles.deletedAt)));
  return new Set(rows.map((row) => row.id));
}

/**
 * "Approval permission" means any permission whose action is literally
 * "approve" (purchase.po.approve today) - a DB column check, not a
 * hardcoded key list, so a future module adding its own *.approve
 * permission is covered automatically.
 */
export async function roleIdsHoldApprovalPermission(
  tx: TenantTx,
  roleIds: string[],
): Promise<boolean> {
  if (roleIds.length === 0) {
    return false;
  }
  const rows = await tx
    .select({ id: permissions.id })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(
      and(
        inArray(rolePermissions.roleId, roleIds),
        isNull(rolePermissions.deletedAt),
        eq(permissions.action, "approve"),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
