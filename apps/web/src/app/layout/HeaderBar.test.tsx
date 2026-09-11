import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen } from "@testing-library/react";
import { renderApp } from "../../test/render-app";
import { useAppStore } from "../../core/store/app-store";

const DEMO_COMPANY_ID = "22222222-2222-4222-8222-222222222222";

function signIn(): void {
  useAppStore.setState({
    accessToken: "access-token",
    refreshToken: "refresh-token",
    user: { id: "11111111-1111-4111-8111-111111111111", email: "demo.admin@ikration.test", name: "Demo Admin", companyId: DEMO_COMPANY_ID },
    mustChangePassword: false,
    activeCompanyId: DEMO_COMPANY_ID,
    activeBranchId: null,
  });
}

describe("HeaderBar font-size control", () => {
  it("defaults to the Default preset", () => {
    signIn();
    expect(useAppStore.getState().fontScale).toBe(1);
  });

  it("updates the store's fontScale when a preset is picked", async () => {
    signIn();
    const user = userEvent.setup();

    renderApp({ initialEntries: ["/"] });

    await user.click(await screen.findByRole("button", { name: "Font size" }));
    await user.click(await screen.findByText("Large"));

    expect(useAppStore.getState().fontScale).toBe(1.1);
  });
});
