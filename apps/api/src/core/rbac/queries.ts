import { and, asc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "../../database/get-db.js";
import type { PaginatedRows } from "../masters/types.js";
import { fieldPermissions, permissions, roles, rolePermissions, userRoles } from "../../database/tenant/schema.js";

export type RoleRow = typeof roles.$inferSelect;
export type PermissionRow = typeof permissions.$inferSelect;

export interface RolesListParams {
  page: number;
  pageSize: number;
  search?: string | undefined;
}

/** Company-scoped, same as every other table with a real company_id column (roles.companyId, schema.ts) - a role belongs to one legal entity, matching field_permissions' own companyId scoping. */
export async function listRoles(tx: TenantTx, companyId: string, params: RolesListParams): Promise<PaginatedRows<RoleRow>> {
  const conditions = [eq(roles.companyId, companyId), isNull(roles.deletedAt)];
  if (params.search) {
    conditions.push(ilike(roles.name, `%${params.search}%`));
  }
  const where = and(...conditions);
  const offset = (params.page - 1) * params.pageSize;

  const [rows, totalRows] = await Promise.all([
    tx.select().from(roles).where(where).orderBy(asc(roles.name)).limit(params.pageSize).offset(offset),
    tx.select({ value: sql<number>`count(*)::int` }).from(roles).where(where),
  ]);

  return { items: rows, total: totalRows[0]?.value ?? 0, page: params.page, pageSize: params.pageSize };
}

export async function findRoleById(tx: TenantTx, companyId: string, id: string): Promise<RoleRow | undefined> {
  const [row] = await tx
    .select()
    .from(roles)
    .where(and(eq(roles.id, id), eq(roles.companyId, companyId), isNull(roles.deletedAt)))
    .limit(1);
  return row;
}

export async function findRoleByName(tx: TenantTx, companyId: string, name: string): Promise<RoleRow | undefined> {
  const [row] = await tx
    .select()
    .from(roles)
    .where(and(eq(roles.name, name), eq(roles.companyId, companyId), isNull(roles.deletedAt)))
    .limit(1);
  return row;
}

/** A role's current grants (GET /roles/:id/permissions, task item 12) - keys, not ids, since the REST contract deals entirely in human-readable permission keys (packages/contracts/src/role-permissions.ts). */
export async function getGrantedPermissionKeys(tx: TenantTx, roleId: string): Promise<string[]> {
  const rows = await tx
    .select({ key: permissions.key })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(eq(rolePermissions.roleId, roleId), isNull(rolePermissions.deletedAt)));
  return rows.map((row) => row.key);
}

/** Looks up a permission's id by its catalogue key - grantPermissionToRole/revokePermissionFromRole (mutations.ts) take an id, but the REST layer's request body is the human-readable key (packages/contracts/src/role-permissions.ts). */
export async function findPermissionByKey(tx: TenantTx, key: string): Promise<PermissionRow | undefined> {
  const [row] = await tx.select().from(permissions).where(eq(permissions.key, key)).limit(1);
  return row;
}

export interface FieldPermissionOverrideRow {
  fieldKey: string;
  canView: boolean;
  canEdit: boolean;
}

/** Only explicit overrides (task item 14) - an unlisted field means "no override", which apps/web's FieldPermissionMatrix already treats as view+edit both true. */
export async function findFieldPermissionOverrides(
  tx: TenantTx,
  companyId: string,
  roleId: string,
  module: string,
  entity: string,
): Promise<FieldPermissionOverrideRow[]> {
  const rows = await tx
    .select({ fieldKey: fieldPermissions.fieldKey, canView: fieldPermissions.canView, canEdit: fieldPermissions.canEdit })
    .from(fieldPermissions)
    .where(
      and(
        eq(fieldPermissions.companyId, companyId),
        eq(fieldPermissions.roleId, roleId),
        eq(fieldPermissions.module, module),
        eq(fieldPermissions.entity, entity),
        isNull(fieldPermissions.deletedAt),
      ),
    );
  return rows;
}

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

/** The user's current (non-revoked) role assignments - PUT /users/:id/roles's diff base (task item 7). */
export async function findRoleIdsForUser(tx: TenantTx, userId: string): Promise<Set<string>> {
  const rows = await tx
    .select({ roleId: userRoles.roleId })
    .from(userRoles)
    .where(and(eq(userRoles.userId, userId), isNull(userRoles.deletedAt)));
  return new Set(rows.map((row) => row.roleId));
}
