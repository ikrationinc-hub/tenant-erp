import { z } from "zod";

export const platformLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type PlatformLoginInput = z.infer<typeof platformLoginSchema>;

export const platformRefreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type PlatformRefreshRequestBody = z.infer<typeof platformRefreshSchema>;

export const platformLogoutSchema = z.object({
  refreshToken: z.string().min(1),
});
export type PlatformLogoutRequestBody = z.infer<typeof platformLogoutSchema>;

export const setTenantModuleSchema = z
  .object({
    moduleKey: z.string().min(1),
    enabled: z.boolean(),
  })
  .strict();
export type SetTenantModuleRequestBody = z.infer<typeof setTenantModuleSchema>;

/**
 * `.strict()`, deliberately unlike most other validators in this codebase
 * (see docs/adr/0006's note on inviteUserSchema for the same reasoning):
 * this endpoint creates a tenant and its first admin in one call, so a
 * typo'd or unexpected extra field silently being dropped is exactly the
 * kind of mistake worth a hard 422 instead.
 */
export const provisionTenantSchema = z
  .object({
    name: z.string().min(1),
    slug: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/, "slug must be lowercase letters, numbers, and hyphens only"),
    adminEmail: z.string().email(),
    adminName: z.string().min(1),
    modules: z.array(z.string()).default([]),
  })
  .strict();
export type ProvisionTenantRequestBody = z.infer<typeof provisionTenantSchema>;
