import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, within } from "@testing-library/react";
import type { RouteObject } from "react-router-dom";
import { renderApp } from "../../test/render-app";
import { useAppStore } from "../../core/store/app-store";
import { CompanyScreen } from "./CompanyScreen";

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

/** The Drawer's SchemaForm fields share labels with the still-mounted SchemaTable's own columns behind it - scope to the dialog (same fix as MasterScreen.test.tsx). */
function drawer() {
  return within(screen.getByRole("dialog"));
}

/**
 * The list table now resolves master-backed select columns to their
 * label too (Country/Currency), so an option's text can already be
 * on-screen in an existing row before the dropdown is even opened - a
 * bare `findByText` is ambiguous between that cell and the freshly-
 * opened dropdown's own copy. The dropdown's own copy is always the
 * LAST DOM match (AntD portals append), same fix as SupplierScreen/
 * PurchaseFlow's own dropdown-selection helpers.
 */
async function selectDropdownOption(user: ReturnType<typeof userEvent.setup>, comboboxName: string, optionText: string): Promise<void> {
  await user.click(drawer().getByRole("combobox", { name: comboboxName }));
  const matches = await screen.findAllByText(optionText, {}, ASYNC);
  const lastMatch = matches.at(-1);
  if (!lastMatch) {
    throw new Error(`expected at least one match for "${optionText}"`);
  }
  await user.click(lastMatch);
}

const testRoutes: RouteObject[] = [{ path: "/", element: <CompanyScreen /> }];

describe("CompanyScreen", () => {
  it(
    "creates a company - scope comes from context, never a company_id form field (a normal schema-driven screen, no special-casing)",
    async () => {
      signIn();
      const user = userEvent.setup();
      renderApp({ routes: testRoutes, initialEntries: ["/"] });

      expect(await screen.findByRole("heading", { name: "Companies" }, ASYNC)).toBeInTheDocument();
      expect(await screen.findByText("Ikration Metals Trading", {}, ASYNC)).toBeInTheDocument();

      // The list resolves Country/Currency (master-backed selects) to
      // their names, not the raw stored id ("ae"/"aed") - SchemaTable's
      // own useMasterLabels, not something CompanyScreen wires by hand.
      const row = screen.getByText("Ikration Metals Trading").closest("tr");
      if (!row) {
        throw new Error("expected a table row for Ikration Metals Trading");
      }
      expect(within(row).getByText("United Arab Emirates")).toBeInTheDocument();
      expect(within(row).getByText("UAE Dirham")).toBeInTheDocument();
      expect(within(row).queryByText("ae")).not.toBeInTheDocument();
      expect(within(row).queryByText("aed")).not.toBeInTheDocument();

      await user.click(await screen.findByRole("button", { name: /New Companies/ }, ASYNC));

      // The company's own tenant/company scope is never a rendered field -
      // the backend injects it from the request's auth context.
      expect(await drawer().findByLabelText("Name", {}, ASYNC)).toBeInTheDocument();
      expect(drawer().queryByLabelText(/company.?id/i)).not.toBeInTheDocument();
      expect(drawer().queryByLabelText("Tenant")).not.toBeInTheDocument();

      await user.type(drawer().getByLabelText("Name"), "Ikration Testland LLC");

      await selectDropdownOption(user, "Country", "United Arab Emirates");
      await selectDropdownOption(user, "Currency", "UAE Dirham");
      await selectDropdownOption(user, "Fiscal Year Start Month", "January");

      await user.type(drawer().getByLabelText("Timezone"), "Asia/Dubai");

      await selectDropdownOption(user, "Status", "Active");

      await user.click(drawer().getByRole("button", { name: "Save" }));

      expect(await screen.findByText("Ikration Testland LLC", {}, ASYNC)).toBeInTheDocument();
    },
    30000,
  );
});
