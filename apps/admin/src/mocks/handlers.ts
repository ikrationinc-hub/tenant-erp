import { http, HttpResponse } from "msw";
import {
  platformLoginResponseSchema,
  platformMeResponseSchema,
  platformRefreshResponseSchema,
  tenantDetailResponseSchema,
  tenantListResponseSchema,
  tenantModulesResponseSchema,
  type PlatformLoginResponse,
  type PlatformMeResponse,
  type TenantDetailResponse,
  type TenantListResponse,
  type TenantModulesResponse,
} from "@hyperion/contracts";
import { endpoints } from "../core/api/endpoints";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

/**
 * Fixture data is parsed through the same contract schemas the real API is
 * validated against - a typo or a shape drift here throws at module load
 * instead of quietly shipping a mock that no longer matches the contract.
 */
const mockAdmin: PlatformMeResponse = platformMeResponseSchema.parse({
  id: "99999999-9999-4999-8999-999999999999",
  email: "ops@hyperion.test",
  name: "Platform Operator",
  status: "active",
});

const mockLoginResponse: PlatformLoginResponse = platformLoginResponseSchema.parse({
  accessToken: "mock-platform-access-token",
  refreshToken: "mock-platform-refresh-token",
  admin: mockAdmin,
});

const mockTenants: TenantListResponse = tenantListResponseSchema.parse({
  tenants: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Hyperion Metals Trading",
      slug: "hyperion",
      schemaName: "tenant_hyperion",
      status: "active",
      createdAt: "2026-01-15T09:00:00.000Z",
      updatedAt: "2026-01-15T09:00:00.000Z",
      moduleCount: 4,
      userCount: 12,
    },
  ],
});

const mockTenantDetail: TenantDetailResponse = tenantDetailResponseSchema.parse({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Hyperion Metals Trading",
  slug: "hyperion",
  schemaName: "tenant_hyperion",
  status: "active",
  createdAt: "2026-01-15T09:00:00.000Z",
  updatedAt: "2026-01-15T09:00:00.000Z",
  modules: [],
});

const mockTenantModules: TenantModulesResponse = tenantModulesResponseSchema.parse({
  modules: [
    { key: "health", name: "Health", enabled: true },
    { key: "auth", name: "Authentication", enabled: true },
    { key: "users", name: "User Management", enabled: true },
    { key: "menus", name: "Navigation Menus", enabled: true },
  ],
});

export const handlers = [
  http.post(`${API_BASE}${endpoints.login}`, () => HttpResponse.json(mockLoginResponse)),
  http.post(`${API_BASE}${endpoints.refresh}`, () =>
    HttpResponse.json(
      platformRefreshResponseSchema.parse({
        accessToken: "mock-platform-access-token-rotated",
        refreshToken: "mock-platform-refresh-token-rotated",
      }),
    ),
  ),
  http.post(`${API_BASE}${endpoints.logout}`, () => new HttpResponse(null, { status: 204 })),
  http.get(`${API_BASE}${endpoints.me}`, () => HttpResponse.json(mockAdmin)),
  http.get(`${API_BASE}${endpoints.tenants}`, () => HttpResponse.json(mockTenants)),
  http.get(`${API_BASE}${endpoints.tenant(":id")}`, () => HttpResponse.json(mockTenantDetail)),
  http.get(`${API_BASE}${endpoints.tenantModules(":id")}`, () => HttpResponse.json(mockTenantModules)),
];
