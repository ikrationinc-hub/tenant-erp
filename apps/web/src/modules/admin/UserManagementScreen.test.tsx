import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import type { RouteObject } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { renderApp } from "../../test/render-app";
import { useAppStore } from "../../core/store/app-store";
import { server } from "../../mocks/server";
import { endpoints } from "../../core/api/endpoints";
import { UserManagementScreen } from "./UserManagementScreen";

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
      // "Manager" holds purchase.po.issue (PL-3's rename of the old
      // purchase.po.approve) in the mock catalogue - the provision path
      // must reject it (core/rbac/queries.ts's roleIdsHoldApprovalPermission
      // on the real backend, which matches both "approve" and "issue").
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

    // Actually reactivate too, matching the test's own name - the mock
    // users array (admin-handlers.ts) is a module-level singleton that
    // outlives this one test, so leaving Amina suspended here silently
    // breaks every later test in this file that assumes she's active.
    await user.click(within(row).getByRole("button", { name: "Reactivate" }));
    await waitFor(() => expect(within(row).getByRole("button", { name: "Suspend" })).toBeInTheDocument(), ASYNC);
  });

  it("never offers Suspend or Edit roles on the signed-in user's own row", async () => {
    signIn();
    renderApp({ routes: testRoutes, initialEntries: ["/"] });

    // signIn()'s user id (11111111-...) matches "Demo Admin" in the mock
    // user list - suspending or re-rolling your own account with nobody
    // else around to undo it is a self-lockout foot-gun, not a permission
    // question (an Admin holds users.user.update on every row).
    await screen.findByText("Amina Officer", {}, ASYNC);
    const ownRow = screen.getByText("Demo Admin").closest("tr");
    const otherRow = screen.getByText("Amina Officer").closest("tr");
    if (!ownRow || !otherRow) {
      throw new Error("expected both rows");
    }

    expect(within(ownRow).queryByRole("button", { name: "Suspend" })).not.toBeInTheDocument();
    expect(within(ownRow).queryByRole("button", { name: "Edit roles" })).not.toBeInTheDocument();
    expect(within(otherRow).getByRole("button", { name: "Suspend" })).toBeInTheDocument();
    expect(within(otherRow).getByRole("button", { name: "Edit roles" })).toBeInTheDocument();
  });

  it("hides Invite User and Provision when the signed-in user lacks the permission", async () => {
    signIn();
    server.use(
      http.get(`${API_BASE}${endpoints.myPermissions}`, () =>
        HttpResponse.json({ permissions: ["users.user.read"] }),
      ),
    );
    renderApp({ routes: testRoutes, initialEntries: ["/"] });

    await screen.findByText("Amina Officer", {}, ASYNC);
    await waitFor(() => expect(screen.queryByRole("button", { name: /Invite User/ })).not.toBeInTheDocument(), ASYNC);
    expect(screen.queryByRole("button", { name: /Provision/ })).not.toBeInTheDocument();
  });
});
