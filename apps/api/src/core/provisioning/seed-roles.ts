import { withTenantSchema } from "../../database/get-db.js";
import { permissions } from "../../database/tenant/schema.js";
import { assignRoleToUser, createRole, grantPermissionToRole } from "../rbac/mutations.js";

export const DEFAULT_ROLE_NAMES = ["Admin", "Manager", "Officer", "Viewer"] as const;
export type DefaultRoleName = (typeof DEFAULT_ROLE_NAMES)[number];

/**
 * Four tiers, each a superset of the one below it, expressed as a
 * predicate over each permission's `action` rather than hand-listing
 * every key - so a new module's permissions fall into a sensible tier
 * automatically instead of silently landing in none of them.
 *
 * - Viewer: read-only, everywhere.
 * - Officer: Viewer + day-to-day data entry (create/update), never
 *   approve/delete/provision or anything role-related - an Officer
 *   manages records, not other people's access.
 * - Manager: Officer + approve actions, role assignment, and the
 *   provisioning exception path (financial approvals and who's assigned
 *   which role are manager-level decisions).
 * - Admin: everything, unconditionally.
 */
const ROLE_PERMISSION_FILTERS: Record<DefaultRoleName, (action: string) => boolean> = {
  Viewer: (action) => action === "read",
  Officer: (action) => ["read", "create", "update"].includes(action),
  Manager: (action) => ["read", "create", "update", "approve", "assign", "provision"].includes(action),
  Admin: () => true,
};

export interface SeedRolesInput {
  schemaName: string;
  companyId: string;
  createdBy: string;
}

export type SeedRolesResult = Record<DefaultRoleName, string>;

/**
 * Not idempotent on its own (core/rbac/mutations.ts's createRole has no
 * "already exists" check) - core/provisioning/provision-tenant.ts's
 * orchestrator is what makes the overall provisioning run idempotent, by
 * skipping this step entirely once a tenant is already active (see its
 * doc comment).
 */
export async function seedDefaultRoles(input: SeedRolesInput): Promise<SeedRolesResult> {
  const allPermissions = await withTenantSchema(input.schemaName, (tx) =>
    tx.select({ id: permissions.id, action: permissions.action }).from(permissions),
  );

  const roleIdsByName = {} as SeedRolesResult;

  for (const roleName of DEFAULT_ROLE_NAMES) {
    const role = await createRole({
      schemaName: input.schemaName,
      companyId: input.companyId,
      name: roleName,
      isSystem: true,
      createdBy: input.createdBy,
    });
    roleIdsByName[roleName] = role.id;

    const filter = ROLE_PERMISSION_FILTERS[roleName];
    const grantedPermissionIds = allPermissions
      .filter((permission) => filter(permission.action))
      .map((permission) => permission.id);

    for (const permissionId of grantedPermissionIds) {
      await grantPermissionToRole(input.schemaName, input.companyId, role.id, permissionId, input.createdBy);
    }
  }

  return roleIdsByName;
}

export async function assignDefaultRole(
  schemaName: string,
  companyId: string,
  userId: string,
  roleId: string,
  assignedBy: string,
): Promise<void> {
  await assignRoleToUser(schemaName, companyId, userId, roleId, assignedBy);
}
