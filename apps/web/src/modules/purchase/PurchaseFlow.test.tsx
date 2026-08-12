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

/** Prompt 21 item 5: containerId is a Lookup field with allowCreate - typing a number nothing matches offers a "+ Add" option that POSTs to /masters/containers, then selects the newly-created row. */
async function createContainerInline(user: ReturnType<typeof userEvent.setup>, containerNumber: string): Promise<void> {
  const combobox = await screen.findByRole("combobox", { name: "Container Number" }, ASYNC);
  await user.click(combobox);
  await user.type(combobox, containerNumber);
  await user.click(await screen.findByText(`+ Add "${containerNumber}"`, {}, ASYNC));
}

// containerNumber must be unique per call: the mock containers list is
// module-scoped and persists across tests within this file (only MSW
// handler overrides get reset between tests, not the underlying mock
// data), so a second call reusing an already-created number wouldn't see
// a "+ Add" prompt and the field would stay unset.
async function fillHeaderAndShipment(user: ReturnType<typeof userEvent.setup>, containerNumber = "CONT-1"): Promise<void> {
  await user.type(await screen.findByLabelText("Purchase Date", {}, ASYNC), "2026-08-01{Enter}");

  await selectOption(user, "Division", "Divisions 1");
  await selectOption(user, "Branch", "Dubai HQ");
  // Buyer names a tenant company, not a user (client correction).
  await selectOption(user, "Buyer", "Ikration Metals Trading");
  await selectOption(user, "Supplier", "Metal Traders LLC");
  await selectOption(user, "Pricing Type", "Fixed Price Purchase");

  await user.type(screen.getByLabelText("Shipment Lot Number"), "LOT-1");
  await createContainerInline(user, containerNumber);
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

describe("Purchase - supplier invoice moves stock, not PO approval (Prompt 22)", () => {
  it(
    "approving the PO shows no invoice yet; creating and approving a supplier invoice flips its own status independently",
    async () => {
      signIn();
      const user = userEvent.setup();
      const { router } = renderApp({ routes: testRoutes, initialEntries: [`${PURCHASE_LIST_PATH}/new`] });

      await fillHeaderAndShipment(user, "CONT-P22");
      await user.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(router.state.location.pathname).not.toBe(`${PURCHASE_LIST_PATH}/new`), ASYNC);

      await user.click(await screen.findByRole("button", { name: "Add Item" }, ASYNC));
      const itemDrawer = within(screen.getByRole("dialog"));
      await user.click(itemDrawer.getByRole("combobox", { name: "Item" }));
      await user.click((await screen.findAllByText("Items 1", {}, ASYNC)).at(-1) ?? screen.getByText("Items 1"));
      await user.type(itemDrawer.getByLabelText("Quantity"), "500");
      await user.click(itemDrawer.getByRole("combobox", { name: "Unit of Measure" }));
      await user.click((await screen.findAllByText("Units of Measure 1", {}, ASYNC)).at(-1) ?? screen.getByText("Units of Measure 1"));
      await user.type(itemDrawer.getByLabelText("Purchase Rate (USD)"), "100");
      await user.type(itemDrawer.getByLabelText("Exchange Rate"), "3.6725");
      await user.click(itemDrawer.getByRole("button", { name: "Save" }));
      await screen.findByText("Purchase Items & Pricing", {}, ASYNC);

      // Section always visible, empty until a supplier invoice actually exists.
      expect(await screen.findByText("Supplier Invoices", {}, ASYNC)).toBeInTheDocument();
      expect(screen.getByText(/a purchase order is intent only/i)).toBeInTheDocument();

      await user.click(await screen.findByRole("button", { name: "Approve" }, ASYNC));
      expect(await screen.findByText("Approved", {}, ASYNC)).toBeInTheDocument();
      // Approving the PO alone never creates or touches an invoice.
      expect(screen.getByText(/a purchase order is intent only/i)).toBeInTheDocument();

      await user.click(await screen.findByRole("button", { name: /Add Invoice/ }, ASYNC));
      const invoiceDrawer = within(screen.getByRole("dialog"));
      // No {Enter} here: unlike the header/shipment form, Invoice Date is
      // the ONLY mandatory field on this form, so an Enter-triggered
      // native submit would actually pass validation and fire early,
      // closing the drawer before the explicit Save click below runs.
      await user.type(invoiceDrawer.getByLabelText("Invoice Date"), "2026-08-05");
      await user.type(invoiceDrawer.getByLabelText("Invoice Amount (USD)"), "50000");
      await user.click(invoiceDrawer.getByText("Add Supplier Invoice"));
      await user.click(invoiceDrawer.getByRole("button", { name: "Save" }));

      expect(await screen.findByText("Draft", {}, ASYNC)).toBeInTheDocument();
      expect(screen.getByText(/^SINV-2024-/)).toBeInTheDocument();

      await user.click(await screen.findByRole("button", { name: "Approve" }, ASYNC));

      // Two "Approved" tags now: the PO's own status tag, and the invoice row's.
      await waitFor(() => expect(screen.getAllByText("Approved").length).toBeGreaterThanOrEqual(2), ASYNC);
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
    // The "enabled once it has an item" side of this is already exercised
    // by this file's main create-add item-Approve flow test above - that
    // one only reaches a clickable Approve because the button isn't
    // disabled once an item exists.
    "disables Approve, with a tooltip explaining why, on a draft with zero items - a UX nicety, never the actual guard (core/workflow/guards.ts enforces it server-side regardless of what the frontend does)",
    async () => {
      signIn();
      const user = userEvent.setup();
      server.use(
        http.get(`${API_BASE}${endpoints.purchases}/purchase-no-items`, () => HttpResponse.json(draftFixture("purchase-no-items"))),
      );

      renderApp({ routes: testRoutes, initialEntries: [`${PURCHASE_LIST_PATH}/purchase-no-items`] });

      const approveButton = await screen.findByRole("button", { name: "Approve" }, ASYNC);
      expect(approveButton).toBeDisabled();

      await user.hover(approveButton);
      expect(await screen.findByText("Add at least one item before approving", {}, ASYNC)).toBeInTheDocument();
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

  it(
    "hides the header form's Save button (and Additional Cost's) for a Viewer missing purchase.po.update, on a draft or approved purchase",
    async () => {
      signIn();
      server.use(
        http.get(`${API_BASE}${endpoints.purchases}/purchase-viewer`, () =>
          HttpResponse.json({ ...draftFixture("purchase-viewer"), status: "approved" }),
        ),
        http.get(`${API_BASE}${endpoints.myPermissions}`, () => HttpResponse.json({ permissions: ["purchase.po.read"] })),
      );

      renderApp({ routes: testRoutes, initialEntries: [`${PURCHASE_LIST_PATH}/purchase-viewer`] });

      expect(await screen.findByText("Approved", {}, ASYNC)).toBeInTheDocument();
      // Wait for both SchemaForms to actually finish their own
      // field-definitions fetch (each shows its own loading spinner until
      // then) - asserting Save's absence any earlier is meaningless, since
      // neither form has rendered a Save button yet either way. The label
      // text itself (not findByLabelText) since a Viewer's fields render
      // read-only (a <span>, not a labelled <input>).
      await screen.findByText("Purchase Date", {}, ASYNC);
      await screen.findByText("Other Charges", {}, ASYNC);
      expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    },
    30000,
  );

  it(
    // Prompt 22 Part 4: items are the deliberate exception now - they stay
    // editable through Approved (a stock-relevant edit sends any approved
    // invoice back to Draft for re-approval), unlike Header/Costs, which
    // still lock at Approved exactly as before.
    "hides Header/Costs Save buttons on an approved purchase even WITH purchase.po.update, but Add Item stays available",
    async () => {
      signIn();
      server.use(
        http.get(`${API_BASE}${endpoints.purchases}/purchase-approved-locked`, () =>
          HttpResponse.json({ ...draftFixture("purchase-approved-locked"), status: "approved" }),
        ),
        http.get(`${API_BASE}${endpoints.myPermissions}`, () =>
          HttpResponse.json({ permissions: ["purchase.po.read", "purchase.po.update", "purchase.po.create", "purchase.po.post"] }),
        ),
      );

      renderApp({ routes: testRoutes, initialEntries: [`${PURCHASE_LIST_PATH}/purchase-approved-locked`] });

      expect(await screen.findByText("Approved", {}, ASYNC)).toBeInTheDocument();
      expect(
        await screen.findByText(/Header, costs, and customer allocation are now locked/i, {}, ASYNC),
      ).toBeInTheDocument();

      await screen.findByText("Purchase Date", {}, ASYNC);
      await screen.findByText("Other Charges", {}, ASYNC);
      expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
      expect(await screen.findByRole("button", { name: "Add Item" }, ASYNC)).toBeInTheDocument();
    },
    30000,
  );
});

describe("Purchase - list view", () => {
  it(
    "shows Status and resolves Branch/Buyer/Supplier to names, and hides shipment/attachment columns",
    async () => {
      signIn();
      server.use(
        http.get(`${API_BASE}${endpoints.purchases}`, () =>
          HttpResponse.json({
            items: [
              {
                id: "list-row-1",
                purchaseNumber: "PO-LIST-1",
                purchaseDate: "2026-08-01",
                status: "approved",
                branchId: "33333333-3333-4333-8333-333333333333",
                // Buyer names a tenant company, not a user (client correction).
                buyerId: "22222222-2222-4222-8222-222222222222",
                supplierId: "sup-1",
                supplierInvoiceNo: "INV-1",
              },
            ],
            total: 1,
            page: 1,
            pageSize: 20,
          }),
        ),
      );

      renderApp({ routes: testRoutes, initialEntries: [PURCHASE_LIST_PATH] });

      expect(await screen.findByText("Dubai HQ", {}, ASYNC)).toBeInTheDocument();
      expect(await screen.findByText("Ikration Metals Trading", {}, ASYNC)).toBeInTheDocument();
      expect(await screen.findByText("Metal Traders LLC", {}, ASYNC)).toBeInTheDocument();
      expect(screen.getByText("Approved")).toBeInTheDocument();
      expect(screen.queryByText("33333333-3333-4333-8333-333333333333")).not.toBeInTheDocument();
      expect(screen.queryByRole("columnheader", { name: "Container Number" })).not.toBeInTheDocument();
      expect(screen.queryByRole("columnheader", { name: "Invoice" })).not.toBeInTheDocument();
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
        // LME Records only renders under pricing_type "lme" (Prompt 21 item
        // 2) - this test wants every section visible, section E included.
        http.get(`${API_BASE}${endpoints.purchases}/purchase-sections`, () =>
          HttpResponse.json({ ...draftFixture("purchase-sections"), pricingType: "lme" }),
        ),
      );

      renderApp({ routes: testRoutes, initialEntries: [`${PURCHASE_LIST_PATH}/purchase-sections`] });

      // A Header / B Supplier Details / C Shipment - one combined SchemaForm.
      expect(await screen.findByLabelText("Purchase Date", {}, ASYNC)).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "Supplier" })).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "Container Number" })).toBeInTheDocument();
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

