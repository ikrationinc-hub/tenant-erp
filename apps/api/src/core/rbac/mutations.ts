import { and, eq, isNull } from "drizzle-orm";
import { withTenantSchema } from "../../database/get-db.js";
import { fieldPermissions, roles, rolePermissions, userRoles } from "../../database/tenant/schema.js";
import { bumpRoleVersion } from "./cache.js";

/**
 * Every mutation here is the ONLY way role/permission/field-permission data
 * changes - each one bumps role_version for the company in the same breath
 * as the DB write, so a change takes effect on the very next resolve() call
 * (task requirement: "a role change takes effect immediately, not after
 * TTL"). Nothing outside this file should ever write to roles,
 * role_permissions, user_roles, or field_permissions.
 */

export interface CreateRoleInput {
  schemaName: string;
  companyId: string;
  name: string;
  isSystem?: boolean;
  createdBy: string;
}

export async function createRole(input: CreateRoleInput): Promise<typeof roles.$inferSelect> {
  const [role] = await withTenantSchema(input.schemaName, (tx) =>
    tx
      .insert(roles)
      .values({
        companyId: input.companyId,
        name: input.name,
        isSystem: input.isSystem ?? false,
        createdBy: input.createdBy,
      })
      .returning(),
  );
  if (!role) {
    throw new Error("failed to insert role");
  }
  await bumpRoleVersion(input.companyId);
  return role;
}

export async function assignRoleToUser(
  schemaName: string,
  companyId: string,
  userId: string,
  roleId: string,
  createdBy: string,
): Promise<void> {
  await withTenantSchema(schemaName, (tx) =>
    tx.insert(userRoles).values({ userId, roleId, createdBy }),
  );
  await bumpRoleVersion(companyId);
}

export async function revokeRoleFromUser(
  schemaName: string,
  companyId: string,
  userId: string,
  roleId: string,
): Promise<void> {
  await withTenantSchema(schemaName, (tx) =>
    tx
      .update(userRoles)
      .set({ deletedAt: new Date() })
      .where(
        and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId), isNull(userRoles.deletedAt)),
      ),
  );
  await bumpRoleVersion(companyId);
}

export async function grantPermissionToRole(
  schemaName: string,
  companyId: string,
  roleId: string,
  permissionId: string,
  createdBy: string,
): Promise<void> {
  await withTenantSchema(schemaName, (tx) =>
    tx.insert(rolePermissions).values({ roleId, permissionId, createdBy }),
  );
  await bumpRoleVersion(companyId);
}

export async function revokePermissionFromRole(
  schemaName: string,
  companyId: string,
  roleId: string,
  permissionId: string,
): Promise<void> {
  await withTenantSchema(schemaName, (tx) =>
    tx
      .update(rolePermissions)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(rolePermissions.roleId, roleId),
          eq(rolePermissions.permissionId, permissionId),
          isNull(rolePermissions.deletedAt),
        ),
      ),
  );
  await bumpRoleVersion(companyId);
}

export interface SetFieldPermissionInput {
  schemaName: string;
  companyId: string;
  roleId: string;
  module: string;
  entity: string;
  fieldKey: string;
  canView: boolean;
  canEdit: boolean;
  createdBy: string;
}

/** Upsert: soft-revokes any existing row for this (role, module, entity, field) and inserts the new rule. */
export async function setFieldPermission(input: SetFieldPermissionInput): Promise<void> {
  await withTenantSchema(input.schemaName, async (tx) => {
    await tx
      .update(fieldPermissions)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(fieldPermissions.companyId, input.companyId),
          eq(fieldPermissions.roleId, input.roleId),
          eq(fieldPermissions.module, input.module),
          eq(fieldPermissions.entity, input.entity),
          eq(fieldPermissions.fieldKey, input.fieldKey),
          isNull(fieldPermissions.deletedAt),
        ),
      );

    await tx.insert(fieldPermissions).values({
      companyId: input.companyId,
      roleId: input.roleId,
      module: input.module,
      entity: input.entity,
      fieldKey: input.fieldKey,
      canView: input.canView,
      canEdit: input.canEdit,
      createdBy: input.createdBy,
    });
  });
  await bumpRoleVersion(input.companyId);
}
