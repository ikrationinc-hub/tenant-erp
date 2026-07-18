import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen } from "@testing-library/react";
import { renderApp } from "../../test/render-app";
import { useAppStore } from "../../core/store/app-store";

describe("LoginPage", () => {
  it("logs in against MSW and lands on the shell with the returned session", async () => {
    const user = userEvent.setup();
    renderApp({ initialEntries: ["/login"] });

    await user.type(screen.getByLabelText("Email"), "demo.admin@hyperion.test");
    await user.type(screen.getByLabelText("Password"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByTestId("bootstrap-user")).toHaveTextContent("Signed in as Demo Admin");

    const state = useAppStore.getState();
    expect(state.accessToken).toBe("mock-access-token");
    expect(state.refreshToken).toBe("mock-refresh-token");
    expect(state.mustChangePassword).toBe(false);
    expect(state.user?.name).toBe("Demo Admin");
  });
});
