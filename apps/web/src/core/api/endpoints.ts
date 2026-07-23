/** Single source of truth for API paths - referenced by both the real fetch wrapper and the MSW mocks, so they can't drift apart. Mirrors apps/api/src/app.ts's mount points. */
export const endpoints = {
  login: "/auth/login",
  refresh: "/auth/refresh",
  logout: "/auth/logout",
  me: "/auth/me",
  fieldDefinitions: (module: string, entity: string) => `/field-definitions/${module}/${entity}`,
  validateInvitation: (token: string) => `/invitations/${token}`,
  acceptInvitation: (token: string) => `/invitations/${token}/accept`,
  changePassword: "/users/me/password",
  myCompanies: "/users/me/companies",
  myPermissions: "/users/me/permissions",
  masterOptions: (master: string) => `/masters/${master}/options`,
  menus: "/menus",

  // --- FE-5.5: tenant-admin surface -----------------------------------------
  companies: "/companies",
  branches: "/branches",
  users: "/users",
  suspendUser: (id: string) => `/users/${id}/suspend`,
  reactivateUser: (id: string) => `/users/${id}/reactivate`,
  setUserRoles: (id: string) => `/users/${id}/roles`,
  inviteUser: "/users/invite",
  provisionUser: "/users/provision",
  resendInvitation: (id: string) => `/users/invitations/${id}/resend`,
  revokeInvitation: (id: string) => `/users/invitations/${id}/revoke`,
  roles: "/roles",
  permissionCatalogue: "/permissions",
  roleGrantedPermissions: (roleId: string) => `/roles/${roleId}/permissions`,
  grantRolePermission: (roleId: string) => `/roles/${roleId}/permissions`,
  revokeRolePermission: (roleId: string, permissionKey: string) =>
    `/roles/${roleId}/permissions/${encodeURIComponent(permissionKey)}`,
  roleFieldPermissions: (roleId: string) => `/roles/${roleId}/field-permissions`,
} as const;

/** Appends a query string, skipping undefined values - `?tenantCode=` for an unset optional field is just noise. */
export function withQuery(path: string, params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(key, value);
    }
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}
