/** Single source of truth for API paths - referenced by both the real fetch wrapper and the MSW mocks, so they can't drift apart. Mirrors apps/api/src/app.ts's mount points. */
export const endpoints = {
  login: "/auth/login",
  refresh: "/auth/refresh",
  logout: "/auth/logout",
  me: "/auth/me",
  fieldDefinitions: (module: string, entity: string) => `/field-definitions/${module}/${entity}`,
} as const;
