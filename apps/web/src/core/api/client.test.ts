import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../mocks/server";
import { useAppStore } from "../store/app-store";
import { apiFetch } from "./client";
import { endpoints } from "./endpoints";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

describe("apiFetch - refresh single-flight", () => {
  it("fires exactly one /auth/refresh call for N concurrent 401s, and every caller ends up on the new token", async () => {
    useAppStore.setState({
      accessToken: "expired-token",
      refreshToken: "valid-refresh-token",
      user: { id: "11111111-1111-4111-8111-111111111111", email: "a@b.com", name: "A", companyId: "c1" },
      mustChangePassword: false,
    });

    let meCallCount = 0;
    let refreshCallCount = 0;

    server.use(
      http.get(`${API_BASE}${endpoints.me}`, ({ request }) => {
        meCallCount += 1;
        if (request.headers.get("authorization") === "Bearer new-access-token") {
          return HttpResponse.json({
            id: "11111111-1111-4111-8111-111111111111",
            email: "a@b.com",
            name: "A",
            companyId: "c1",
            status: "active",
          });
        }
        return HttpResponse.json(
          { error: { code: "UNAUTHORIZED", message: "Invalid or expired access token" } },
          { status: 401 },
        );
      }),
      http.post(`${API_BASE}${endpoints.refresh}`, () => {
        refreshCallCount += 1;
        return HttpResponse.json({ accessToken: "new-access-token", refreshToken: "new-refresh-token" });
      }),
    );

    const CONCURRENT_CALLS = 5;
    const results = await Promise.all(
      Array.from({ length: CONCURRENT_CALLS }, () => apiFetch(endpoints.me)),
    );

    expect(refreshCallCount).toBe(1);
    expect(meCallCount).toBe(CONCURRENT_CALLS * 2); // one 401 + one retry per caller
    expect(results).toHaveLength(CONCURRENT_CALLS);

    const state = useAppStore.getState();
    expect(state.accessToken).toBe("new-access-token");
    expect(state.refreshToken).toBe("new-refresh-token");
  });

  it("a later, unrelated 401 starts a fresh refresh (the single-flight slot doesn't stay latched)", async () => {
    useAppStore.setState({
      accessToken: "expired-token-1",
      refreshToken: "refresh-token-1",
      user: { id: "11111111-1111-4111-8111-111111111111", email: "a@b.com", name: "A", companyId: "c1" },
      mustChangePassword: false,
    });

    let refreshCallCount = 0;
    server.use(
      http.get(`${API_BASE}${endpoints.me}`, ({ request }) => {
        const auth = request.headers.get("authorization");
        if (auth === "Bearer access-token-1" || auth === "Bearer access-token-2") {
          return HttpResponse.json({
            id: "11111111-1111-4111-8111-111111111111",
            email: "a@b.com",
            name: "A",
            companyId: "c1",
            status: "active",
          });
        }
        return HttpResponse.json(
          { error: { code: "UNAUTHORIZED", message: "Invalid or expired access token" } },
          { status: 401 },
        );
      }),
      http.post(`${API_BASE}${endpoints.refresh}`, () => {
        refreshCallCount += 1;
        return HttpResponse.json({
          accessToken: `access-token-${refreshCallCount}`,
          refreshToken: `refresh-token-${refreshCallCount}`,
        });
      }),
    );

    await apiFetch(endpoints.me);
    expect(refreshCallCount).toBe(1);

    useAppStore.setState({ accessToken: "expired-token-2" });
    await apiFetch(endpoints.me);
    expect(refreshCallCount).toBe(2);
  });
});
