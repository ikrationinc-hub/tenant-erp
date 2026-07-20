/** Single source of truth for API paths under /api/v1/platform - mirrors apps/api's platform.routes.ts mount points. */
export const endpoints = {
  login: "/auth/login",
  refresh: "/auth/refresh",
  logout: "/auth/logout",
  me: "/auth/me",
  tenants: "/tenants",
  tenant: (id: string) => `/tenants/${id}`,
  suspendTenant: (id: string) => `/tenants/${id}/suspend`,
  reactivateTenant: (id: string) => `/tenants/${id}/reactivate`,
  tenantModules: (id: string) => `/tenants/${id}/modules`,
  moduleCatalogue: "/modules",
} as const;
