import { z } from "zod";

// --- POST /api/v1/users/invite ----------------------------------------------

/** Mirrors apps/api's users.validator.ts inviteUserSchema exactly - NO password field, and the backend rejects the request outright (422) if one is sent (docs/adr/0006-user-onboarding.md). */
export const inviteUserRequestSchema = z.object({
  email: z.email(),
  mobile: z.string().min(1),
  name: z.string().min(1),
  roles: z.array(z.uuid()),
});
export type InviteUserRequest = z.infer<typeof inviteUserRequestSchema>;

/** Mirrors users.service.ts's InviteUserResult. */
export const inviteUserResponseSchema = z.object({
  invitationId: z.uuid(),
  userId: z.uuid(),
});
export type InviteUserResponse = z.infer<typeof inviteUserResponseSchema>;

// --- POST /api/v1/users/provision -------------------------------------------

/** Mirrors provisionUserSchema - the ops-staff exception path (BE-7). The backend rejects (403) if any requested role holds an approval permission. */
export const provisionUserRequestSchema = z.object({
  name: z.string().min(1),
  mobile: z.string().min(1),
  tempPassword: z.string().min(1),
  roles: z.array(z.uuid()),
});
export type ProvisionUserRequest = z.infer<typeof provisionUserRequestSchema>;

export const provisionUserResponseSchema = z.object({
  userId: z.uuid(),
});
export type ProvisionUserResponse = z.infer<typeof provisionUserResponseSchema>;

// --- POST /api/v1/users/invitations/:id/resend ------------------------------

/** Mirrors users.service.ts's ResendInvitationResult - `expiresAt` is a JS Date server-side, an ISO string once JSON-serialized. */
export const resendInvitationResponseSchema = z.object({
  expiresAt: z.string(),
});
export type ResendInvitationResponse = z.infer<typeof resendInvitationResponseSchema>;

// --- PUT /api/v1/users/:id/roles ---------------------------------------------

/**
 * Forward-looking (no backend route yet - core/rbac/mutations.ts's
 * assignRoleToUser/revokeRoleFromUser exist but aren't wired to REST). The
 * wire contract is the full desired set; a real implementation computes
 * the grant/revoke diff server-side, mirroring how setFieldPermission is
 * already an upsert rather than a delta the caller computes.
 */
export const setUserRolesRequestSchema = z.object({
  roleIds: z.array(z.uuid()),
});
export type SetUserRolesRequest = z.infer<typeof setUserRolesRequestSchema>;
