import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor } from "@testing-library/react";
import { menuTreeResponseSchema, type MenuTreeResponse } from "@hyperion/contracts";
import { server } from "../../mocks/server";
import { endpoints } from "../api/endpoints";
import { renderApp } from "../../test/render-app";
import { useAppStore } from "../store/app-store";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

function signIn(): void {
  useAppStore.setState({
    accessToken: "access-token",
    refreshToken: "refresh-token",
    user: {
      id: "11111111-1111-4111-8111-111111111111",
      email: "demo.admin@hyperion.test",
      name: "Demo Admin",
      companyId: "22222222-2222-4222-8222-222222222222",
    },
    mustChangePassword: false,
  });
}

function mockMenus(tree: MenuTreeResponse): void {
  server.use(http.get(`${API_BASE}${endpoints.menus}`, () => HttpResponse.json(tree)));
}

describe("navigation", () => {
  it("renders the menu tree from a mocked /menus fixture", async () => {
    signIn();
    renderApp({ initialEntries: ["/"] });

    expect(await screen.findByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("Roles")).toBeInTheDocument();
    expect(screen.getByText("Masters")).toBeInTheDocument();
    expect(screen.getByText("Purchase")).toBeInTheDocument();
  });

  it("a menu item the user lacks permission for is absent", async () => {
    signIn();
    mockMenus(
      menuTreeResponseSchema.parse({
        menus: [
          {
            id: "m-dashboard",
            key: "dashboard",
            label: "Dashboard",
            path: "/dashboard",
            icon: "dashboard",
            sortOrder: 1,
            children: [],
          },
          // "Roles" deliberately omitted - resolve.ts already excludes it
          // server-side when the caller lacks roles.role.read; the client
          // never re-derives that decision (frontend rule 4).
        ],
      }),
    );

    renderApp({ initialEntries: ["/"] });

    expect(await screen.findByText("Dashboard")).toBeInTheDocument();
    expect(screen.queryByText("Roles")).not.toBeInTheDocument();
  });

  it("a path outside the menu tree renders 404, not a blank screen", async () => {
    signIn();
    renderApp({ initialEntries: ["/this-path-does-not-exist"] });

    expect(await screen.findByText("404")).toBeInTheDocument();
  });

  it("a path in the menu tree resolves to a real route", async () => {
    signIn();
    renderApp({ initialEntries: ["/dashboard"] });

    await waitFor(() => expect(screen.getAllByText("Dashboard").length).toBeGreaterThan(0));
    expect(screen.queryByText("404")).not.toBeInTheDocument();
  });
});
