import { z } from "zod";

/**
 * Forward-looking (BE-6's core/rbac/mutations.ts has the engine -
 * createRole/grantPermissionToRole/revokePermissionFromRole/
 * setFieldPermission - but no REST layer yet). Every mutation here bumps
 * role_version server-side in the real implementation, so a role change
 * takes effect on the affected user's very next request (no client-side
 * work needed beyond invalidating OUR OWN cached menu/permissions if we
 * happen to be editing our own role, which admins don't).
 */

// --- GET /api/v1/roles/:id/permissions --------------------------------------

export const roleGrantedPermissionsResponseSchema = z.object({
  permissionKeys: z.array(z.string()),
});
export type RoleGrantedPermissionsResponse = z.infer<typeof roleGrantedPermissionsResponseSchema>;

// --- POST /api/v1/roles/:id/permissions (grant) -----------------------------

export const grantRolePermissionRequestSchema = z.object({
  permissionKey: z.string(),
});
export type GrantRolePermissionRequest = z.infer<typeof grantRolePermissionRequestSchema>;

// DELETE /api/v1/roles/:id/permissions/:permissionKey (revoke) - no body.

// --- Field permissions -------------------------------------------------------

/** Mirrors core/rbac/mutations.ts's SetFieldPermissionInput, minus the (role, module, entity) that are already in the URL/query. */
export const fieldPermissionRowSchema = z.object({
  fieldKey: z.string(),
  canView: z.boolean(),
  canEdit: z.boolean(),
});
export type FieldPermissionRow = z.infer<typeof fieldPermissionRowSchema>;

// --- GET /api/v1/roles/:id/field-permissions?module=&entity= ---------------

export const fieldPermissionsResponseSchema = z.object({
  fieldPermissions: z.array(fieldPermissionRowSchema),
});
export type FieldPermissionsResponse = z.infer<typeof fieldPermissionsResponseSchema>;

// --- PUT /api/v1/roles/:id/field-permissions --------------------------------

/** One batch save for the whole matrix - a real backend loops setFieldPermission (itself already a per-row upsert) over `rows`. */
export const saveFieldPermissionsRequestSchema = z.object({
  module: z.string(),
  entity: z.string(),
  rows: z.array(fieldPermissionRowSchema),
});
export type SaveFieldPermissionsRequest = z.infer<typeof saveFieldPermissionsRequestSchema>;
