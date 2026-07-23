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
      email: "demo.admin@hyperion.test",
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

const testRoutes: RouteObject[] = [{ path: "/", element: <CompanyScreen /> }];

describe("CompanyScreen", () => {
  it(
    "creates a company - scope comes from context, never a company_id form field (a normal schema-driven screen, no special-casing)",
    async () => {
      signIn();
      const user = userEvent.setup();
      renderApp({ routes: testRoutes, initialEntries: ["/"] });

      expect(await screen.findByRole("heading", { name: "Companies" }, ASYNC)).toBeInTheDocument();
      expect(await screen.findByText("Hyperion Metals Trading", {}, ASYNC)).toBeInTheDocument();

      await user.click(await screen.findByRole("button", { name: /New Companies/ }, ASYNC));

      // The company's own tenant/company scope is never a rendered field -
      // the backend injects it from the request's auth context.
      expect(await drawer().findByLabelText("Name", {}, ASYNC)).toBeInTheDocument();
      expect(drawer().queryByLabelText(/company.?id/i)).not.toBeInTheDocument();
      expect(drawer().queryByLabelText("Tenant")).not.toBeInTheDocument();

      await user.type(drawer().getByLabelText("Name"), "Hyperion Testland LLC");

      await user.click(drawer().getByRole("combobox", { name: "Country" }));
      await user.click(await screen.findByText("United Arab Emirates"));

      await user.click(drawer().getByRole("combobox", { name: "Currency" }));
      await user.click(await screen.findByText("UAE Dirham"));

      await user.click(drawer().getByRole("combobox", { name: "Fiscal Year Start Month" }));
      await user.click(await screen.findByText("January"));

      await user.type(drawer().getByLabelText("Timezone"), "Asia/Dubai");

      await user.click(drawer().getByRole("combobox", { name: "Status" }));
      await user.click(await screen.findByText("Active"));

      await user.click(drawer().getByRole("button", { name: "Save" }));

      expect(await screen.findByText("Hyperion Testland LLC", {}, ASYNC)).toBeInTheDocument();
    },
    30000,
  );
});
