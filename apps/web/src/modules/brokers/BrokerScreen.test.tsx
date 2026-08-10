import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, within } from "@testing-library/react";
import type { RouteObject } from "react-router-dom";
import { renderApp } from "../../test/render-app";
import { useAppStore } from "../../core/store/app-store";
import { BrokerScreen } from "./BrokerScreen";

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

const testRoutes: RouteObject[] = [{ path: "/", element: <BrokerScreen /> }];

/** Prompt 21 item 4 - Broker is its own full module (mirrors SupplierScreen.test.tsx). */
describe("BrokerScreen", () => {
  it(
    "deactivating a broker flips it to Activate in the same row",
    async () => {
      signIn();
      const user = userEvent.setup();
      renderApp({ routes: testRoutes, initialEntries: ["/"] });

      await screen.findByText("Gulf Broking LLC", {}, ASYNC);
      const row = screen.getByText("Gulf Broking LLC").closest("tr");
      if (!row) {
        throw new Error("expected a table row for Gulf Broking LLC");
      }

      await user.click(within(row).getByRole("button", { name: "Deactivate" }));

      await screen.findByRole("button", { name: "Activate" }, ASYNC);
      expect(within(row).queryByRole("button", { name: "Deactivate" })).not.toBeInTheDocument();
    },
    30000,
  );

  it(
    "a duplicate broker name is rejected and the server error is surfaced",
    async () => {
      signIn();
      const user = userEvent.setup();
      renderApp({ routes: testRoutes, initialEntries: ["/"] });

      await screen.findByText("Gulf Broking LLC", {}, ASYNC);
      await user.click(await screen.findByRole("button", { name: /New Broker/ }, ASYNC));

      await user.type(await drawer().findByLabelText("Broker Name", {}, ASYNC), "Gulf Broking LLC");
      await user.click(drawer().getByRole("button", { name: "Save" }));

      expect(await drawer().findByText(/already exists/i, {}, ASYNC)).toBeInTheDocument();
      expect(drawer().getByLabelText("Broker Name")).toHaveValue("Gulf Broking LLC");
    },
    30000,
  );

  it(
    "creates a broker with a contact, and it appears in the list",
    async () => {
      signIn();
      const user = userEvent.setup();
      renderApp({ routes: testRoutes, initialEntries: ["/"] });

      await screen.findByText("Gulf Broking LLC", {}, ASYNC);
      await user.click(await screen.findByRole("button", { name: /New Broker/ }, ASYNC));

      await user.type(await drawer().findByLabelText("Broker Name", {}, ASYNC), "New Test Broker");
      await user.type(drawer().getByLabelText("New contact person"), "Jane Broker");
      await user.click(drawer().getByRole("button", { name: /Add contact/ }));
      await user.click(drawer().getByRole("button", { name: "Save" }));

      expect(await screen.findByText("New Test Broker", {}, ASYNC)).toBeInTheDocument();
    },
    30000,
  );
});
