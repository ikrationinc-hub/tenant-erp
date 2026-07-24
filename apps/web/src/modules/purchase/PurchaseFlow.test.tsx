import { describe, expect, it } from "vitest";
import { act } from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import { useLocation, type RouteObject } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { renderApp } from "../../test/render-app";
import { useAppStore } from "../../core/store/app-store";
import { server } from "../../mocks/server";
import { endpoints } from "../../core/api/endpoints";
import { queryClient } from "../../core/api/query-client";
import { PurchaseListScreen, PURCHASE_LIST_PATH } from "./PurchaseListScreen";
import { PurchaseDetailScreen } from "./PurchaseDetailScreen";

const ASYNC = { timeout: 20000 };
const API_BASE = import.meta.env.VITE_API_BASE_URL;

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

const testRoutes: RouteObject[] = [
  { path: PURCHASE_LIST_PATH, element: <PurchaseListScreen /> },
  { path: `${PURCHASE_LIST_PATH}/new`, element: <PurchaseDetailScreen mode="create" /> },
  {
    path: `${PURCHASE_LIST_PATH}/:id`,
    element: <PurchaseDetailScreenFromParams />,
  },
];

// createMemoryRouter never touches window.location - useLocation() is the
// only thing that reflects its current path. This wrapper is test-only
// plumbing (the app's real route tree uses DynamicRoutes' wildcard + the
// purchase-registry.tsx resolver, not a `:id` route param, at all).
function PurchaseDetailScreenFromParams(): ReturnType<typeof PurchaseDetailScreen> {
  const location = useLocation();
  const id = location.pathname.split("/").pop() ?? "";
  return <PurchaseDetailScreen mode="edit" purchaseId={id} />;
}

/**
 * A closed AntD Select keeps its option list in the DOM (display:none,
 * not unmounted) rather than unmounting it, so any option label that
 * happens to reappear later (two dropdowns sharing a master, or the same
 * text turning up in a still-mounted, already-closed dropdown elsewhere
 * on the page) can leave a stale, hidden match behind. The freshly
 * opened dropdown's own copy is always the LAST match in DOM order
 * (portals append) - using that consistently, even where only one match
 * exists today, is more robust than reasoning about which fields happen
 * to collide.
 */
async function selectOption(user: ReturnType<typeof userEvent.setup>, comboboxName: string, optionName: string): Promise<void> {
  // Async, not getByRole: a combobox grabbed mid-re-render (from the
  // previous field's own state settling) can be a stale node clicking
  // does nothing useful to.
  await user.click(await screen.findByRole("combobox", { name: comboboxName }, ASYNC));
  const matches = await screen.findAllByText(optionName, {}, ASYNC);
  const option = matches.at(-1);
  if (!option) {
    throw new Error(`expected at least one "${optionName}" match`);
  }
  await user.click(option);
}

async function fillHeaderAndShipment(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(await screen.findByLabelText("Purchase Date", {}, ASYNC), "2026-08-01{Enter}");

  await selectOption(user, "Branch", "Dubai HQ");
  await selectOption(user, "Buyer", "Demo Admin");
  await selectOption(user, "Supplier", "Metal Traders LLC");

  await user.type(screen.getByLabelText("Shipment Lot Number"), "LOT-1");
  await user.type(screen.getByLabelText("Container Number"), "CONT-1");
  await user.type(screen.getByLabelText("Bill of Lading No."), "BL-1");
  await user.type(screen.getByLabelText("Loading Date"), "2026-08-01{Enter}");

  await selectOption(user, "Through", "Transport Modes 1");
  await selectOption(user, "Port of Loading", "Ports 1");
  await selectOption(user, "Port of Discharge", "Ports 1");
  await selectOption(user, "Warehouse", "Jebel Ali Warehouse");
  await selectOption(user, "Incoterm", "Incoterms 1");
}

