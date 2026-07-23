import { http, HttpResponse } from "msw";
import {
  moduleCatalogueResponseSchema,
  platformHealthResponseSchema,
  platformLoginResponseSchema,
  platformMeResponseSchema,
  platformRefreshResponseSchema,
  tenantDetailResponseSchema,
  tenantListResponseSchema,
  tenantModuleCatalogueEntrySchema,
  type ModuleCatalogueResponse,
  type PlatformHealthResponse,
  type PlatformLoginResponse,
  type PlatformMeResponse,
  type ProvisionTenantRequest,
  type SetTenantModuleRequest,
  type TenantDetailResponse,
  type TenantListResponse,
  type TenantModuleCatalogueEntry,
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

const EXISTING_TENANT_ID = "11111111-1111-4111-8111-111111111111";
const EXISTING_TENANT_SLUG = "hyperion";

const mockTenants: TenantListResponse = tenantListResponseSchema.parse({
  tenants: [
    {
      id: EXISTING_TENANT_ID,
      name: "Hyperion Metals Trading",
      slug: EXISTING_TENANT_SLUG,
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
  id: EXISTING_TENANT_ID,
  name: "Hyperion Metals Trading",
  slug: EXISTING_TENANT_SLUG,
  schemaName: "tenant_hyperion",
  status: "active",
  createdAt: "2026-01-15T09:00:00.000Z",
  updatedAt: "2026-01-15T09:00:00.000Z",
  modules: [],
});

const mockModuleCatalogue: ModuleCatalogueResponse = moduleCatalogueResponseSchema.parse({
  modules: [
    { key: "health", name: "Health" },
    { key: "auth", name: "Authentication" },
    { key: "users", name: "User Management" },
    { key: "menus", name: "Navigation Menus" },
  ],
});

const initialTenantModules: TenantModuleCatalogueEntry[] = mockModuleCatalogue.modules.map((m) =>
  tenantModuleCatalogueEntrySchema.parse({ ...m, enabled: true }),
);

const mockHealth: PlatformHealthResponse = platformHealthResponseSchema.parse({
  api: { status: "up", version: "1.0.0", uptimeSeconds: 3725 },
  postgres: { reachable: true, pool: { total: 10, idle: 8, waiting: 0 } },
  redis: { reachable: true },
  worker: { reachable: true, lastHeartbeatAt: "2026-01-15T09:00:00.000Z" },
  tenants: [
    {
      id: EXISTING_TENANT_ID,
      slug: EXISTING_TENANT_SLUG,
      status: "active",
      schemaPresent: true,
      lastMigrationVersion: "0013_faulty_black_tarantula",
      upToDate: true,
    },
  ],
});

/**
 * Mutable, module-scoped state so PATCH .../modules actually persists across
 * a subsequent GET within one test (ADM-4's "module toggle persists").
 * apps/admin/src/test/setup.ts resets this in afterEach - MSW's own
 * server.resetHandlers() only removes server.use() overrides, not state
 * closed over by a handler.
 */
let tenantModulesState: TenantModuleCatalogueEntry[] = [...initialTenantModules];
let tenantStatus: TenantDetailResponse["status"] = "active";

export function resetMockTenantState(): void {
  tenantModulesState = [...initialTenantModules];
  tenantStatus = "active";
}

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

  http.get(`${API_BASE}${endpoints.moduleCatalogue}`, () => HttpResponse.json(mockModuleCatalogue)),

  http.get(`${API_BASE}${endpoints.tenants}`, () =>
    HttpResponse.json({
      tenants: mockTenants.tenants.map((t) => (t.id === EXISTING_TENANT_ID ? { ...t, status: tenantStatus } : t)),
    }),
  ),
  // NOT tenantModulesState here - GET /tenants/:id's `modules` field is
  // tenantModuleRowSchema (raw db rows: id/tenantId/moduleKey/enabled/
  // timestamps), a different shape from the catalogue entries (key/name/
  // enabled) GET /tenants/:id/modules returns below. TenantDetailDrawer
  // reads modules from that second endpoint, never this one.
  http.get(`${API_BASE}${endpoints.tenant(":id")}`, () =>
    HttpResponse.json({ ...mockTenantDetail, status: tenantStatus }),
  ),

  // Sentinel slug, deliberately NOT one of mockTenants' known slugs - it
  // represents a slug that raced with another provisioning request and
  // became taken between the operator loading the list and submitting (the
  // client-side availability check in OnboardTenantModal only catches
  // slugs already visible in that list, so this is the only way to
  // exercise the server's 409 path through the UI).
  http.post(`${API_BASE}${endpoints.tenants}`, async ({ request }) => {
    const body = (await request.json()) as ProvisionTenantRequest;
    if (body.slug === "already-taken") {
      return HttpResponse.json(
        { error: { code: "CONFLICT", message: `Tenant "${body.slug}" already exists in an unexpected state: provisioning` } },
        { status: 409 },
      );
    }
    return HttpResponse.json({
      tenantId: "22222222-2222-4222-8222-222222222222",
      schemaName: `tenant_${body.slug.replace(/-/g, "_")}`,
      companyId: "33333333-3333-4333-8333-333333333333",
      branchId: "44444444-4444-4444-8444-444444444444",
      adminUserId: "55555555-5555-4555-8555-555555555555",
      created: true,
    });
  }),

  http.post(`${API_BASE}${endpoints.suspendTenant(":id")}`, () => {
    tenantStatus = "suspended";
    return HttpResponse.json({ ...mockTenants.tenants[0], status: tenantStatus });
  }),
  http.post(`${API_BASE}${endpoints.reactivateTenant(":id")}`, () => {
    tenantStatus = "active";
    return HttpResponse.json({ ...mockTenants.tenants[0], status: tenantStatus });
  }),

  http.get(`${API_BASE}${endpoints.tenantModules(":id")}`, () =>
    HttpResponse.json({ modules: tenantModulesState }),
  ),
  http.patch(`${API_BASE}${endpoints.tenantModules(":id")}`, async ({ request }) => {
    const body = (await request.json()) as SetTenantModuleRequest;
    tenantModulesState = tenantModulesState.map((m) =>
      m.key === body.moduleKey ? { ...m, enabled: body.enabled } : m,
    );
    return HttpResponse.json({ modules: tenantModulesState });
  }),

  http.get(`${API_BASE}${endpoints.health}`, () => HttpResponse.json(mockHealth)),
];
