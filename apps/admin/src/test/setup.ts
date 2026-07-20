import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup } from "@testing-library/react";
import { server } from "../mocks/server";
import { resetMockTenantState } from "../mocks/handlers";
import { queryClient } from "../core/api/query-client";
import { useAdminStore } from "../core/store/admin-store";

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
  resetMockTenantState();
  queryClient.clear();
  useAdminStore.setState({ accessToken: null, refreshToken: null, admin: null });
  window.localStorage.clear();
});

afterAll(() => server.close());