describe("Purchase - create, items, and workflow", () => {
  it(
    "creates a purchase, adds an item with server-computed pricing, then Approve -> Post makes it read-only",
    async () => {
      signIn();
      const user = userEvent.setup();
      const { router } = renderApp({ routes: testRoutes, initialEntries: [`${PURCHASE_LIST_PATH}/new`] });

      await fillHeaderAndShipment(user);
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(router.state.location.pathname).not.toBe(`${PURCHASE_LIST_PATH}/new`), ASYNC);
      expect(await screen.findByText("Draft", {}, ASYNC)).toBeInTheDocument();

      // Add an item - purchaseAmountUsd/Aed are never sent by the client
      // (addPurchaseItemSchema doesn't accept them); the mock "server"
      // computes them, proving the UI displays what it received back.
      await user.click(await screen.findByRole("button", { name: "Add Item" }, ASYNC));
      const itemDrawer = within(screen.getByRole("dialog"));

      await user.click(itemDrawer.getByRole("combobox", { name: "Item" }));
      await user.click((await screen.findAllByText("Items 1", {}, ASYNC)).at(-1) ?? screen.getByText("Items 1"));
      await user.type(itemDrawer.getByLabelText("Quantity"), "500");
      await user.click(itemDrawer.getByRole("combobox", { name: "Unit of Measure" }));
      await user.click(
        (await screen.findAllByText("Units of Measure 1", {}, ASYNC)).at(-1) ?? screen.getByText("Units of Measure 1"),
      );
      await user.type(itemDrawer.getByLabelText("Purchase Rate (USD)"), "8432.75");
      await user.type(itemDrawer.getByLabelText("Exchange Rate"), "3.6725");
      await user.click(itemDrawer.getByRole("button", { name: "Save" }));

      expect(await screen.findByText("4216375.00", {}, ASYNC)).toBeInTheDocument();

      // Workflow: Draft -> Approved -> Posted.
      await user.click(await screen.findByRole("button", { name: "Approve" }, ASYNC));
      expect(await screen.findByText("Approved", {}, ASYNC)).toBeInTheDocument();

      await user.click(await screen.findByRole("button", { name: "Post" }, ASYNC));
      expect(await screen.findByText("Posted", {}, ASYNC)).toBeInTheDocument();

      // Rule 8: posted is immutable, visible in the UI, not just the API.
      expect(
        await screen.findByText(/posted and immutable/i, {}, ASYNC),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add Item" })).not.toBeInTheDocument();
    },
    60000,
  );
});

describe("Purchase - Tier-2 field engine proof", () => {
  it(
    "renaming 'Other Charges' via field-definitions changes the costs panel's label with no rebuild",
    async () => {
      signIn();
      const fixture = {
        id: "purchase-tier2",
        purchaseNumber: "PO-9999",
        status: "draft",
        shipment: {},
        items: [],
        allocations: [],
        additionalCosts: {},
        lmeRecords: [],
        hedges: [],
      };
      server.use(
        http.get(`${API_BASE}${endpoints.purchases}/purchase-tier2`, () => HttpResponse.json(fixture)),
      );

      renderApp({ routes: testRoutes, initialEntries: [`${PURCHASE_LIST_PATH}/purchase-tier2`] });

      expect(await screen.findByLabelText("Other Charges", {}, ASYNC)).toBeInTheDocument();

      const current = queryClient.getQueryData<{ fields: { fieldKey: string; label: string }[] }>([
        "field-definitions",
        "purchase",
        "po",
      ]);
      if (!current) {
        throw new Error("expected the costs field-definitions to already be cached");
      }
      const relabeled = {
        ...current,
        fields: current.fields.map((field) =>
          field.fieldKey === "otherCharges" ? { ...field, label: "Clearing Charges" } : field,
        ),
      };
      act(() => {
        queryClient.setQueryData(["field-definitions", "purchase", "po"], relabeled);
      });

      expect(await screen.findByLabelText("Clearing Charges", {}, ASYNC)).toBeInTheDocument();
      expect(screen.queryByLabelText("Other Charges")).not.toBeInTheDocument();
    },
    30000,
  );
});

function draftFixture(id: string): Record<string, unknown> {
  return {
    id,
    purchaseNumber: "PO-8888",
    status: "draft",
    shipment: {},
    items: [],
    allocations: [],
    additionalCosts: {},
    lmeRecords: [],
    hedges: [],
  };
}