describe("Purchase - sub-panel tables resolve master ids to names", () => {
  it(
    "shows Item/Grade/UOM, Reserved Customer, and Hedge Platform as names, not raw UUIDs",
    async () => {
      signIn();
      server.use(
        http.get(`${API_BASE}${endpoints.purchases}/purchase-resolved-ids`, () =>
          HttpResponse.json({
            ...draftFixture("purchase-resolved-ids"),
            items: [
              {
                id: "item-row-1",
                itemId: "items-1",
                gradeId: "item-grades-1",
                quantity: "5.000000",
                uomId: "uom-1",
                pricing: { purchaseRateUsd: "5.000000", purchaseAmountUsd: "25.00", purchaseAmountAed: "91.75" },
              },
            ],
            allocations: [{ id: "alloc-row-1", reservedCustomerId: "customers-1", allocationPct: "100.000000" }],
            hedges: [
              {
                id: "hedge-row-1",
                hedgePlatformId: "hedge-platforms-1",
                contractNumber: "HC-1",
                position: "buy",
                quantity: "5.000000",
                rate: "1.000000",
                status: "open",
              },
            ],
          }),
        ),
      );

      renderApp({ routes: testRoutes, initialEntries: [`${PURCHASE_LIST_PATH}/purchase-resolved-ids`] });

      expect(await screen.findByText("Items 1", {}, ASYNC)).toBeInTheDocument();
      expect(await screen.findByText("Item Grades 1", {}, ASYNC)).toBeInTheDocument();
      expect(await screen.findByText("Units of Measure 1", {}, ASYNC)).toBeInTheDocument();
      expect(await screen.findByText("Customers 1", {}, ASYNC)).toBeInTheDocument();
      expect(await screen.findByText("Hedge Platforms 1", {}, ASYNC)).toBeInTheDocument();
      expect(screen.queryByText("items-1")).not.toBeInTheDocument();
      expect(screen.queryByText("item-grades-1")).not.toBeInTheDocument();
      expect(screen.queryByText("uom-1")).not.toBeInTheDocument();
      expect(screen.queryByText("customers-1")).not.toBeInTheDocument();
      expect(screen.queryByText("hedge-platforms-1")).not.toBeInTheDocument();
    },
    30000,
  );
});

