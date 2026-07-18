import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen } from "@testing-library/react";
import { renderApp } from "../../test/render-app";
import { queryClient } from "../../core/api/query-client";
import { useAppStore } from "../../core/store/app-store";

const DEMO_COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const SINGAPORE_COMPANY_ID = "55555555-5555-4555-8555-555555555555";

function signIn(): void {
  useAppStore.setState({
    accessToken: "access-token",
    refreshToken: "refresh-token",
    user: { id: "11111111-1111-4111-8111-111111111111", email: "demo.admin@hyperion.test", name: "Demo Admin", companyId: DEMO_COMPANY_ID },
    mustChangePassword: false,
    activeCompanyId: DEMO_COMPANY_ID,
    activeBranchId: null,
  });
}

describe("CompanyBranchSwitcher", () => {
  it("invalidates the ENTIRE query cache (no filter) when the active company changes", async () => {
    signIn();
    const user = userEvent.setup();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    renderApp({ initialEntries: ["/"] });

    const companySelect = await screen.findByRole("combobox", { name: "Company" });
    await user.click(companySelect);
    await user.click(await screen.findByText("Hyperion Singapore Pte Ltd"));

    expect(invalidateSpy).toHaveBeenCalledWith();
    expect(useAppStore.getState().activeCompanyId).toBe(SINGAPORE_COMPANY_ID);
    expect(useAppStore.getState().activeBranchId).toBeNull();

    invalidateSpy.mockRestore();
  });

  it("invalidates the ENTIRE query cache when only the branch changes", async () => {
    signIn();
    const user = userEvent.setup();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    renderApp({ initialEntries: ["/"] });

    const branchSelect = await screen.findByRole("combobox", { name: "Branch" });
    await user.click(branchSelect);
    await user.click(await screen.findByText("Jebel Ali Warehouse"));

    expect(invalidateSpy).toHaveBeenCalledWith();

    invalidateSpy.mockRestore();
  });
});
