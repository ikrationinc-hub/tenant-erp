import { z } from "zod";

// --- GET /api/v1/invitations/:token -----------------------------------------

/** Mirrors apps/api's users.service.ts ValidateInvitationResult. */
export const validateInvitationResponseSchema = z.object({
  email: z.email(),
  companyName: z.string(),
});
export type ValidateInvitationResponse = z.infer<typeof validateInvitationResponseSchema>;

// --- POST /api/v1/invitations/:token/accept ---------------------------------

/** Mirrors apps/api's users.validator.ts acceptInvitationSchema - .strict() there means no other field, including a caller-supplied status, may ride along. */
export const acceptInvitationRequestSchema = z.object({
  password: z.string().min(1),
  tenantCode: z.string().min(1).optional(),
});
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequestSchema>;
