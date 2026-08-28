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

/**
 * findByRole("menuitem", { name }) intermittently fails to match here - the
 * icon span sitting inside the <li role="menuitem"> appears to confuse
 * testing-library's accessible-name computation for AntD's Menu markup.
 * Targeting the title span directly (what the label actually renders into)
 * is reliable; the label text alone is ambiguous whenever both the main
 * sidebar/settings sub-nav and the launcher's card links show the same
 * label at once.
 */
async function clickMenuItem(user: ReturnType<typeof userEvent.setup>, label: string): Promise<void> {
  await user.click(await screen.findByText(label, { selector: ".ant-menu-title-content" }, ASYNC));
}

describe("navigation", () => {
  it("main sidebar shows only operate items - Purchase daily-work, not Settings config screens", async () => {
    signIn();
    renderApp({ initialEntries: ["/"] });

    expect(await screen.findByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Purchase")).toBeInTheDocument();
    expect(screen.getByText("Suppliers")).toBeInTheDocument();
    expect(screen.getByText("Brokers")).toBeInTheDocument();
    // Users/Roles/Masters are "settings" section nodes - they render in
    // SettingsNav under /settings, not the main sidebar.
    expect(screen.queryByText("Users")).not.toBeInTheDocument();
    expect(screen.queryByText("Roles")).not.toBeInTheDocument();
    expect(screen.queryByText("Masters")).not.toBeInTheDocument();
  });

  it("Settings sub-nav shows only configure items - reached via the header gear", async () => {
    signIn();
    const user = userEvent.setup();
    renderApp({ initialEntries: ["/"] });

    await user.click(await screen.findByRole("button", { name: "Settings" }, ASYNC));

    expect(await screen.findAllByText("All Settings", {}, ASYNC)).not.toHaveLength(0);
    // The sub-nav's own menu items - queried by their title span, not plain
    // text, since "Users"/"Roles"/"Masters" also appear as launcher card
    // links on the same screen.
    expect(await screen.findByText("Users", { selector: ".ant-menu-title-content" }, ASYNC)).toBeInTheDocument();
    expect(screen.getByText("Roles", { selector: ".ant-menu-title-content" })).toBeInTheDocument();
    expect(screen.getByText("Masters", { selector: ".ant-menu-title-content" })).toBeInTheDocument();
    // Purchase/Suppliers/Brokers are operate-section nodes, absent from
    // the settings sub-nav entirely (no ambiguity risk for these).
    expect(screen.queryByText("Purchase")).not.toBeInTheDocument();
    expect(screen.queryByText("Suppliers")).not.toBeInTheDocument();
  });

  it("Close Settings returns to the operate app", async () => {
    signIn();
    const user = userEvent.setup();
    renderApp({ initialEntries: ["/"] });

    await user.click(await screen.findByRole("button", { name: "Settings" }, ASYNC));
    await screen.findAllByText("All Settings", {}, ASYNC);

    await user.click(await screen.findByText("Close Settings", {}, ASYNC));

    expect(await screen.findByText("Purchase", {}, ASYNC)).toBeInTheDocument();
    expect(screen.queryByText("All Settings")).not.toBeInTheDocument();
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
            section: "operate",
            launcherSection: null,
            launcherGroup: null,
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
    "Divisions is reachable via Settings gear -> Masters -> Divisions",
    async () => {
      signIn();
      const user = userEvent.setup();
      renderApp({ initialEntries: ["/"] });

      await user.click(await screen.findByRole("button", { name: "Settings" }, ASYNC));
      await clickMenuItem(user, "Masters");
      await clickMenuItem(user, "Divisions");

      expect(await screen.findByRole("heading", { name: "Divisions" }, ASYNC)).toBeInTheDocument();
    },
    30000,
  );

  it(
    "Containers is reachable via Settings gear -> Masters -> Containers",
    async () => {
      signIn();
      const user = userEvent.setup();
      renderApp({ initialEntries: ["/"] });

      await user.click(await screen.findByRole("button", { name: "Settings" }, ASYNC));
      await clickMenuItem(user, "Masters");
      await clickMenuItem(user, "Containers");

      expect(await screen.findByRole("heading", { name: "Containers" }, ASYNC)).toBeInTheDocument();
    },
    30000,
  );
});
