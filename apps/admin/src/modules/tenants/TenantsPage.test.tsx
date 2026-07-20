import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
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

/** AntD Modal renders role="dialog" - scoping to it avoids colliding with the table's own "Slug"/"Modules" header cells, which also carry an aria-label. */
async function openOnboardModal(): Promise<HTMLElement> {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /onboard tenant/i }));
  return screen.findByRole("dialog");
}

describe("TenantsPage", () => {
  it("renders the tenant list from mocked data", async () => {
    signIn();
    renderApp({ initialEntries: ["/tenants"] });

    expect(await screen.findByText("Hyperion Metals Trading")).toBeInTheDocument();
    expect(screen.getByText("hyperion")).toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
  });

  it("shows the empty state when there are no tenants yet", async () => {
    signIn();
    server.use(http.get(`${API_BASE}${endpoints.tenants}`, () => HttpResponse.json({ tenants: [] })));

    renderApp({ initialEntries: ["/tenants"] });

    expect(await screen.findByText(/no tenants yet/i)).toBeInTheDocument();
    expect(screen.getByText("onboard your first")).toBeInTheDocument();
  });

  it("the onboard form validates required fields and rejects an invalid slug", async () => {
    const user = userEvent.setup();
    signIn();
    renderApp({ initialEntries: ["/tenants"] });

    const dialog = await openOnboardModal();
    await user.type(within(dialog).getByLabelText("Slug"), "Not A Valid Slug!");
    await user.click(within(dialog).getByRole("button", { name: "Provision" }));

    expect(await within(dialog).findAllByText("Required")).not.toHaveLength(0);
    expect(within(dialog).getByText(/lowercase letters, numbers, and hyphens only/i)).toBeInTheDocument();
  });

  it("flags a slug already visible in the tenant list as taken, before any request is made", async () => {
    const user = userEvent.setup();
    signIn();
    renderApp({ initialEntries: ["/tenants"] });

    const dialog = await openOnboardModal();
    await user.type(within(dialog).getByLabelText("Slug"), "hyperion");

    expect(await within(dialog).findByText("This slug is already taken")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Provision" })).toBeDisabled();
  });

  it("provisioning succeeds and surfaces a confirmation", async () => {
    const user = userEvent.setup();
    signIn();
    renderApp({ initialEntries: ["/tenants"] });

    const dialog = await openOnboardModal();
    await user.type(within(dialog).getByLabelText("Tenant name"), "New Co");
    await user.type(within(dialog).getByLabelText("Slug"), "new-co");
    await user.type(within(dialog).getByLabelText("Admin email"), "admin@new-co.test");
    await user.type(within(dialog).getByLabelText("Admin name"), "Nia Admin");
    await user.click(within(dialog).getByRole("button", { name: "Provision" }));

    expect(await screen.findByText("Tenant created")).toBeInTheDocument();
    expect(screen.getByText("Admin invited to admin@new-co.test")).toBeInTheDocument();
  });

  it("provisioning against a raced/duplicate slug surfaces the server's 409 clearly", async () => {
    const user = userEvent.setup();
    signIn();
    renderApp({ initialEntries: ["/tenants"] });

    const dialog = await openOnboardModal();
    await user.type(within(dialog).getByLabelText("Tenant name"), "Raced Co");
    await user.type(within(dialog).getByLabelText("Slug"), "already-taken");
    await user.type(within(dialog).getByLabelText("Admin email"), "admin@raced.test");
    await user.type(within(dialog).getByLabelText("Admin name"), "Ray Admin");
    await user.click(within(dialog).getByRole("button", { name: "Provision" }));

    expect(
      await within(dialog).findByText(/already in use by a tenant that isn't active yet/i),
    ).toBeInTheDocument();
  });

  it("suspending a tenant requires confirmation, then persists", async () => {
    const user = userEvent.setup();
    signIn();
    renderApp({ initialEntries: ["/tenants"] });

    await user.click(await screen.findByText("Hyperion Metals Trading"));
    const drawer = await screen.findByRole("dialog");
    await user.click(await within(drawer).findByRole("button", { name: "Suspend" }, { timeout: 3000 }));

    // Popconfirm - the action doesn't happen until its own confirm button is clicked.
    expect(screen.queryByText("SUSPENDED")).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Yes, suspend" }));

    await waitFor(async () => {
      expect(await screen.findAllByText("SUSPENDED")).not.toHaveLength(0);
    });
  });

  it("toggling a module switch in the detail drawer persists", async () => {
    const user = userEvent.setup();
    signIn();
    renderApp({ initialEntries: ["/tenants"] });

    await user.click(await screen.findByText("Hyperion Metals Trading"));
    const drawer = await screen.findByRole("dialog");
    const menusRow = (await within(drawer).findByText("Navigation Menus", {}, { timeout: 3000 })).closest("div");
    const toggle = menusRow?.querySelector("button[role='switch']");
    expect(toggle).toBeTruthy();
    expect(toggle).toHaveAttribute("aria-checked", "true");

    await user.click(toggle as HTMLElement);

    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
  });
});
