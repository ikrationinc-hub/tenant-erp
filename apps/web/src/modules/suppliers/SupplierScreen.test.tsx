import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, within } from "@testing-library/react";
import type { RouteObject } from "react-router-dom";
import { renderApp } from "../../test/render-app";
import { useAppStore } from "../../core/store/app-store";
import { SupplierScreen } from "./SupplierScreen";

const ASYNC = { timeout: 15000 };

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

const testRoutes: RouteObject[] = [{ path: "/", element: <SupplierScreen /> }];

describe("SupplierScreen", () => {
  it(
    "FR-004: deactivating a supplier flips it to Activate in the same row",
    async () => {
      signIn();
      const user = userEvent.setup();
      renderApp({ routes: testRoutes, initialEntries: ["/"] });

      await screen.findByText("Metal Traders LLC", {}, ASYNC);
      const row = screen.getByText("Metal Traders LLC").closest("tr");
      if (!row) {
        throw new Error("expected a table row for Metal Traders LLC");
      }

      await user.click(within(row).getByRole("button", { name: "Deactivate" }));

      await screen.findByRole("button", { name: "Activate" }, ASYNC);
      expect(within(row).queryByRole("button", { name: "Deactivate" })).not.toBeInTheDocument();
    },
    30000,
  );

  it(
    "FR-005: a duplicate supplier name is rejected and the server error is surfaced",
    async () => {
      signIn();
      const user = userEvent.setup();
      renderApp({ routes: testRoutes, initialEntries: ["/"] });

      await screen.findByText("Metal Traders LLC", {}, ASYNC);
      await user.click(await screen.findByRole("button", { name: /New Supplier/ }, ASYNC));

      await user.type(await drawer().findByLabelText("Supplier Name", {}, ASYNC), "Metal Traders LLC");

      // The list now resolves these same master-data labels for its own
      // rows (fixed supplierTypeId/countryId/etc. columns rendering raw
      // ids), so a bare text match is ambiguous between an already-visible
      // table cell and the freshly-opened dropdown's option - pick the
      // option, the one appended last (AntD portals the dropdown at the
      // end of the DOM, after the table).
      async function selectDropdownOption(comboboxName: string, optionText: string): Promise<void> {
        await user.click(drawer().getByRole("combobox", { name: comboboxName }));
        const matches = await screen.findAllByText(optionText, {}, ASYNC);
        const lastMatch = matches.at(-1);
        if (!lastMatch) {
          throw new Error(`expected at least one match for "${optionText}"`);
        }
        await user.click(lastMatch);
      }

      await selectDropdownOption("Supplier Type", "Supplier Types 1");
      await selectDropdownOption("Country", "United Arab Emirates");
      await selectDropdownOption("Payment Terms", "Payment Terms 1");
      await selectDropdownOption("Default Currency", "UAE Dirham");

      await user.click(drawer().getByRole("button", { name: "Save" }));

      expect(await drawer().findByText(/already exists/i, {}, ASYNC)).toBeInTheDocument();
      // The drawer stays open on failure - the duplicate was never created.
      expect(drawer().getByLabelText("Supplier Name")).toHaveValue("Metal Traders LLC");
    },
    30000,
  );
});
