import { z } from "zod";

// --- POST /api/v1/users/me/password -----------------------------------------

/** Mirrors apps/api's users.validator.ts changePasswordSchema. */
export const changePasswordRequestSchema = z.object({
  newPassword: z.string().min(1),
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

/**
 * Mirrors users.controller.ts's changePassword response: a fresh full-scope
 * token pair (issueTokenPair) plus the explicit `mustChangePassword: false`
 * the controller appends - this is how the client knows to drop the
 * password-change-scoped session and treat the new tokens as full access.
 */
export const changePasswordResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  mustChangePassword: z.literal(false),
});
export type ChangePasswordResponse = z.infer<typeof changePasswordResponseSchema>;
