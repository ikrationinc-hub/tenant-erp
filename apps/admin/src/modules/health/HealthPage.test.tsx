import { afterEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { platformHealthResponseSchema, type PlatformHealthResponse } from "@hyperion/contracts";
import { renderApp } from "../../test/render-app";
import { server } from "../../mocks/server";
import { endpoints } from "../../core/api/endpoints";
import { useAdminStore } from "../../core/store/admin-store";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

function signIn(): void {
  useAdminStore.setState({
    accessToken: "platform-access-token",
    refreshToken: "platform-refresh-token",
    admin: {
      id: "99999999-9999-4999-8999-999999999999",
      email: "ops@hyperion.test",
      name: "Platform Operator",
      status: "active",
    },
  });
}

function healthFixture(overrides: Partial<PlatformHealthResponse> = {}): PlatformHealthResponse {
  return platformHealthResponseSchema.parse({
    api: { status: "up", version: "1.2.3", uptimeSeconds: 3725 },
    postgres: { reachable: true, pool: { total: 10, idle: 8, waiting: 0 } },
    redis: { reachable: true },
    worker: { reachable: true, lastHeartbeatAt: "2026-01-15T09:00:00.000Z" },
    tenants: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        slug: "hyperion",
        status: "active",
        schemaPresent: true,
        lastMigrationVersion: "0013_faulty_black_tarantula",
        upToDate: true,
      },
    ],
    ...overrides,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("HealthPage", () => {
  it("renders health cards from mocked status", async () => {
    signIn();
    server.use(http.get(`${API_BASE}${endpoints.health}`, () => HttpResponse.json(healthFixture())));

    renderApp({ initialEntries: ["/health"] });

    expect(await screen.findByText("Version: 1.2.3")).toBeInTheDocument();
    expect(screen.getByText("Uptime: 1h 2m")).toBeInTheDocument();
    expect(screen.getAllByText("UP")).toHaveLength(4); // API + Postgres + Redis + Worker
    expect(screen.getByText(/8 idle \/ 10 total/)).toBeInTheDocument();
  });

  it("flags a lagging tenant schema in the migration table", async () => {
    signIn();
    server.use(
      http.get(`${API_BASE}${endpoints.health}`, () =>
        HttpResponse.json(
          healthFixture({
            tenants: [
              {
                id: "11111111-1111-4111-8111-111111111111",
                slug: "hyperion",
                status: "active",
                schemaPresent: true,
                lastMigrationVersion: "0010_modern_adam_warlock",
                upToDate: false,
              },
            ],
          }),
        ),
      ),
    );

    renderApp({ initialEntries: ["/health"] });

    expect(await screen.findByText("LAGGING")).toBeInTheDocument();
    expect(screen.getByText("0010_modern_adam_warlock")).toBeInTheDocument();
  });

  it("auto-refreshes on the 15-30s interval", async () => {
    signIn();
    let requestCount = 0;
    server.use(
      http.get(`${API_BASE}${endpoints.health}`, () => {
        requestCount += 1;
        return HttpResponse.json(healthFixture());
      }),
    );

    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderApp({ initialEntries: ["/health"] });

    await waitFor(() => expect(requestCount).toBe(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    await waitFor(() => expect(requestCount).toBeGreaterThanOrEqual(2));
  });
});
