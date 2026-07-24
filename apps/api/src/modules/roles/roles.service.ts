import type { RequestContext } from "../../common/context/request-context.js";
import { ConflictError, NotFoundError, UnauthorizedError } from "../../common/errors/index.js";
import type { MasterOption, PaginatedRows } from "../../core/masters/types.js";
import { createRole, grantPermissionToRole, renameRole, revokePermissionFromRole, setFieldPermission } from "../../core/rbac/mutations.js";
import {
  findFieldPermissionOverrides,
  findPermissionByKey,
  findRoleByName,
  findRoleById,
  getGrantedPermissionKeys,
  listRoles as listRolesQuery,
  type FieldPermissionOverrideRow,
  type RoleRow,
  type RolesListParams,
} from "../../core/rbac/queries.js";
import { withTenantDb } from "../../database/get-db.js";
import type { CreateRoleInput, SaveFieldPermissionsInput, UpdateRoleInput } from "./roles.validator.js";

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

export async function list(ctx: RequestContext, params: RolesListParams): Promise<PaginatedRows<RoleRow>> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, (tx) => listRolesQuery(tx, scope.companyId, params));
}

export async function listOptions(ctx: RequestContext): Promise<MasterOption[]> {
  const scope = requireTenantScope(ctx);
  const result = await withTenantDb(ctx, (tx) => listRolesQuery(tx, scope.companyId, { page: 1, pageSize: 1000 }));
  return result.items.map((role) => ({ value: role.id, label: role.name }));
}

export async function create(ctx: RequestContext, input: CreateRoleInput): Promise<RoleRow> {
  const scope = requireTenantScope(ctx);

  const existing = await withTenantDb(ctx, (tx) => findRoleByName(tx, scope.companyId, input.name));
  if (existing) {
    throw new ConflictError(`A role named "${input.name}" already exists`);
  }

  return createRole({
    schemaName: scope.tenantSchema,
    companyId: scope.companyId,
    name: input.name,
    createdBy: scope.userId,
  });
}

export async function rename(ctx: RequestContext, roleId: string, input: UpdateRoleInput): Promise<RoleRow> {
  const scope = requireTenantScope(ctx);

  const existing = await withTenantDb(ctx, (tx) => findRoleById(tx, scope.companyId, roleId));
  if (!existing) {
    throw new NotFoundError("Role not found");
  }

  if (input.name !== existing.name) {
    const nameOwner = await withTenantDb(ctx, (tx) => findRoleByName(tx, scope.companyId, input.name));
    if (nameOwner && nameOwner.id !== roleId) {
      throw new ConflictError(`A role named "${input.name}" already exists`);
    }
  }

  return renameRole({
    schemaName: scope.tenantSchema,
    companyId: scope.companyId,
    roleId,
    name: input.name,
    updatedBy: scope.userId,
  });
}

async function requireRole(ctx: RequestContext, roleId: string): Promise<RoleRow> {
  const scope = requireTenantScope(ctx);
  const role = await withTenantDb(ctx, (tx) => findRoleById(tx, scope.companyId, roleId));
  if (!role) {
    throw new NotFoundError("Role not found");
  }
  return role;
}

export async function getGrantedPermissions(ctx: RequestContext, roleId: string): Promise<string[]> {
  await requireRole(ctx, roleId);
  return withTenantDb(ctx, (tx) => getGrantedPermissionKeys(tx, roleId));
}

export async function grantPermission(ctx: RequestContext, roleId: string, permissionKey: string): Promise<void> {
  const scope = requireTenantScope(ctx);
  await requireRole(ctx, roleId);

  const permission = await withTenantDb(ctx, (tx) => findPermissionByKey(tx, permissionKey));
  if (!permission) {
    throw new NotFoundError(`Unknown permission "${permissionKey}"`);
  }

  await grantPermissionToRole(scope.tenantSchema, scope.companyId, roleId, permission.id, scope.userId);
}

export async function revokePermission(ctx: RequestContext, roleId: string, permissionKey: string): Promise<void> {
  const scope = requireTenantScope(ctx);
  await requireRole(ctx, roleId);

  const permission = await withTenantDb(ctx, (tx) => findPermissionByKey(tx, permissionKey));
  if (!permission) {
    throw new NotFoundError(`Unknown permission "${permissionKey}"`);
  }

  await revokePermissionFromRole(scope.tenantSchema, scope.companyId, roleId, permission.id, scope.userId);
}

export async function getFieldPermissions(
  ctx: RequestContext,
  roleId: string,
  module: string,
  entity: string,
): Promise<FieldPermissionOverrideRow[]> {
  const scope = requireTenantScope(ctx);
  await requireRole(ctx, roleId);
  return withTenantDb(ctx, (tx) => findFieldPermissionOverrides(tx, scope.companyId, roleId, module, entity));
}

/** One batch save (task item 15) - loops setFieldPermission (itself already a per-row upsert) over the whole matrix for this (role, module, entity). */
export async function saveFieldPermissions(
  ctx: RequestContext,
  roleId: string,
  input: SaveFieldPermissionsInput,
): Promise<void> {
  const scope = requireTenantScope(ctx);
  await requireRole(ctx, roleId);

  for (const row of input.rows) {
    // Sequential, not concurrent: each call is its own soft-revoke-then-
    // insert against the same unique (role, module, entity, field) index -
    // running them concurrently would race two upserts against the same
    // key when a matrix has duplicate fieldKeys (shouldn't happen, but
    // isn't worth risking for a save that's already a handful of rows).
    await setFieldPermission({
      schemaName: scope.tenantSchema,
      companyId: scope.companyId,
      roleId,
      module: input.module,
      entity: input.entity,
      fieldKey: row.fieldKey,
      canView: row.canView,
      canEdit: row.canEdit,
      createdBy: scope.userId,
    });
  }
}
