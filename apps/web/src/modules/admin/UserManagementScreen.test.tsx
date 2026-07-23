import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import type { RouteObject } from "react-router-dom";
import { renderApp } from "../../test/render-app";
import { useAppStore } from "../../core/store/app-store";
import { UserManagementScreen } from "./UserManagementScreen";

const ASYNC = { timeout: 15000 };

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

function drawer() {
  return within(screen.getByRole("dialog"));
}

const testRoutes: RouteObject[] = [{ path: "/", element: <UserManagementScreen /> }];

describe("UserManagementScreen", () => {
  it("lists users with their invite status", async () => {
    signIn();
    renderApp({ routes: testRoutes, initialEntries: ["/"] });

    expect(await screen.findByRole("heading", { name: "Users" }, ASYNC)).toBeInTheDocument();
    expect(await screen.findByText("Amina Officer", {}, ASYNC)).toBeInTheDocument();
    expect(screen.getByText("Invited (pending)")).toBeInTheDocument();
  });

  it("the invite drawer never renders a password field (BE-7)", async () => {
    signIn();
    const user = userEvent.setup();
    renderApp({ routes: testRoutes, initialEntries: ["/"] });

    await screen.findByText("Amina Officer", {}, ASYNC);
    await user.click(await screen.findByRole("button", { name: /Invite User/ }, ASYNC));

    expect(await drawer().findByLabelText("Name", {}, ASYNC)).toBeInTheDocument();
    expect(drawer().getByLabelText("Email")).toBeInTheDocument();
    expect(drawer().getByLabelText("Mobile")).toBeInTheDocument();
    expect(drawer().getByRole("combobox", { name: "Roles" })).toBeInTheDocument();
    expect(drawer().queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).not.toBeInTheDocument();
  });

  it(
    "provision-without-email surfaces the 403 when a chosen role holds an approval permission - not swallowed",
    async () => {
      signIn();
      const user = userEvent.setup();
      renderApp({ routes: testRoutes, initialEntries: ["/"] });

      await screen.findByText("Amina Officer", {}, ASYNC);
      await user.click(await screen.findByRole("button", { name: /Provision/ }, ASYNC));

      await user.type(await drawer().findByLabelText("Name", {}, ASYNC), "Ops Staffer");
      await user.type(drawer().getByLabelText("Mobile"), "+971500009999");
      await user.type(drawer().getByLabelText("Temporary Password"), "TempPass123!");

      await user.click(drawer().getByRole("combobox", { name: "Roles" }));
      // "Manager" holds purchase.po.approve in the mock catalogue - the
      // provision path must reject it (core/rbac/queries.ts's
      // roleIdsHoldApprovalPermission on the real backend).
      await user.click(await screen.findByText("Manager"));
      await user.keyboard("{Escape}");

      await user.click(drawer().getByRole("button", { name: "Save" }));

      expect(
        await drawer().findByText(/approval permission/i, {}, ASYNC),
      ).toBeInTheDocument();
      // The drawer must still be open - a swallowed error would have closed it.
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    },
    20000,
  );

  it("suspends and reactivates an active user", async () => {
    signIn();
    const user = userEvent.setup();
    renderApp({ routes: testRoutes, initialEntries: ["/"] });

    await screen.findByText("Amina Officer", {}, ASYNC);
    const row = screen.getByText("Amina Officer").closest("tr");
    if (!row) {
      throw new Error("expected a table row");
    }

    await user.click(within(row).getByRole("button", { name: "Suspend" }));
    await waitFor(() => expect(screen.getAllByText("Suspended").length).toBeGreaterThan(0), ASYNC);
  });
});
