import { z } from "zod";

export const rolesListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().min(1).optional(),
});
export type RolesListQuery = z.infer<typeof rolesListQuerySchema>;

/** Matches admin/role's own field-definitions (core/field-engine/defaults.ts) - "name" is the only field a role has. */
export const createRoleSchema = z.object({ name: z.string().min(1).max(200) }).strict();
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({ name: z.string().min(1).max(200) }).strict();
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

/** Mirrors packages/contracts/src/role-permissions.ts's grantRolePermissionRequestSchema. */
export const grantRolePermissionSchema = z.object({ permissionKey: z.string().min(1) }).strict();
export type GrantRolePermissionInput = z.infer<typeof grantRolePermissionSchema>;

export const fieldPermissionsQuerySchema = z.object({
  module: z.string().min(1),
  entity: z.string().min(1),
});
export type FieldPermissionsQuery = z.infer<typeof fieldPermissionsQuerySchema>;

const fieldPermissionRowSchema = z.object({
  fieldKey: z.string().min(1),
  canView: z.boolean(),
  canEdit: z.boolean(),
});

/** Mirrors packages/contracts/src/role-permissions.ts's saveFieldPermissionsRequestSchema. */
export const saveFieldPermissionsSchema = z
  .object({
    module: z.string().min(1),
    entity: z.string().min(1),
    rows: z.array(fieldPermissionRowSchema),
  })
  .strict();
export type SaveFieldPermissionsInput = z.infer<typeof saveFieldPermissionsSchema>;
