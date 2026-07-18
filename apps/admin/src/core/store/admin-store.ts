import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { PlatformAdminSummary } from "@hyperion/contracts";

/**
 * The PLATFORM token only (ADM-3 task item 2) - a separate store from
 * apps/web's useAppStore, with its own persist key. These two apps never
 * share auth state; they're different origins in production anyway, and a
 * platform admin JWT must never end up in the same storage bucket a tenant
 * token could read.
 */
interface AdminAuthState {
  accessToken: string | null;
  refreshToken: string | null;
  admin: PlatformAdminSummary | null;
  setSession: (session: {
    accessToken: string;
    refreshToken: string;
    admin: PlatformAdminSummary;
  }) => void;
  setTokens: (tokens: { accessToken: string; refreshToken: string }) => void;
  clearAuth: () => void;
}

export const useAdminStore = create<AdminAuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      admin: null,
      setSession: ({ accessToken, refreshToken, admin }) => set({ accessToken, refreshToken, admin }),
      setTokens: ({ accessToken, refreshToken }) => set({ accessToken, refreshToken }),
      clearAuth: () => set({ accessToken: null, refreshToken: null, admin: null }),
    }),
    {
      name: "hyperion-admin-store",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
