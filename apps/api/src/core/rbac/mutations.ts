import { and, eq, isNull } from "drizzle-orm";
import { NotFoundError } from "../../common/errors/index.js";
import { insertAuditLog } from "../audit/write.js";
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
 *
 * Each is also now an audited "permission change" (numbering/audit task,
 * CLAUDE.md rule 6): the audit write happens inside the same
 * withTenantSchema transaction as the mutation itself, never after.
 */

export interface CreateRoleInput {
  schemaName: string;
  companyId: string;
  name: string;
  isSystem?: boolean;
  createdBy: string;
}

export async function createRole(input: CreateRoleInput): Promise<typeof roles.$inferSelect> {
  const role = await withTenantSchema(input.schemaName, async (tx) => {
    const [inserted] = await tx
      .insert(roles)
      .values({
        companyId: input.companyId,
        name: input.name,
        isSystem: input.isSystem ?? false,
        createdBy: input.createdBy,
      })
      .returning();
    if (!inserted) {
      throw new Error("failed to insert role");
    }

    await insertAuditLog(tx, {
      companyId: input.companyId,
      changedBy: input.createdBy,
      entity: "role",
      entityId: inserted.id,
      action: "role.created",
      after: { name: input.name, isSystem: input.isSystem ?? false },
    });

    return inserted;
  });
  await bumpRoleVersion(input.companyId);
  return role;
}

export interface RenameRoleInput {
  schemaName: string;
  companyId: string;
  roleId: string;
  name: string;
  updatedBy: string;
}

/** Menus reference a role only by requiredPermission/id, never by name, so renaming needs no menu_version bump - only role_version, same as every other mutation here. */
export async function renameRole(input: RenameRoleInput): Promise<typeof roles.$inferSelect> {
  const role = await withTenantSchema(input.schemaName, async (tx) => {
    const [existing] = await tx
      .select()
      .from(roles)
      .where(and(eq(roles.id, input.roleId), eq(roles.companyId, input.companyId), isNull(roles.deletedAt)));
    if (!existing) {
      throw new NotFoundError("Role not found");
    }

    const [updated] = await tx
      .update(roles)
      .set({ name: input.name, updatedBy: input.updatedBy, updatedAt: new Date() })
      .where(eq(roles.id, input.roleId))
      .returning();
    if (!updated) {
      throw new Error("failed to rename role");
    }

    await insertAuditLog(tx, {
      companyId: input.companyId,
      changedBy: input.updatedBy,
      entity: "role",
      entityId: input.roleId,
      action: "role.renamed",
      before: { name: existing.name },
      after: { name: updated.name },
    });

    return updated;
  });
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
  await withTenantSchema(schemaName, async (tx) => {
    await tx.insert(userRoles).values({ userId, roleId, createdBy });
    await insertAuditLog(tx, {
      companyId,
      changedBy: createdBy,
      entity: "user_role",
      entityId: userId,
      action: "role.assigned",
      after: { userId, roleId },
    });
  });
  await bumpRoleVersion(companyId);
}

export async function revokeRoleFromUser(
  schemaName: string,
  companyId: string,
  userId: string,
  roleId: string,
  revokedBy: string,
): Promise<void> {
  await withTenantSchema(schemaName, async (tx) => {
    await tx
      .update(userRoles)
      .set({ deletedAt: new Date() })
      .where(
        and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId), isNull(userRoles.deletedAt)),
      );
    await insertAuditLog(tx, {
      companyId,
      changedBy: revokedBy,
      entity: "user_role",
      entityId: userId,
      action: "role.revoked",
      before: { userId, roleId },
    });
  });
  await bumpRoleVersion(companyId);
}

export async function grantPermissionToRole(
  schemaName: string,
  companyId: string,
  roleId: string,
  permissionId: string,
  createdBy: string,
): Promise<void> {
  await withTenantSchema(schemaName, async (tx) => {
    await tx.insert(rolePermissions).values({ roleId, permissionId, createdBy });
    await insertAuditLog(tx, {
      companyId,
      changedBy: createdBy,
      entity: "role_permission",
      entityId: roleId,
      action: "permission.granted",
      after: { roleId, permissionId },
    });
  });
  await bumpRoleVersion(companyId);
}

export async function revokePermissionFromRole(
  schemaName: string,
  companyId: string,
  roleId: string,
  permissionId: string,
  revokedBy: string,
): Promise<void> {
  await withTenantSchema(schemaName, async (tx) => {
    await tx
      .update(rolePermissions)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(rolePermissions.roleId, roleId),
          eq(rolePermissions.permissionId, permissionId),
          isNull(rolePermissions.deletedAt),
        ),
      );
    await insertAuditLog(tx, {
      companyId,
      changedBy: revokedBy,
      entity: "role_permission",
      entityId: roleId,
      action: "permission.revoked",
      before: { roleId, permissionId },
    });
  });
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
    const [existing] = await tx
      .select()
      .from(fieldPermissions)
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

    await insertAuditLog(tx, {
      companyId: input.companyId,
      changedBy: input.createdBy,
      entity: "field_permission",
      entityId: input.roleId,
      action: "field_permission.set",
      ...(existing ? { before: { canView: existing.canView, canEdit: existing.canEdit } } : {}),
      after: {
        module: input.module,
        entity: input.entity,
        fieldKey: input.fieldKey,
        canView: input.canView,
        canEdit: input.canEdit,
      },
    });
  });
  await bumpRoleVersion(input.companyId);
}
