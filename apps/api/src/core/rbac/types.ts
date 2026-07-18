export interface FieldPermission {
  canView: boolean;
  canEdit: boolean;
}

/**
 * `permissions` is a Set of permission keys ("purchase.po.approve").
 * `fieldPermissions` is a Map keyed by `${module}.${entity}.${fieldKey}`
 * (not permission-key format - fields aren't actions) to the merged
 * view/edit rule for that field across all of the user's roles.
 */
export interface ResolvedPermissions {
  permissions: Set<string>;
  fieldPermissions: Map<string, FieldPermission>;
}

export function fieldPermissionKey(module: string, entity: string, fieldKey: string): string {
  return `${module}.${entity}.${fieldKey}`;
}

/**
 * Lives here, not in seed.ts or module-registry/types.ts, specifically to
 * avoid a runtime import cycle: core/rbac/seed.ts needs
 * module-registry/registry.js's getPermissionCatalogue, and every module
 * manifest needs this type + the entry() helper to declare its own
 * permissions - a genuine leaf module both sides can import from without
 * either depending on the other.
 */
export interface PermissionCatalogueEntry {
  key: string;
  module: string;
  entity: string;
  action: string;
  description: string;
}

export function permissionEntry(
  module: string,
  entity: string,
  action: string,
  description: string,
): PermissionCatalogueEntry {
  return { key: `${module}.${entity}.${action}`, module, entity, action, description };
}
