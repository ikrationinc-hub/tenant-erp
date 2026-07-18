import { useMutation } from "@tanstack/react-query";
import {
  platformLoginResponseSchema,
  type PlatformLoginRequest,
} from "@hyperion/contracts";
import { apiFetch } from "../../core/api/client";
import { endpoints } from "../../core/api/endpoints";
import { useAdminStore } from "../../core/store/admin-store";

export function usePlatformLoginMutation() {
  return useMutation({
    mutationFn: (input: PlatformLoginRequest) =>
      apiFetch(
        endpoints.login,
        { method: "POST", body: input },
        { schema: platformLoginResponseSchema, auth: false },
      ),
  });
}

export function usePlatformLogoutMutation() {
  return useMutation({
    mutationFn: () => {
      const { refreshToken } = useAdminStore.getState();
      if (!refreshToken) {
        return Promise.resolve();
      }
      return apiFetch(endpoints.logout, { method: "POST", body: { refreshToken } });
    },
  });
}
