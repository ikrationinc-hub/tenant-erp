import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import type { RouteObject } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { renderApp } from "../../test/render-app";
import { useAppStore } from "../../core/store/app-store";
import { server } from "../../mocks/server";
import { endpoints } from "../../core/api/endpoints";
import { SchemaForm } from "../../core/schema-form/SchemaForm";
import { FieldDefinitionsScreen } from "./FieldDefinitionsScreen";

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

const testRoutes: RouteObject[] = [{ path: "/", element: <FieldDefinitionsScreen /> }];

async function selectModuleEntity(user: ReturnType<typeof userEvent.setup>, label: string): Promise<void> {
  await user.click(await screen.findByRole("combobox", { name: "Module / entity" }, ASYNC));
  // AntD's Select sets role="option" only on a hidden screen-reader mirror
  // list, not the actual clickable item - the real, visible option only
  // carries a `title` attribute matching the label, so that's the
  // reliable way to target it.
  await user.click(await screen.findByTitle(label, {}, ASYNC));
}

/** Renders the admin screen alongside a real SchemaForm for the SAME
 * module/entity, sharing the app's real query client (renderApp doesn't
 * spin up a fresh one) - proves a save's cache invalidation reaches an
 * already-mounted consumer, not just a fresh refetch. */
function AdminAndFormSideBySide(): ReactElement {
  return (
    <div>
      <FieldDefinitionsScreen />
      <SchemaForm module="purchase" entity="po" mode="view" onSubmit={() => Promise.resolve()} />
    </div>
  );
}

describe("FieldDefinitionsScreen", () => {
  it(
    "renders the field list for a picked module/entity",
    async () => {
      signIn();
      const user = userEvent.setup();
      renderApp({ routes: testRoutes, initialEntries: ["/"] });

      await selectModuleEntity(user, "purchase / po");

      expect(await screen.findByDisplayValue("Other Charges", {}, ASYNC)).toBeInTheDocument();
      expect(screen.getByDisplayValue("Freight")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Insurance")).toBeInTheDocument();
    },
    30000,
  );

  it(
    "editing one row's label never affects another row - even when neither has a provisioned id yet",
    async () => {
      // admin/branch's mock fixture deliberately has no `id` on any field
      // (matching a real company whose field_definitions rows haven't
      // been backfilled after the entity was added to FIELD_DEFAULTS) -
      // rowKey/updateRow used to key off `id`, so every id-less row
      // collapsed onto the same "" key and editing one row's Label
      // silently overwrote every other row's Label too.
      signIn();
      const user = userEvent.setup();
      renderApp({ routes: testRoutes, initialEntries: ["/"] });

      await selectModuleEntity(user, "admin / branch");

      const nameInput = await screen.findByDisplayValue("Name", {}, ASYNC);
      await user.clear(nameInput);
      await user.type(nameInput, "Renamed");

      expect(screen.getByDisplayValue("Renamed")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Code")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Status")).toBeInTheDocument();
    },
    30000,
  );

  it(
    "a field already hidden (isVisible: false) still appears here, so it can be turned back on",
    async () => {
      // resolveFieldSections (used by SchemaForm/SchemaTable) drops any
      // field with isVisible: false - correct for data-entry rendering,
      // but this screen must never use it: an admin who unchecks Visible
      // and saves would otherwise make that field vanish from the one
      // screen that could ever re-enable it.
      signIn();
      const user = userEvent.setup();
      server.use(
        http.get(`${API_BASE}${endpoints.fieldDefinitions("purchase", "po")}`, () =>
          HttpResponse.json({
            module: "purchase",
            entity: "po",
            fields: [
              { id: "fd-po-freight", fieldKey: "freight", label: "Freight", dataType: "decimal", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 0 },
              { id: "fd-po-insurance", fieldKey: "insurance", label: "Insurance", dataType: "decimal", isMandatory: false, isEditable: true, isSystem: false, isVisible: false, sortOrder: 1 },
            ],
          }),
        ),
      );
      renderApp({ routes: testRoutes, initialEntries: ["/"] });

      await selectModuleEntity(user, "purchase / po");

      const insuranceRow = await screen.findByDisplayValue("Insurance", {}, ASYNC);
      expect(insuranceRow).toBeInTheDocument();
      expect(screen.getByLabelText("insurance - Visible")).not.toBeChecked();
    },
    30000,
  );

  it(
    "is_system rows show disabled Visible/Mandatory toggles",
    async () => {
      signIn();
      const user = userEvent.setup();
      renderApp({ routes: testRoutes, initialEntries: ["/"] });

      await selectModuleEntity(user, "purchase / header");

      await screen.findByDisplayValue("Purchase Number", {}, ASYNC);
      expect(screen.getByLabelText("purchaseNumber - Visible")).toBeDisabled();
      expect(screen.getByLabelText("purchaseNumber - Mandatory")).toBeDisabled();
      // A non-system field on the same entity stays fully editable.
      expect(screen.getByLabelText("branchId - Visible")).not.toBeDisabled();
    },
    30000,
  );

  it(
    "editing a label and saving reflects in a SchemaForm elsewhere in the SAME session, no reload",
    async () => {
      signIn();
      const user = userEvent.setup();
      renderApp({ routes: [{ path: "/", element: <AdminAndFormSideBySide /> }], initialEntries: ["/"] });

      // The SchemaForm already shows the old label before any edit.
      expect(await screen.findByText("Other Charges", {}, ASYNC)).toBeInTheDocument();

      await selectModuleEntity(user, "purchase / po");
      const labelInput = await screen.findByDisplayValue("Other Charges", {}, ASYNC);
      await user.clear(labelInput);
      await user.type(labelInput, "Clearing Charges");
      await user.click(screen.getByRole("button", { name: "Save field definitions" }));

      await screen.findByText("Field definitions saved", {}, ASYNC);

      // The SchemaForm instance was never remounted - this is the same
      // component instance picking up the invalidated query.
      await waitFor(() => expect(screen.queryByText("Other Charges")).not.toBeInTheDocument(), ASYNC);
      expect(screen.getAllByText("Clearing Charges").length).toBeGreaterThan(0);
    },
    30000,
  );

  it(
    "the menu item is reachable by clicking, not just typing the URL",
    async () => {
      signIn();
      const user = userEvent.setup();
      renderApp({ initialEntries: ["/"] });

      await user.click(await screen.findByText("Field Definitions", {}, ASYNC));

      expect(await screen.findByRole("combobox", { name: "Module / entity" }, ASYNC)).toBeInTheDocument();
    },
    30000,
  );

  it(
    "a user without admin.field.manage never sees the menu item, and the direct URL 404s",
    async () => {
      signIn();
      server.use(
        http.get(`${API_BASE}${endpoints.myPermissions}`, () =>
          HttpResponse.json({ permissions: ["purchase.po.read"] }),
        ),
        http.get(`${API_BASE}${endpoints.menus}`, () =>
          HttpResponse.json({
            menus: [
              { id: "m-dashboard", key: "dashboard", label: "Dashboard", path: "/dashboard", icon: "dashboard", sortOrder: 1, children: [] },
              // "Field Definitions" deliberately omitted - resolve.ts
              // already excludes it server-side without admin.field.manage.
            ],
          }),
        ),
      );

      renderApp({ initialEntries: ["/"] });
      await screen.findByText("Dashboard", {}, ASYNC);
      expect(screen.queryByText("Field Definitions")).not.toBeInTheDocument();

      renderApp({ initialEntries: ["/admin/field-definitions"] });
      expect(await screen.findByText("404", {}, ASYNC)).toBeInTheDocument();
    },
    30000,
  );
});
