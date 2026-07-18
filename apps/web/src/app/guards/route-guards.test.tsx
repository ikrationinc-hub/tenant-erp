import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderApp } from "../../test/render-app";
import { useAppStore } from "../../core/store/app-store";

describe("route guards", () => {
  it("redirects an unauthenticated visitor from a protected route to /login", async () => {
    const { router } = renderApp({ initialEntries: ["/"] });

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("must_change_password blocks every other route, redirecting to /password-change", async () => {
    useAppStore.setState({
      accessToken: "access-token",
      refreshToken: null,
      user: {
        id: "11111111-1111-4111-8111-111111111111",
        email: "a@b.com",
        name: "A",
        companyId: "22222222-2222-4222-8222-222222222222",
      },
      mustChangePassword: true,
    });

    const { router } = renderApp({ initialEntries: ["/"] });

    await waitFor(() => expect(router.state.location.pathname).toBe("/password-change"));
    expect(await screen.findByRole("heading", { name: "Set a new password" })).toBeInTheDocument();
  });

  it("a full-scope authenticated session reaches the shell", async () => {
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

    renderApp({ initialEntries: ["/"] });

    expect(await screen.findByTestId("bootstrap-user")).toBeInTheDocument();
  });
});
