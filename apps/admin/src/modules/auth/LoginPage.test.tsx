import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import { renderApp } from "../../test/render-app";
import { useAdminStore } from "../../core/store/admin-store";

describe("LoginPage", () => {
  it("logs in against MSW and lands on the shell with the returned session, stored in the ADMIN store", async () => {
    const user = userEvent.setup();
    renderApp({ initialEntries: ["/login"] });

    await user.type(screen.getByLabelText("Email"), "ops@hyperion.test");
    await user.type(screen.getByLabelText("Password"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Platform Operator")).toBeInTheDocument();

    const state = useAdminStore.getState();
    expect(state.accessToken).toBe("mock-platform-access-token");
    expect(state.refreshToken).toBe("mock-platform-refresh-token");
    expect(state.admin?.name).toBe("Platform Operator");

    // Persisted under its own key, never apps/web's "hyperion-app-store".
    const persisted = window.localStorage.getItem("hyperion-admin-store");
    expect(persisted).toBeTruthy();
    expect(window.localStorage.getItem("hyperion-app-store")).toBeNull();
  });

  it("has no tenant-code field - platform admins aren't tenant-scoped", () => {
    renderApp({ initialEntries: ["/login"] });

    expect(screen.queryByLabelText(/tenant code/i)).not.toBeInTheDocument();
  });

  it("logout clears the admin store and redirects to /login", async () => {
    const user = userEvent.setup();
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

    const { router } = renderApp({ initialEntries: ["/tenants"] });
    await screen.findByText("Platform Operator");

    await user.click(screen.getByTestId("user-menu-trigger"));
    await user.click(await screen.findByText("Log out"));

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(useAdminStore.getState().accessToken).toBeNull();
  });
});