describe("Purchase - pricing type gates the LME section and item rate (Prompt 21 item 2)", () => {
  it(
    "under pricing_type 'lme', LME Records shows and the item form hides Purchase Rate (USD) with a note",
    async () => {
      signIn();
      const user = userEvent.setup();
      server.use(
        http.get(`${API_BASE}${endpoints.purchases}/purchase-lme-pricing`, () =>
          HttpResponse.json({ ...draftFixture("purchase-lme-pricing"), pricingType: "lme" }),
        ),
      );

      renderApp({ routes: testRoutes, initialEntries: [`${PURCHASE_LIST_PATH}/purchase-lme-pricing`] });

      expect(await screen.findByText("LME Records", {}, ASYNC)).toBeInTheDocument();

      await user.click(await screen.findByRole("button", { name: "Add Item" }, ASYNC));
      const itemDrawer = within(screen.getByRole("dialog"));
      await itemDrawer.findByLabelText("Quantity", {}, ASYNC);

      expect(itemDrawer.queryByLabelText("Purchase Rate (USD)")).not.toBeInTheDocument();
      expect(
        itemDrawer.getByText(/derived from the LME record's final rate/i),
      ).toBeInTheDocument();
    },
    30000,
  );

  it(
    "under pricing_type 'fixed', LME Records is hidden and the item form still shows a manual Purchase Rate (USD)",
    async () => {
      signIn();
      const user = userEvent.setup();
      server.use(
        http.get(`${API_BASE}${endpoints.purchases}/purchase-fixed-pricing`, () =>
          HttpResponse.json({ ...draftFixture("purchase-fixed-pricing"), pricingType: "fixed" }),
        ),
      );

      renderApp({ routes: testRoutes, initialEntries: [`${PURCHASE_LIST_PATH}/purchase-fixed-pricing`] });

      await screen.findByText("Purchase Items & Pricing", {}, ASYNC);
      expect(screen.queryByText("LME Records")).not.toBeInTheDocument();

      await user.click(await screen.findByRole("button", { name: "Add Item" }, ASYNC));
      const itemDrawer = within(screen.getByRole("dialog"));

      expect(await itemDrawer.findByLabelText("Purchase Rate (USD)", {}, ASYNC)).toBeInTheDocument();
    },
    30000,
  );
});

describe("Purchase - customer allocation is a soft reservation, never blocked (Prompt 21 item 6)", () => {
  it(
    "shows a non-blocking running total even when allocations sum past 100%",
    async () => {
      signIn();
      server.use(
        http.get(`${API_BASE}${endpoints.purchases}/purchase-over-allocated`, () =>
          HttpResponse.json({
            ...draftFixture("purchase-over-allocated"),
            allocations: [
              { id: "alloc-a", reservedCustomerId: "customers-1", allocationPct: "70.000000" },
              { id: "alloc-b", reservedCustomerId: "customers-2", allocationPct: "60.000000" },
            ],
          }),
        ),
      );

      renderApp({ routes: testRoutes, initialEntries: [`${PURCHASE_LIST_PATH}/purchase-over-allocated`] });

      expect(await screen.findByText(/Allocated: 130%/, {}, ASYNC)).toBeInTheDocument();
      // Purely informational - Add stays enabled, nothing in the UI blocks it.
      expect(screen.getByRole("button", { name: "Add" })).toBeEnabled();
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

  it(
    "hydrates existing attachments from a previous session on reopening a purchase",
    async () => {
      signIn();
      const purchaseId = "66666666-6666-4666-8666-666666666666";
      server.use(
        http.get(`${API_BASE}${endpoints.purchases}/${purchaseId}`, () => HttpResponse.json(draftFixture(purchaseId))),
        http.get(`${API_BASE}${endpoints.attachments}`, ({ request }) => {
          const url = new URL(request.url);
          if (url.searchParams.get("entity") !== "purchase" || url.searchParams.get("entityId") !== purchaseId) {
            return HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 1 });
          }
          const row = (id: string, fieldKey: string, filename: string) => ({
            id,
            companyId: "22222222-2222-4222-8222-222222222222",
            entity: "purchase",
            entityId: purchaseId,
            fieldKey,
            filename,
            contentType: "application/pdf",
            size: 9,
            storageKey: `mock/purchase/${purchaseId}/${fieldKey}/${filename}`,
            checksum: "mock-checksum",
            scannedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            createdBy: "11111111-1111-4111-8111-111111111111",
          });
          return HttpResponse.json({
            items: [
              row("77777777-7777-4777-8777-777777777777", "invoice", "prior-session-invoice.pdf"),
              row("88888888-8888-4888-8888-888888888888", "otherDocuments", "extra-doc-1.pdf"),
              row("99999999-9999-4999-8999-999999999999", "otherDocuments", "extra-doc-2.pdf"),
            ],
            total: 3,
            page: 1,
            pageSize: 3,
          });
        }),
      );

      renderApp({ routes: testRoutes, initialEntries: [`${PURCHASE_LIST_PATH}/${purchaseId}`] });

      expect(await screen.findByText("prior-session-invoice.pdf", {}, ASYNC)).toBeInTheDocument();
      expect(await screen.findByText("extra-doc-1.pdf", {}, ASYNC)).toBeInTheDocument();
      expect(await screen.findByText("extra-doc-2.pdf", {}, ASYNC)).toBeInTheDocument();
    },
    30000,
  );
});
