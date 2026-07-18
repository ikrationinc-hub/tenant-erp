import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { LoginUserSummary } from "@hyperion/contracts";

/**
 * Auth token + UI prefs ONLY (frontend rule 5) - server data belongs to
 * TanStack Query, never here. `refreshToken` is nullable because a
 * must-change-password login issues an access-only, password-change-scoped
 * token (see apps/api's auth.service.ts LoginResult union).
 */
interface AuthSlice {
  accessToken: string | null;
  refreshToken: string | null;
  user: LoginUserSummary | null;
  mustChangePassword: boolean;
  setSession: (session: {
    accessToken: string;
    refreshToken: string | null;
    user: LoginUserSummary;
    mustChangePassword: boolean;
  }) => void;
  setTokens: (tokens: { accessToken: string; refreshToken: string }) => void;
  /** POST /users/me/password succeeded: swap in the fresh full-scope pair and drop the password-change restriction. */
  completePasswordChange: (tokens: { accessToken: string; refreshToken: string }) => void;
  clearAuth: () => void;
}

interface UiPrefsSlice {
  sidebarCollapsed: boolean;
  activeCompanyId: string | null;
  activeBranchId: string | null;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setActiveScope: (scope: { companyId: string | null; branchId: string | null }) => void;
}

export type AppStore = AuthSlice & UiPrefsSlice;

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      mustChangePassword: false,
      setSession: ({ accessToken, refreshToken, user, mustChangePassword }) =>
        set({
          accessToken,
          refreshToken,
          user,
          mustChangePassword,
          activeCompanyId: user.companyId,
          activeBranchId: null,
        }),
      setTokens: ({ accessToken, refreshToken }) => set({ accessToken, refreshToken }),
      completePasswordChange: ({ accessToken, refreshToken }) =>
        set({ accessToken, refreshToken, mustChangePassword: false }),
      clearAuth: () =>
        set({
          accessToken: null,
          refreshToken: null,
          user: null,
          mustChangePassword: false,
          activeCompanyId: null,
          activeBranchId: null,
        }),

      sidebarCollapsed: false,
      activeCompanyId: null,
      activeBranchId: null,
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setActiveScope: ({ companyId, branchId }) =>
        set({ activeCompanyId: companyId, activeBranchId: branchId }),
    }),
    {
      name: "hyperion-app-store",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
