import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { screen, waitFor } from "@testing-library/react";
import { menuTreeResponseSchema, type MenuTreeResponse } from "@ikration/contracts";
import { server } from "../../mocks/server";
import { endpoints } from "../api/endpoints";
import { renderApp } from "../../test/render-app";
import { useAppStore } from "../store/app-store";

const ASYNC = { timeout: 15000 };

const API_BASE = import.meta.env.VITE_WEB_API_BASE_URL;

function signIn(): void {
  useAppStore.setState({
    accessToken: "access-token",
    refreshToken: "refresh-token",
    user: {
      id: "11111111-1111-4111-8111-111111111111",
      email: "demo.admin@ikration.test",
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

  // Prompt 21 acceptance: every new master/module must be reachable by
  // CLICKING its menu item, not just by typing the URL - Brokers is its
  // own top-level module (mirrors Suppliers); Divisions/Containers are
  // generic masters nested one level under "Masters".
  it(
    "Brokers is reachable by clicking its top-level menu item",
    async () => {
      signIn();
      const user = userEvent.setup();
      renderApp({ initialEntries: ["/"] });

      await user.click(await screen.findByText("Brokers", {}, ASYNC));

      expect(await screen.findByRole("heading", { name: "Brokers" }, ASYNC)).toBeInTheDocument();
    },
    30000,
  );

  it(
    "Divisions is reachable by clicking Masters, then Divisions",
    async () => {
      signIn();
      const user = userEvent.setup();
      renderApp({ initialEntries: ["/"] });

      await user.click(await screen.findByText("Masters", {}, ASYNC));
      await user.click(await screen.findByText("Divisions", {}, ASYNC));

      expect(await screen.findByRole("heading", { name: "Divisions" }, ASYNC)).toBeInTheDocument();
    },
    30000,
  );

  it(
    "Containers is reachable by clicking Masters, then Containers",
    async () => {
      signIn();
      const user = userEvent.setup();
      renderApp({ initialEntries: ["/"] });

      await user.click(await screen.findByText("Masters", {}, ASYNC));
      await user.click(await screen.findByText("Containers", {}, ASYNC));

      expect(await screen.findByRole("heading", { name: "Containers" }, ASYNC)).toBeInTheDocument();
    },
    30000,
  );
});
