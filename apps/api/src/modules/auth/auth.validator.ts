import { z } from "zod";

/**
 * `identifier` accepts either an email or a mobile number: provisioned ops
 * users (POST /users/provision) have no email at all, so login must accept
 * their mobile instead. login() tries email first, then mobile.
 */
export const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
  tenantCode: z.string().min(1).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});
export type LogoutInput = z.infer<typeof logoutSchema>;
