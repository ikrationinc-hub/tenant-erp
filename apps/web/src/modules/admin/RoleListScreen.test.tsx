import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import type { RouteObject } from "react-router-dom";
import { renderApp } from "../../test/render-app";
import { useAppStore } from "../../core/store/app-store";
import { queryClient } from "../../core/api/query-client";
import { MENU_TREE_QUERY_KEY } from "../../core/navigation/use-menu-tree";
import { RoleListScreen } from "./RoleListScreen";

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

function dialog() {
  return within(screen.getByRole("dialog"));
}

const testRoutes: RouteObject[] = [{ path: "/", element: <RoleListScreen /> }];

describe("RoleListScreen - permission & field-permission assignment", () => {
  it(
    "permission Transfer round-trips a grant and invalidates the current session's own menu/permissions cache",
    async () => {
      signIn();
      const user = userEvent.setup();
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      renderApp({ routes: testRoutes, initialEntries: ["/"] });

      await screen.findByText("Viewer", {}, ASYNC);
      const row = screen.getByText("Viewer").closest("tr");
      if (!row) {
        throw new Error("expected a table row");
      }
      await user.click(within(row).getByRole("button", { name: "Permissions" }));

      // "Viewer" doesn't have purchase.po.create granted in the mock seed.
      const grantItem = await dialog().findByText(/purchase\.po\.create/, {}, ASYNC);
      await user.click(grantItem);
      // The move-right/move-left buttons live in ant-transfer-operation, a
      // sibling of the two list panels - not identifiable by role/name
      // alone (icon-only), so a scoped DOM query is the reliable way in.
      const operationButtons = document.querySelectorAll(".ant-transfer-operation button");
      const moveRight = operationButtons[0];
      if (!(moveRight instanceof HTMLElement)) {
        throw new Error("expected a transfer move-right button");
      }
      await user.click(moveRight);

      await waitFor(() =>
        expect(
          invalidateSpy.mock.calls.some(
            (call) => (call[0] as { queryKey?: unknown[] } | undefined)?.queryKey?.[0] === "users",
          ),
        ).toBe(true),
      );
      expect(
        invalidateSpy.mock.calls.some(
          (call) => (call[0] as { queryKey?: unknown } | undefined)?.queryKey === MENU_TREE_QUERY_KEY,
        ),
      ).toBe(true);
    },
    20000,
  );

  it(
    "field-permission matrix saves a view/edit change for a module.entity",
    async () => {
      signIn();
      const user = userEvent.setup();
      renderApp({ routes: testRoutes, initialEntries: ["/"] });

      await screen.findByText("Viewer", {}, ASYNC);
      const row = screen.getByText("Viewer").closest("tr");
      if (!row) {
        throw new Error("expected a table row");
      }
      await user.click(within(row).getByRole("button", { name: "Permissions" }));

      await user.click(await dialog().findByRole("combobox", { name: "Module.entity" }, ASYNC));
      await user.click(await screen.findByText("masters.country"));

      const viewCheckbox = await dialog().findByLabelText("Code - View", {}, ASYNC);
      expect(viewCheckbox).toBeChecked();
      await user.click(viewCheckbox);
      expect(viewCheckbox).not.toBeChecked();

      await user.click(dialog().getByRole("button", { name: "Save field permissions" }));
      await waitFor(() => expect(screen.getByText("Field permissions saved")).toBeInTheDocument(), ASYNC);
    },
    20000,
  );
});
