import { z } from "zod";

/** Mirrors apps/api/src/database/tenant/schema.ts's userStatusEnum. */
export const userStatusSchema = z.enum(["invited", "active", "suspended"]);
export type UserStatus = z.infer<typeof userStatusSchema>;

// --- POST /api/v1/auth/login ---------------------------------------------

/** Mirrors apps/api/src/modules/auth/auth.validator.ts's loginSchema. */
export const loginRequestSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
  tenantCode: z.string().min(1).optional(),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const loginUserSummarySchema = z.object({
  id: z.uuid(),
  email: z.email().nullable(),
  name: z.string(),
  companyId: z.uuid(),
});
export type LoginUserSummary = z.infer<typeof loginUserSummarySchema>;

/**
 * Mirrors auth.service.ts's LoginResult union: a must-change-password login
 * gets no refresh token, only an access token scoped to password-change.
 */
export const loginResponseSchema = z.discriminatedUnion("mustChangePassword", [
  z.object({
    mustChangePassword: z.literal(false),
    accessToken: z.string(),
    refreshToken: z.string(),
    user: loginUserSummarySchema,
  }),
  z.object({
    mustChangePassword: z.literal(true),
    accessToken: z.string(),
    user: loginUserSummarySchema,
  }),
]);
export type LoginResponse = z.infer<typeof loginResponseSchema>;

// --- POST /api/v1/auth/refresh --------------------------------------------

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const refreshResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});
export type RefreshResponse = z.infer<typeof refreshResponseSchema>;

// --- POST /api/v1/auth/logout ---------------------------------------------

export const logoutRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type LogoutRequest = z.infer<typeof logoutRequestSchema>;

// --- GET /api/v1/me ---------------------------------------------------------

/** Mirrors auth.service.ts's MeResult. */
export const meResponseSchema = z.object({
  id: z.uuid(),
  email: z.email().nullable(),
  name: z.string(),
  companyId: z.uuid(),
  status: userStatusSchema,
});
export type MeResponse = z.infer<typeof meResponseSchema>;
