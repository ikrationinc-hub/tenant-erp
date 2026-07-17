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
