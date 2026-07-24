import { z } from "zod";

/**
 * `.strict()` deliberately, unlike most schemas in this codebase (see
 * auth.validator.ts, which uses plain z.object() and silently strips unknown
 * fields): the task requires REJECTING the request outright if a `password`
 * field is sent here, not silently dropping it - admins never set passwords
 * (docs/adr/0006-user-onboarding.md). `.strict()` turns any unrecognized
 * field, including `password`, into a 422 ValidationError via the shared
 * ZodError branch in error-handler.ts.
 */
export const inviteUserSchema = z
  .object({
    email: z.string().email(),
    mobile: z.string().min(1),
    name: z.string().min(1),
    roles: z.array(z.string().uuid()),
  })
  .strict();
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const acceptInvitationSchema = z
  .object({
    password: z.string().min(1),
    tenantCode: z.string().min(1).optional(),
  })
  .strict();
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export const validateInvitationQuerySchema = z.object({
  tenantCode: z.string().min(1).optional(),
});

/**
 * `.strict()` for the same reason as inviteUserSchema: this is the
 * exception path that bypasses the invite flow entirely, so it deserves at
 * least as much scrutiny about exactly what fields it accepts.
 */
export const provisionUserSchema = z
  .object({
    name: z.string().min(1),
    mobile: z.string().min(1),
    tempPassword: z.string().min(1),
    roles: z.array(z.string().uuid()),
  })
  .strict();
export type ProvisionUserInput = z.infer<typeof provisionUserSchema>;

export const changePasswordSchema = z
  .object({
    newPassword: z.string().min(1),
  })
  .strict();
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** Matches mastersListQuerySchema's page/pageSize/search conventions (task item 5), plus the two admin-list-specific filters. */
export const usersListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().min(1).optional(),
  status: z.enum(["invited", "active", "suspended"]).optional(),
  roleId: z.string().uuid().optional(),
});
export type UsersListQuery = z.infer<typeof usersListQuerySchema>;

/** Mirrors packages/contracts/src/users-admin.ts's setUserRolesRequestSchema - the full desired set, diffed server-side (task item 7). */
export const setUserRolesSchema = z
  .object({
    roleIds: z.array(z.string().uuid()),
  })
  .strict();
export type SetUserRolesInput = z.infer<typeof setUserRolesSchema>;
