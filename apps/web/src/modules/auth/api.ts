import { useMutation, useQuery } from "@tanstack/react-query";
import {
  acceptInvitationRequestSchema,
  changePasswordResponseSchema,
  loginResponseSchema,
  validateInvitationResponseSchema,
  type AcceptInvitationRequest,
  type ChangePasswordRequest,
  type LoginRequest,
} from "@hyperion/contracts";
import { apiFetch } from "../../core/api/client";
import { endpoints, withQuery } from "../../core/api/endpoints";
import { useAppStore } from "../../core/store/app-store";

export function useLoginMutation() {
  return useMutation({
    mutationFn: (input: LoginRequest) =>
      apiFetch(
        endpoints.login,
        { method: "POST", body: input },
        { schema: loginResponseSchema, auth: false },
      ),
  });
}

export function useValidateInvitationQuery(token: string, tenantCode: string | undefined) {
  return useQuery({
    queryKey: ["invitations", token, tenantCode],
    queryFn: () =>
      apiFetch(
        withQuery(endpoints.validateInvitation(token), { tenantCode }),
        {},
        { schema: validateInvitationResponseSchema, auth: false },
      ),
    retry: false,
    enabled: token.length > 0,
  });
}

export function useAcceptInvitationMutation(token: string) {
  return useMutation({
    mutationFn: (input: AcceptInvitationRequest) => {
      acceptInvitationRequestSchema.parse(input);
      return apiFetch(endpoints.acceptInvitation(token), { method: "POST", body: input }, { auth: false });
    },
  });
}

export function useChangePasswordMutation() {
  return useMutation({
    mutationFn: (input: ChangePasswordRequest) =>
      apiFetch(
        endpoints.changePassword,
        { method: "POST", body: input },
        { schema: changePasswordResponseSchema },
      ),
  });
}

export function useLogoutMutation() {
  return useMutation({
    mutationFn: () => {
      const { refreshToken } = useAppStore.getState();
      if (!refreshToken) {
        return Promise.resolve();
      }
      return apiFetch(endpoints.logout, { method: "POST", body: { refreshToken } });
    },
  });
}