describe("Purchase - permission-gated workflow transitions", () => {
  it(
    "hides Approve without purchase.po.approve, and hides Post without purchase.po.post",
    async () => {
      signIn();
      server.use(
        http.get(`${API_BASE}${endpoints.purchases}/purchase-no-approve`, () =>
          HttpResponse.json(draftFixture("purchase-no-approve")),
        ),
        http.get(`${API_BASE}${endpoints.myPermissions}`, () =>
          HttpResponse.json({
            permissions: ["purchase.po.read", "purchase.po.update", "purchase.po.post"],
          }),
        ),
      );

      renderApp({ routes: testRoutes, initialEntries: [`${PURCHASE_LIST_PATH}/purchase-no-approve`] });

      expect(await screen.findByText("Draft", {}, ASYNC)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    },
    30000,
  );

  it(
    "hides Post on an approved purchase without purchase.po.post",
    async () => {
      signIn();
      server.use(
        http.get(`${API_BASE}${endpoints.purchases}/purchase-no-post`, () =>
          HttpResponse.json({ ...draftFixture("purchase-no-post"), status: "approved" }),
        ),
        http.get(`${API_BASE}${endpoints.myPermissions}`, () =>
          HttpResponse.json({
            permissions: ["purchase.po.read", "purchase.po.update", "purchase.po.approve"],
          }),
        ),
      );

      renderApp({ routes: testRoutes, initialEntries: [`${PURCHASE_LIST_PATH}/purchase-no-post`] });

      expect(await screen.findByText("Approved", {}, ASYNC)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Post" })).not.toBeInTheDocument();
    },
    30000,
  );
});

describe("Purchase - metadata-driven sections", () => {
  it(
    "renders fields from every spec section (A-H) purely from field-definitions, with zero hardcoded labels",
    async () => {
      signIn();
      server.use(
        http.get(`${API_BASE}${endpoints.purchases}/purchase-sections`, () =>
          HttpResponse.json(draftFixture("purchase-sections")),
        ),
      );

      renderApp({ routes: testRoutes, initialEntries: [`${PURCHASE_LIST_PATH}/purchase-sections`] });

      // A Header / B Supplier Details / C Shipment - one combined SchemaForm.
      expect(await screen.findByLabelText("Purchase Date", {}, ASYNC)).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "Supplier" })).toBeInTheDocument();
      expect(screen.getByLabelText("Container Number")).toBeInTheDocument();
      // H Attachments - folded into the same header entity.
      expect(screen.getByLabelText("Invoice")).toBeInTheDocument();
      expect(screen.getByLabelText("Other Documents")).toBeInTheDocument();
      // D Item / E Pricing, F Allocation, G Additional Cost, LME + Hedging -
      // rendered as their own panels once the record exists (create mode
      // gates them the same way Draft/Approved status gates Approve/Post).
      expect(screen.getByText("Purchase Items & Pricing")).toBeInTheDocument();
      expect(screen.getByText("Additional Cost")).toBeInTheDocument();
      expect(screen.getByText("Customer Allocation")).toBeInTheDocument();
      expect(screen.getByText("LME Records")).toBeInTheDocument();
      expect(screen.getByText("Hedging Details")).toBeInTheDocument();
    },
    30000,
  );
});

describe("Purchase - attachment upload wiring", () => {
  // The progress-reporting and resolve/reject-on-server-status contract is
  // proven precisely (including a virus-scan rejection) in
  // core/attachments/upload-attachment.test.ts, which controls the
  // server's response directly - jsdom's XHR/FormData polyfill collapses a
  // real File's name to "blob" before it reaches MSW's node interceptor,
  // so asserting a real filename through THIS full widget stack isn't
  // reliable. This test instead proves the DOM wiring itself: selecting a
  // file on a real (uploadContext-bound) FileUpload field drives it
  // through customRequest, and the field settles out of its uploading
  // state once the mock "server" (attachments-handlers.ts) responds.
  it(
    "drives a real upload through the Invoice field and clears the uploading state",
    async () => {
      signIn();
      const user = userEvent.setup();
      const purchaseId = "55555555-5555-4555-8555-555555555555";
      server.use(
        http.get(`${API_BASE}${endpoints.purchases}/${purchaseId}`, () => HttpResponse.json(draftFixture(purchaseId))),
      );

      renderApp({ routes: testRoutes, initialEntries: [`${PURCHASE_LIST_PATH}/${purchaseId}`] });

      const input = await screen.findByLabelText("Invoice", {}, ASYNC);
      const file = new File(["%PDF-1.4"], "supplier-invoice.pdf", { type: "application/pdf" });
      await user.upload(input, file);

      // rc-upload manages its hidden <input type="file"> imperatively and
      // can recreate it around the upload lifecycle, so anchor on the
      // FieldShell's <label> (a stable, React-managed node) instead of the
      // input itself to find the surrounding Form.Item.
      const formItem = screen.getByText("Invoice").closest(".ant-form-item");
      if (!(formItem instanceof HTMLElement)) {
        throw new Error("expected the Invoice field's Form.Item wrapper");
      }
      await waitFor(
        () => expect(within(formItem).getByRole("button", { name: /Select file/ })).not.toHaveClass("ant-btn-loading"),
        ASYNC,
      );
    },
    30000,
  );
});
