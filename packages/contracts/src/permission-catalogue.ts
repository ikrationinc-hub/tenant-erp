import { z } from "zod";

/**
 * Mirrors apps/api/src/core/rbac/types.ts's PermissionCatalogueEntry -
 * EVERY permission the system knows about (not one user's grants; that's
 * permissions.ts's myPermissionsResponseSchema). Feeds the role/permission
 * Transfer (FE-5.5): left = catalogue minus granted, right = granted.
 */
export const permissionCatalogueEntrySchema = z.object({
  key: z.string(),
  module: z.string(),
  entity: z.string(),
  action: z.string(),
  description: z.string(),
});
export type PermissionCatalogueEntry = z.infer<typeof permissionCatalogueEntrySchema>;

// --- GET /api/v1/permissions -------------------------------------------------

export const permissionCatalogueResponseSchema = z.object({
  permissions: z.array(permissionCatalogueEntrySchema),
});
export type PermissionCatalogueResponse = z.infer<typeof permissionCatalogueResponseSchema>;
