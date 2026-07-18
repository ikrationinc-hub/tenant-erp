import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderApp } from "../../test/render-app";
import { useAdminStore } from "../../core/store/admin-store";

describe("route guards", () => {
  it("redirects an unauthenticated visitor from a protected route to /login", async () => {
    const { router } = renderApp({ initialEntries: ["/tenants"] });

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("an authenticated session reaches the shell and lands on /tenants by default", async () => {
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

    const { router } = renderApp({ initialEntries: ["/"] });

    await waitFor(() => expect(router.state.location.pathname).toBe("/tenants"));
    expect(await screen.findByText("Platform Operator")).toBeInTheDocument();
  });
});
