import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup } from "@testing-library/react";
import { server } from "../mocks/server";
import { queryClient } from "../core/api/query-client";
import { useAppStore } from "../core/store/app-store";

// jsdom has no matchMedia - AntD's Layout/Grid breakpoint hooks call it on mount.
window.matchMedia ??= (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => undefined,
  removeListener: () => undefined,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => false,
});

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

afterEach(() => {
  cleanup();
  server.resetHandlers();
  queryClient.clear();
  useAppStore.setState({
    accessToken: null,
    refreshToken: null,
    user: null,
    mustChangePassword: false,
    sidebarCollapsed: false,
    activeCompanyId: null,
    activeBranchId: null,
  });
  window.localStorage.clear();
});

afterAll(() => server.close());
