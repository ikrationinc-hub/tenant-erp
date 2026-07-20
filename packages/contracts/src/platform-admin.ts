import { z } from "zod";

/**
 * Schemas for apps/admin <-> apps/api's /api/v1/platform/* surface (ADM-1/
 * ADM-2). Deliberately its own file, not folded into auth.ts/users.ts -
 * platform admins are a wholly separate identity from tenant users (docs/
 * CLAUDE-CODE-PROMPTS-ADMIN.md), and these types must never be mistaken for
 * their tenant-scoped counterparts.
 */

// --- POST /api/v1/platform/auth/login -------------------------------------

export const platformLoginRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});
export type PlatformLoginRequest = z.infer<typeof platformLoginRequestSchema>;

export const platformAdminStatusSchema = z.enum(["active", "suspended"]);
export type PlatformAdminStatus = z.infer<typeof platformAdminStatusSchema>;

export const platformAdminSummarySchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  status: platformAdminStatusSchema,
});
export type PlatformAdminSummary = z.infer<typeof platformAdminSummarySchema>;

export const platformLoginResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  admin: platformAdminSummarySchema,
});
export type PlatformLoginResponse = z.infer<typeof platformLoginResponseSchema>;

// --- POST /api/v1/platform/auth/refresh -----------------------------------

export const platformRefreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type PlatformRefreshRequest = z.infer<typeof platformRefreshRequestSchema>;

export const platformRefreshResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});
export type PlatformRefreshResponse = z.infer<typeof platformRefreshResponseSchema>;

// --- POST /api/v1/platform/auth/logout ------------------------------------

export const platformLogoutRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type PlatformLogoutRequest = z.infer<typeof platformLogoutRequestSchema>;

// --- GET /api/v1/platform/auth/me -----------------------------------------

export const platformMeResponseSchema = platformAdminSummarySchema;
export type PlatformMeResponse = z.infer<typeof platformMeResponseSchema>;

// --- Tenants ---------------------------------------------------------------

export const tenantStatusSchema = z.enum(["provisioning", "active", "suspended"]);
export type TenantStatus = z.infer<typeof tenantStatusSchema>;

/** Mirrors modules/platform/platform.repository.ts's TenantListRow. */
export const tenantListItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  schemaName: z.string(),
  status: tenantStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  moduleCount: z.number(),
  userCount: z.number(),
});
export type TenantListItem = z.infer<typeof tenantListItemSchema>;

/** GET /api/v1/platform/tenants */
export const tenantListResponseSchema = z.object({
  tenants: z.array(tenantListItemSchema),
});
export type TenantListResponse = z.infer<typeof tenantListResponseSchema>;

/** A tenant_modules row as returned by GET /platform/tenants/:id - raw, not the module-catalogue-merged shape (see tenantModuleCatalogueEntrySchema below). */
export const tenantModuleRowSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  moduleKey: z.string(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TenantModuleRow = z.infer<typeof tenantModuleRowSchema>;

/** GET /api/v1/platform/tenants/:id */
export const tenantDetailResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  schemaName: z.string(),
  status: tenantStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  modules: z.array(tenantModuleRowSchema),
});
export type TenantDetailResponse = z.infer<typeof tenantDetailResponseSchema>;

/** POST /api/v1/platform/tenants/:id/suspend and /reactivate both return the updated tenant row. */
export const tenantStatusUpdateResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  schemaName: z.string(),
  status: tenantStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TenantStatusUpdateResponse = z.infer<typeof tenantStatusUpdateResponseSchema>;

/** GET /api/v1/platform/modules - the static catalogue, no tenant context, no "enabled" flag. */
export const moduleCatalogueEntrySchema = z.object({
  key: z.string(),
  name: z.string(),
});
export type ModuleCatalogueEntry = z.infer<typeof moduleCatalogueEntrySchema>;

export const moduleCatalogueResponseSchema = z.object({
  modules: z.array(moduleCatalogueEntrySchema),
});
export type ModuleCatalogueResponse = z.infer<typeof moduleCatalogueResponseSchema>;

/** One entry of the full module catalogue (RESOLVED_MODULES), flagged enabled/disabled for a given tenant. */
export const tenantModuleCatalogueEntrySchema = z.object({
  key: z.string(),
  name: z.string(),
  enabled: z.boolean(),
});
export type TenantModuleCatalogueEntry = z.infer<typeof tenantModuleCatalogueEntrySchema>;

/** GET and PATCH /api/v1/platform/tenants/:id/modules share this response shape. */
export const tenantModulesResponseSchema = z.object({
  modules: z.array(tenantModuleCatalogueEntrySchema),
});
export type TenantModulesResponse = z.infer<typeof tenantModulesResponseSchema>;

export const setTenantModuleRequestSchema = z.object({
  moduleKey: z.string().min(1),
  enabled: z.boolean(),
});
export type SetTenantModuleRequest = z.infer<typeof setTenantModuleRequestSchema>;

/** POST /api/v1/platform/tenants - provisions a tenant via the BE-10 engine. */
export const provisionTenantRequestSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase letters, numbers, and hyphens only"),
  adminEmail: z.email(),
  adminName: z.string().min(1),
  modules: z.array(z.string()).default([]),
});
export type ProvisionTenantRequest = z.infer<typeof provisionTenantRequestSchema>;

export const provisionTenantResponseSchema = z.object({
  tenantId: z.uuid(),
  schemaName: z.string(),
  companyId: z.uuid(),
  branchId: z.uuid(),
  adminUserId: z.string(),
  created: z.boolean(),
});
export type ProvisionTenantResponse = z.infer<typeof provisionTenantResponseSchema>;
