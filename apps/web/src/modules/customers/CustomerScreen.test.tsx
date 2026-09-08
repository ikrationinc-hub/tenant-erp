import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, within } from "@testing-library/react";
import type { RouteObject } from "react-router-dom";
import { renderApp } from "../../test/render-app";
import { useAppStore } from "../../core/store/app-store";
import { CustomerScreen } from "./CustomerScreen";

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

const testRoutes: RouteObject[] = [{ path: "/", element: <CustomerScreen /> }];

describe("CustomerScreen (S-1, docs/SALES-MODULE-PLAN.md)", () => {
  it(
    "deactivating a customer flips it to Activate in the same row",
    async () => {
      signIn();
      const user = userEvent.setup();
      renderApp({ routes: testRoutes, initialEntries: ["/"] });

      await screen.findByText("Northgate Metals", {}, ASYNC);
      const row = screen.getByText("Northgate Metals").closest("tr");
      if (!row) {
        throw new Error("expected a table row for Northgate Metals");
      }

      await user.click(within(row).getByRole("button", { name: "Deactivate" }));

      await screen.findByRole("button", { name: "Activate" }, ASYNC);
      expect(within(row).queryByRole("button", { name: "Deactivate" })).not.toBeInTheDocument();
    },
    30000,
  );

  it(
    "a duplicate customer name is rejected and the server error is surfaced",
    async () => {
      signIn();
      const user = userEvent.setup();
      renderApp({ routes: testRoutes, initialEntries: ["/"] });

      await screen.findByText("Northgate Metals", {}, ASYNC);
      await user.click(await screen.findByRole("button", { name: /New Customer/ }, ASYNC));

      await user.type(await drawer().findByLabelText("Customer Name", {}, ASYNC), "Northgate Metals");

      async function selectDropdownOption(comboboxName: string, optionText: string): Promise<void> {
        await user.click(drawer().getByRole("combobox", { name: comboboxName }));
        const matches = await screen.findAllByText(optionText, {}, ASYNC);
        const lastMatch = matches.at(-1);
        if (!lastMatch) {
          throw new Error(`expected at least one match for "${optionText}"`);
        }
        await user.click(lastMatch);
      }

      await selectDropdownOption("Customer Type", "Customer Types 1");
      await selectDropdownOption("Country", "United Arab Emirates");
      await selectDropdownOption("Payment Terms", "Payment Terms 1");
      await selectDropdownOption("Default Currency", "UAE Dirham");

      await user.click(drawer().getByRole("button", { name: "Save" }));

      expect(await drawer().findByText(/already exists/i, {}, ASYNC)).toBeInTheDocument();
      expect(drawer().getByLabelText("Customer Name")).toHaveValue("Northgate Metals");
    },
    30000,
  );

  it(
    "renders the one Save button after Contacts and Banking, not stranded above them",
    async () => {
      signIn();
      const user = userEvent.setup();
      renderApp({ routes: testRoutes, initialEntries: ["/"] });

      await screen.findByText("Northgate Metals", {}, ASYNC);
      await user.click(await screen.findByRole("button", { name: /New Customer/ }, ASYNC));

      const dialog = await screen.findByRole("dialog", {}, ASYNC);
      await within(dialog).findByLabelText("Customer Name", {}, ASYNC);
      const contactsHeading = within(dialog).getByText("Contacts");
      const saveButton = within(dialog).getByRole("button", { name: "Save" });

      expect(
        contactsHeading.compareDocumentPosition(saveButton) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    },
    30000,
  );
});
