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
import { PurchasePaymentsListScreen, PURCHASE_PAYMENTS_LIST_PATH } from "./PurchasePaymentsListScreen";

// 30s (not 20s) - PL-5's own test runs a second full screen navigation
// (Payments Made) with its own supplier-options/outstanding-bills queries
// on top of everything PL-4's lifecycle test already does, and under
// full-file CPU contention (many heavy AntD trees mounting sequentially in
// one worker) 20s was occasionally too tight for that combination.
const ASYNC = { timeout: 30000 };
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
  { path: PURCHASE_PAYMENTS_LIST_PATH, element: <PurchasePaymentsListScreen /> },
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

/** A closed AntD Drawer with destroyOnHidden can still be mid-closing-animation (role="dialog" still in the DOM) when the NEXT drawer opens - getByRole("dialog") then finds two. The most-recently-opened one is always last in DOM order (portals append). Returns the raw element - wrap with within(...) at the call site, same as every other drawer lookup in this file, so its bound-queries type is inferred locally rather than through a custom wrapper's own return-type annotation. */
function latestDialogElement(): HTMLElement {
  const dialogs = screen.getAllByRole("dialog");
  const dialog = dialogs.at(-1);
  if (!dialog) {
    throw new Error("expected at least one open dialog");
  }
  return dialog;
}

/** Customer Allocation and LME Records both render a Card with a plain "Add" button (PurchaseSubResourceList) - scoping to the Card containing this title is what disambiguates the two when both are on the page at once (pricing_type "lme"). Async: the card itself may not have mounted yet (still loading the parent purchase). Returns the raw element, same reasoning as latestDialogElement above. */
async function findCardElement(title: string): Promise<HTMLElement> {
  const heading = await screen.findByText(title, {}, ASYNC);
  const card = heading.closest(".ant-card");
  if (!card) {
    throw new Error(`expected a ".ant-card" ancestor of "${title}"`);
  }
  return card as HTMLElement;
}

/** Prompt 21 item 5: containerId is a Lookup field with allowCreate - typing a number nothing matches offers a "+ Add" option that POSTs to /masters/containers, then selects the newly-created row. */
async function createContainerInline(user: ReturnType<typeof userEvent.setup>, containerNumber: string): Promise<void> {
  const combobox = await screen.findByRole("combobox", { name: "Container Number" }, ASYNC);
  await user.click(combobox);
  await user.type(combobox, containerNumber);
  await user.click(await screen.findByText(`+ Add "${containerNumber}"`, {}, ASYNC));
}

/** Buyer is a Lookup field with allowCreate whose target (companies) is NOT a generic master - this proves LookupField routes its create POST to /companies with a minimal payload instead of the generic /masters/companies + {code,name}. */
async function createBuyerInline(user: ReturnType<typeof userEvent.setup>, buyerName: string): Promise<void> {
  const combobox = await screen.findByRole("combobox", { name: "Buyer" }, ASYNC);
  await user.click(combobox);
  await user.type(combobox, buyerName);
  await user.click(await screen.findByText(`+ Add "${buyerName}"`, {}, ASYNC));
}

// containerNumber must be unique per call: the mock containers list is
// module-scoped and persists across tests within this file (only MSW
// handler overrides get reset between tests, not the underlying mock
// data), so a second call reusing an already-created number wouldn't see
// a "+ Add" prompt and the field would stay unset.
async function fillHeaderAndShipment(
  user: ReturnType<typeof userEvent.setup>,
  containerNumber = "CONT-1",
  pricingType: "Fixed Price Purchase" | "LME Purchase" = "Fixed Price Purchase",
): Promise<void> {
  await user.type(await screen.findByLabelText("Purchase Date", {}, ASYNC), "2026-08-01{Enter}");

  await selectOption(user, "Division", "Divisions 1");
  await selectOption(user, "Branch", "Dubai HQ");
  // Buyer names a tenant company, not a user (client correction).
  await selectOption(user, "Buyer", "Ikration Metals Trading");
  await selectOption(user, "Supplier", "Metal Traders LLC");
  await selectOption(user, "Pricing Type", pricingType);

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

describe("Purchase - Buyer quick-add", () => {
  it(
    "creating a new Buyer inline adds a company and selects it without leaving the form",
    async () => {
      signIn();
      const user = userEvent.setup();
      renderApp({ routes: testRoutes, initialEntries: [`${PURCHASE_LIST_PATH}/new`] });

      await screen.findByLabelText("Purchase Date", {}, ASYNC);
      await createBuyerInline(user, "Acme Holdings Ltd");

      // A closed AntD Select keeps its dropdown option list in the DOM
      // (display:none, not unmounted - see selectOption's own comment
      // above), so once the new Buyer is selected "Acme Holdings Ltd"
      // matches BOTH the visible selected-item span and that stale hidden
      // copy - findAllByText + last match, not findByText, same reasoning
      // as selectOption.
      const matches = await screen.findAllByText("Acme Holdings Ltd", {}, ASYNC);
      expect(matches.at(-1)).toBeInTheDocument();
    },
    ASYNC.timeout,
  );
});

describe("Purchase - Supplier quick-add (rich entity, opens the real create form)", () => {
  it(
    "creating a new Supplier inline opens its real create form and selects it once saved",
    async () => {
      signIn();
      const user = userEvent.setup();
      renderApp({ routes: testRoutes, initialEntries: [`${PURCHASE_LIST_PATH}/new`] });

      await screen.findByLabelText("Purchase Date", {}, ASYNC);

      // Supplier needs more than a name (supplierTypeId/countryId/
      // paymentTermId/currencyId are all mandatory on createSupplierSchema),
      // so "+ Add" must open Supplier's own real create form (SchemaForm,
      // module="suppliers" entity="supplier") in a modal instead of the
      // single-text-box path Buyer/Container use.
      const combobox = await screen.findByRole("combobox", { name: "Supplier" }, ASYNC);
      await user.click(combobox);
      await user.type(combobox, "Acme Metals Co");
      await user.click(await screen.findByText('+ Add "Acme Metals Co"', {}, ASYNC));

      const dialog = within(await screen.findByRole("dialog", {}, ASYNC));
      // The typed search text pre-fills the modal's own Name field - the
      // user isn't asked to retype what they already typed.
      expect(await dialog.findByDisplayValue("Acme Metals Co", {}, ASYNC)).toBeInTheDocument();

      await user.click(dialog.getByRole("combobox", { name: "Supplier Type" }));
      await user.click((await screen.findAllByText("Supplier Types 1", {}, ASYNC)).at(-1) ?? screen.getByText("Supplier Types 1"));

      await user.click(dialog.getByRole("combobox", { name: "Country" }));
      await user.click(
        (await screen.findAllByText("United Arab Emirates", {}, ASYNC)).at(-1) ?? screen.getByText("United Arab Emirates"),
      );

      await user.click(dialog.getByRole("combobox", { name: "Payment Terms" }));
      await user.click((await screen.findAllByText("Payment Terms 1", {}, ASYNC)).at(-1) ?? screen.getByText("Payment Terms 1"));

      await user.click(dialog.getByRole("combobox", { name: "Default Currency" }));
      await user.click((await screen.findAllByText("UAE Dirham", {}, ASYNC)).at(-1) ?? screen.getByText("UAE Dirham"));

      await user.click(dialog.getByRole("button", { name: "Save" }));

      // The modal closes on success (LookupCreateModal has no error state
      // to get stuck on here - all four mandatory fields were filled).
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), ASYNC);

      // The newly created supplier becomes the Purchase form's selected
      // Supplier - same "select the freshly-created row" contract as
      // Buyer/Container's own quick-add.
      const matches = await screen.findAllByText("Acme Metals Co", {}, ASYNC);
      expect(matches.at(-1)).toBeInTheDocument();
    },
    ASYNC.timeout,
  );
});

describe("Purchase - create, items, and workflow", () => {
  it(
    "creates a purchase, adds an item with server-computed pricing, then Issue -> Cancel makes it read-only",
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

      // Workflow: Draft -> Issued -> Cancelled (PL-3: Closed is derived/
      // automatic - reaching it would need a mocked receipt+bill, out of
      // scope here; Cancelled is the terminal state this test can reach
      // directly, and proves the same immutability rule 8 requires).
      await user.click(await screen.findByRole("button", { name: "Issue" }, ASYNC));
      expect(await screen.findByText("Issued", {}, ASYNC)).toBeInTheDocument();

      await user.click(await screen.findByRole("button", { name: "Cancel" }, ASYNC));
      // AntD Popconfirm's default confirm button text is "OK", not "Yes".
      await user.click(await screen.findByRole("button", { name: "Cancel PO" }, ASYNC));
      expect(await screen.findByText("Cancelled", {}, ASYNC)).toBeInTheDocument();

      // Rule 8: a terminal state is immutable, visible in the UI, not just the API.
      expect(
        await screen.findByText(/cancelled before it was fulfilled/i, {}, ASYNC),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add Item" })).not.toBeInTheDocument();
    },
    60000,
  );
});

describe("Purchase - the Bill moves stock, not PO issuance (PL-1/PL-2)", () => {
  it(
    "issuing the PO shows no invoice yet; creating and approving a bill flips its own status independently",
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

      // Section always visible, empty until a bill actually exists.
      expect(await screen.findByText("Bills", {}, ASYNC)).toBeInTheDocument();
      expect(screen.getByText(/no bills yet/i)).toBeInTheDocument();

      await user.click(await screen.findByRole("button", { name: "Issue" }, ASYNC));
      expect(await screen.findByText("Order Placed", {}, ASYNC)).toBeInTheDocument();
      // Issuing the PO alone never creates or touches a bill.
      expect(screen.getByText(/no bills yet/i)).toBeInTheDocument();

      // PL-4: bills are created from the PO's own "Convert to Bill" action,
      // prefilled with each item's un-billed quantity - not a blank form.
      // Saving is a single action that both creates AND approves the bill
      // (PurchaseBillForm), not a separate create-then-approve pair - there
      // is no "save as draft" step in this flow.
      await user.click(await screen.findByRole("button", { name: "Convert to Bill" }, ASYNC));
      const billDrawer = within(screen.getByRole("dialog"));
      await billDrawer.findByText("Outstanding", {}, ASYNC);
      // No {Enter} here: unlike the header/shipment form, Invoice Date is
      // the ONLY mandatory field on this form, so an Enter-triggered
      // native submit would actually pass validation and fire early,
      // closing the drawer before the explicit Save click below runs.
      await user.type(billDrawer.getByLabelText("Invoice Date"), "2026-08-05");
      await user.type(billDrawer.getByLabelText("Invoice Amount (USD)"), "50000");
      await user.click(billDrawer.getByRole("button", { name: "Save" }));

      expect(await screen.findByText(/^BILL-2024-/, {}, ASYNC)).toBeInTheDocument();

      // The bill's own status tag - the PO's own tag still says "Issued"
      // (via "Order Placed" in the fulfilment strip), never "Approved"
      // (PL-3: that verb belongs to the bill alone now).
      await waitFor(() => expect(screen.getAllByText("Approved").length).toBeGreaterThanOrEqual(1), ASYNC);
      expect(screen.getByText("Order Placed")).toBeInTheDocument();
    },
    60000,
  );
});

describe("Purchase - PL-4 fulfilment lifecycle (Receive/Convert to Bill drive the fulfilment strip)", () => {
  it(
    "Receive creates a partial receipt and moves the strip to Partially Received; a second full receive plus a full bill closes the PO",
    async () => {
      signIn();
      const user = userEvent.setup();
      const { router } = renderApp({ routes: testRoutes, initialEntries: [`${PURCHASE_LIST_PATH}/new`] });

      await fillHeaderAndShipment(user, "CONT-P4LIFECYCLE");
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

      await user.click(await screen.findByRole("button", { name: "Issue" }, ASYNC));
      expect(await screen.findByText("Order Placed", {}, ASYNC)).toBeInTheDocument();
      expect(screen.getByText("Not Received")).toBeInTheDocument();

      // Partial receive: cut the prefilled outstanding qty (500) down to 200.
      await user.click(await screen.findByRole("button", { name: "Receive" }, ASYNC));
      const receiveDrawer = within(latestDialogElement());
      const receiveQtyInput = await receiveDrawer.findByRole("textbox", { name: /Quantity for item/ }, ASYNC);
      await user.clear(receiveQtyInput);
      await user.type(receiveQtyInput, "200");
      await user.type(receiveDrawer.getByLabelText("Receipt Date"), "2026-08-10{Enter}");
      await selectOption(user, "Warehouse", "Jebel Ali Warehouse");
      await user.click(receiveDrawer.getByRole("button", { name: "Save" }));

      // Stock moved and the strip reflects a partial receive - not fully
      // done yet, so the Receive action stays available for the remainder.
      await waitFor(() => expect(screen.getByText("Partially Received")).toBeInTheDocument(), ASYNC);
      expect(await screen.findByRole("button", { name: "Receive" }, ASYNC)).toBeInTheDocument();

      // Receive the remaining 300 - now fully received, Receive disappears.
      await user.click(screen.getByRole("button", { name: "Receive" }));
      const secondReceiveDrawer = within(latestDialogElement());
      await secondReceiveDrawer.findByText("Outstanding", {}, ASYNC);
      await user.type(secondReceiveDrawer.getByLabelText("Receipt Date"), "2026-08-11{Enter}");
      await selectOption(user, "Warehouse", "Jebel Ali Warehouse");
      await user.click(secondReceiveDrawer.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(screen.getByText("Received")).toBeInTheDocument(), ASYNC);
      expect(screen.queryByRole("button", { name: "Receive" })).not.toBeInTheDocument();

      // Fully bill the same 500 in one shot - both axes now fully done, so
      // the PO auto-closes (no manual "Close" action exists anywhere).
      await user.click(screen.getByRole("button", { name: "Convert to Bill" }));
      const billDrawer = within(latestDialogElement());
      await billDrawer.findByText("Outstanding", {}, ASYNC);
      await user.type(billDrawer.getByLabelText("Invoice Date"), "2026-08-12{Enter}");
      await user.type(billDrawer.getByLabelText("Invoice Amount (USD)"), "50000");
      await user.click(billDrawer.getByRole("button", { name: "Save" }));

      expect(await screen.findByText("Billed", {}, ASYNC)).toBeInTheDocument();
      // "Closed" is now the PO's own status tag - the terminal, immutable
      // state (rule 8), reached automatically with no Close button anywhere.
      await waitFor(() => expect(screen.getByText("Closed")).toBeInTheDocument(), ASYNC);
      expect(screen.queryByRole("button", { name: "Convert to Bill" })).not.toBeInTheDocument();
    },
    60000,
  );
});

describe("Purchase - PL-5 Payment (records against a bill, drives the fulfilment strip's Pay step)", () => {
  it(
    "recording a payment for the bill's full amount moves the bill to Paid and the PO's own Pay step to Fully Paid",
    async () => {
      signIn();
      const user = userEvent.setup();
      const { router } = renderApp({ routes: testRoutes, initialEntries: [`${PURCHASE_LIST_PATH}/new`] });

      await fillHeaderAndShipment(user, "CONT-P5PAYMENT");
      await user.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(router.state.location.pathname).not.toBe(`${PURCHASE_LIST_PATH}/new`), ASYNC);

      // Every other test in this file bills the SAME mock supplier, and the
      // mock's in-memory `purchases` array (purchase-handlers.ts) is never
      // reset between tests in the same file - so by the time this test's
      // own payment drawer opens, outstandingBillsForSupplier can return
      // several other tests' own outstanding bills too. Capture this test's
      // own PO number now (the header's "Purchase PO-000N") to disambiguate
      // its own row from theirs, rather than assuming it's the only one.
      const purchaseNumber = (await screen.findByRole("heading", { level: 4, name: /^Purchase PO-/ }, ASYNC)).textContent?.replace(
        "Purchase ",
        "",
      );
      if (!purchaseNumber) {
        throw new Error("expected the page heading to resolve to \"Purchase PO-...\" after Save");
      }

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

      await user.click(await screen.findByRole("button", { name: "Issue" }, ASYNC));
      expect(await screen.findByText("Order Placed", {}, ASYNC)).toBeInTheDocument();
      expect(screen.getByText("Not Paid")).toBeInTheDocument();

      await user.click(await screen.findByRole("button", { name: "Convert to Bill" }, ASYNC));
      const billDrawer = within(latestDialogElement());
      await billDrawer.findByText("Outstanding", {}, ASYNC);
      await user.type(billDrawer.getByLabelText("Invoice Date"), "2026-08-12{Enter}");
      await user.type(billDrawer.getByLabelText("Invoice Amount (USD)"), "50000");
      await user.click(billDrawer.getByRole("button", { name: "Save" }));

      expect(await screen.findByText("Billed", {}, ASYNC)).toBeInTheDocument();
      // Billing alone never touches the Pay axis.
      expect(screen.getByText("Not Paid")).toBeInTheDocument();

      // The Bill drawer's own destroyOnHidden animation can still be
      // mid-close here (same "lingering role=dialog portal" class of issue
      // latestDialogElement's own doc comment describes) - wait for it to
      // fully leave the DOM before navigating away, so its own portal
      // content doesn't linger into the next screen's queries.
      await waitFor(() => expect(screen.queryAllByRole("dialog")).toHaveLength(0), ASYNC);

      // Payment is its own standalone screen (Zoho's own "Payments Made"),
      // not reachable from the PO detail screen - navigate the SAME router
      // there directly (real in-app navigation, not a second render tree -
      // mounting a second RouterProvider/QueryClientProvider on top of the
      // first left stale state behind even after unmounting the first).
      await router.navigate(PURCHASE_PAYMENTS_LIST_PATH);

      await screen.findByText("Payments Made", {}, ASYNC);
      const newButtonText = await screen.findByText("New", {}, ASYNC);
      const newButton = newButtonText.closest("button");
      if (!newButton) {
        throw new Error('expected a <button> ancestor of the "New" text');
      }
      await user.click(newButton);
      const paymentDrawer = within(latestDialogElement());
      await user.click(paymentDrawer.getByRole("combobox", { name: /Supplier/ }));
      await user.click((await screen.findAllByText("Metal Traders LLC", {}, ASYNC)).at(-1) ?? screen.getByText("Metal Traders LLC"));

      // Wait for the outstanding-bills table to actually load THIS test's
      // own row, not just its own column headers (which render immediately
      // once the <Table> mounts, before the outstanding-bills query has
      // resolved). Every other test in this file bills the same mock
      // supplier and none of their bills are ever cleared between tests, so
      // this test's own PO number (captured above) is what disambiguates
      // its row from theirs - a bare "some BILL-2024-* text exists" check
      // is ambiguous once more than one test has run.
      const ownRow = (await paymentDrawer.findByText(purchaseNumber, {}, ASYNC)).closest("tr");
      if (!ownRow) {
        throw new Error(`expected a <tr> ancestor of the outstanding-bills row for ${purchaseNumber}`);
      }
      const amountInput = within(ownRow).getByRole("textbox", { name: /Amount to pay for bill/ });
      await user.type(amountInput, "50000");
      await user.type(paymentDrawer.getByLabelText("Payment Date"), "2026-08-15{Enter}");
      await user.click(paymentDrawer.getByRole("combobox", { name: "Payment Mode" }));
      await user.click((await screen.findAllByText("Bank Transfer", {}, ASYNC)).at(-1) ?? screen.getByText("Bank Transfer"));
      await user.click(paymentDrawer.getByRole("button", { name: "Save" }));

      expect(await screen.findByText(/^PAY-2024-/, {}, ASYNC)).toBeInTheDocument();
    },
    // Longer than this file's other tests' 60000ms - this one does
    // everything the PL-4 fulfilment lifecycle test does (create, item,
    // issue, bill) PLUS a full second-screen navigation (Payments Made)
    // and its own supplier-options/outstanding-bills queries on top.
    90000,
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
    "hides Issue without purchase.po.issue, and hides Cancel without purchase.po.cancel",
    async () => {
      signIn();
      server.use(
        http.get(`${API_BASE}${endpoints.purchases}/purchase-no-issue`, () =>
          HttpResponse.json(draftFixture("purchase-no-issue")),
        ),
        http.get(`${API_BASE}${endpoints.myPermissions}`, () =>
          HttpResponse.json({
            permissions: ["purchase.po.read", "purchase.po.update"],
          }),
        ),
      );

      renderApp({ routes: testRoutes, initialEntries: [`${PURCHASE_LIST_PATH}/purchase-no-issue`] });

      expect(await screen.findByText("Draft", {}, ASYNC)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Issue" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    },
    30000,
  );

  it(
    // The "enabled once it has an item" side of this is already exercised
    // by this file's main create-add item-Issue flow test above - that
    // one only reaches a clickable Issue because the button isn't
    // disabled once an item exists.
    "disables Issue, with a tooltip explaining why, on a draft with zero items - a UX nicety, never the actual guard (core/workflow/guards.ts enforces it server-side regardless of what the frontend does)",
    async () => {
      signIn();
      const user = userEvent.setup();
      server.use(
        http.get(`${API_BASE}${endpoints.purchases}/purchase-no-items`, () => HttpResponse.json(draftFixture("purchase-no-items"))),
      );

      renderApp({ routes: testRoutes, initialEntries: [`${PURCHASE_LIST_PATH}/purchase-no-items`] });

      const issueButton = await screen.findByRole("button", { name: "Issue" }, ASYNC);
      expect(issueButton).toBeDisabled();

      await user.hover(issueButton);
      expect(await screen.findByText("Add at least one item before issuing", {}, ASYNC)).toBeInTheDocument();
    },
    30000,
  );

  it(
    "hides Cancel on an issued purchase without purchase.po.cancel",
    async () => {
      signIn();
      server.use(
        http.get(`${API_BASE}${endpoints.purchases}/purchase-no-cancel`, () =>
          HttpResponse.json({ ...draftFixture("purchase-no-cancel"), status: "issued" }),
        ),
        http.get(`${API_BASE}${endpoints.myPermissions}`, () =>
          HttpResponse.json({
            permissions: ["purchase.po.read", "purchase.po.update", "purchase.po.issue"],
          }),
        ),
      );

      renderApp({ routes: testRoutes, initialEntries: [`${PURCHASE_LIST_PATH}/purchase-no-cancel`] });

      expect(await screen.findByText("Issued", {}, ASYNC)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    },
    30000,
  );

  it(
    "hides the header form's Save button (and Additional Cost's) for a Viewer missing purchase.po.update, on a draft or issued purchase",
    async () => {
      signIn();
      server.use(
        http.get(`${API_BASE}${endpoints.purchases}/purchase-viewer`, () =>
          HttpResponse.json({ ...draftFixture("purchase-viewer"), status: "issued" }),
        ),
        http.get(`${API_BASE}${endpoints.myPermissions}`, () => HttpResponse.json({ permissions: ["purchase.po.read"] })),
      );

      renderApp({ routes: testRoutes, initialEntries: [`${PURCHASE_LIST_PATH}/purchase-viewer`] });

      expect(await screen.findByText("Issued", {}, ASYNC)).toBeInTheDocument();
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
    // PL-3: items are the deliberate exception now - they stay editable
    // through Issued (assertItemsEditable blocks only Closed/Cancelled),
    // unlike Header/Costs, which lock the moment the purchase leaves Draft.
    "hides Header/Costs Save buttons on an issued purchase even WITH purchase.po.update, but Add Item stays available",
    async () => {
      signIn();
      server.use(
        http.get(`${API_BASE}${endpoints.purchases}/purchase-issued-locked`, () =>
          HttpResponse.json({ ...draftFixture("purchase-issued-locked"), status: "issued" }),
        ),
        http.get(`${API_BASE}${endpoints.myPermissions}`, () =>
          HttpResponse.json({ permissions: ["purchase.po.read", "purchase.po.update", "purchase.po.create", "purchase.po.cancel"] }),
        ),
      );

      renderApp({ routes: testRoutes, initialEntries: [`${PURCHASE_LIST_PATH}/purchase-issued-locked`] });

      expect(await screen.findByText("Issued", {}, ASYNC)).toBeInTheDocument();
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
                status: "issued",
                branchId: "33333333-3333-4333-8333-333333333333",
                // Buyer names a tenant company, not a user (client correction).
                buyerId: "22222222-2222-4222-8222-222222222222",
                supplierId: "sup-1",
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
      // "Issued" appears twice on this screen now (the status stat-chip
      // label above the table, and the row's own status tag) - assert
      // there are at least two rather than a single unique match.
      expect(screen.getAllByText("Issued").length).toBeGreaterThanOrEqual(2);
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
      expect(screen.getByLabelText("Bill of Lading")).toBeInTheDocument();
      expect(screen.getByLabelText("Other Documents")).toBeInTheDocument();
      // D Item / E Pricing, F Allocation, G Additional Cost, LME + Hedging -
      // rendered as their own panels once the record exists (create mode
      // gates them the same way Draft/Issued status gates the Issue/Cancel buttons).
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
    "drives a real upload through the Bill of Lading field and clears the uploading state",
    async () => {
      signIn();
      const user = userEvent.setup();
      const purchaseId = "55555555-5555-4555-8555-555555555555";
      server.use(
        http.get(`${API_BASE}${endpoints.purchases}/${purchaseId}`, () => HttpResponse.json(draftFixture(purchaseId))),
      );

      renderApp({ routes: testRoutes, initialEntries: [`${PURCHASE_LIST_PATH}/${purchaseId}`] });

      const input = await screen.findByLabelText("Bill of Lading", {}, ASYNC);
      const file = new File(["%PDF-1.4"], "bill-of-lading.pdf", { type: "application/pdf" });
      await user.upload(input, file);

      // rc-upload manages its hidden <input type="file"> imperatively and
      // can recreate it around the upload lifecycle, so anchor on the
      // FieldShell's <label> (a stable, React-managed node) instead of the
      // input itself to find the surrounding Form.Item.
      const formItem = screen.getByText("Bill of Lading").closest(".ant-form-item");
      if (!(formItem instanceof HTMLElement)) {
        throw new Error("expected the Bill of Lading field's Form.Item wrapper");
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
              row("77777777-7777-4777-8777-777777777777", "billOfLading", "prior-session-bill-of-lading.pdf"),
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

      expect(await screen.findByText("prior-session-bill-of-lading.pdf", {}, ASYNC)).toBeInTheDocument();
      expect(await screen.findByText("extra-doc-1.pdf", {}, ASYNC)).toBeInTheDocument();
      expect(await screen.findByText("extra-doc-2.pdf", {}, ASYNC)).toBeInTheDocument();
    },
    30000,
  );
});

describe("Purchase - LME Records and Customer Allocation edit/remove (Prompt 23)", () => {
  it(
    "an LME record locks once an item has used it; an unused record and an allocation stay fully editable",
    async () => {
      signIn();
      const user = userEvent.setup();
      const { router } = renderApp({ routes: testRoutes, initialEntries: [`${PURCHASE_LIST_PATH}/new`] });

      await fillHeaderAndShipment(user, "CONT-P23", "LME Purchase");
      await user.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(router.state.location.pathname).not.toBe(`${PURCHASE_LIST_PATH}/new`), ASYNC);

      // First LME record.
      await user.click(await within(await findCardElement("LME Records")).findByRole("button", { name: "Add" }, ASYNC));
      let drawer = within(latestDialogElement());
      await selectOption(user, "LME Exchange", "LME Exchanges 1");
      await user.type(drawer.getByLabelText("Metal"), "Copper");
      await selectOption(user, "LME Type", "Open");
      await user.type(drawer.getByLabelText("LME Purchase Price (USD)"), "100");
      await user.type(drawer.getByLabelText("LME Fixing Date"), "2026-08-01{Enter}");
      await user.type(drawer.getByLabelText("Agreed %"), "98");
      await user.click(drawer.getByRole("button", { name: "Save" }));

      // 100 x (98/100) = 98, the client's own example.
      expect(await screen.findByText("98.000000", {}, ASYNC)).toBeInTheDocument();
      expect(await within(await findCardElement("LME Records")).findByRole("button", { name: "Edit" }, ASYNC)).toBeEnabled();

      // Add an item - it snapshots this (only) LME record's final rate.
      await user.click(await screen.findByRole("button", { name: "Add Item" }, ASYNC));
      const itemDrawer = within(latestDialogElement());
      await user.click(itemDrawer.getByRole("combobox", { name: "Item" }));
      await user.click((await screen.findAllByText("Items 1", {}, ASYNC)).at(-1) ?? screen.getByText("Items 1"));
      await user.type(itemDrawer.getByLabelText("Quantity"), "10");
      await user.click(itemDrawer.getByRole("combobox", { name: "Unit of Measure" }));
      await user.click((await screen.findAllByText("Units of Measure 1", {}, ASYNC)).at(-1) ?? screen.getByText("Units of Measure 1"));
      await user.type(itemDrawer.getByLabelText("Exchange Rate"), "3.6725");
      await user.click(itemDrawer.getByRole("button", { name: "Save" }));
      await screen.findByText("Purchase Items & Pricing", {}, ASYNC);

      // Now used - the first record's Edit/Remove lock.
      await waitFor(async () => expect(within(await findCardElement("LME Records")).getAllByRole("button", { name: "Edit" }).at(0)).toBeDisabled(), ASYNC);
      expect(within(await findCardElement("LME Records")).getAllByRole("button", { name: "Remove" }).at(0)).toBeDisabled();

      // A second, still-unused record stays fully editable.
      await user.click(within(await findCardElement("LME Records")).getByRole("button", { name: "Add" }));
      drawer = within(latestDialogElement());
      await selectOption(user, "LME Exchange", "LME Exchanges 1");
      await user.type(drawer.getByLabelText("Metal"), "Copper");
      await selectOption(user, "LME Type", "Close");
      await user.type(drawer.getByLabelText("LME Purchase Price (USD)"), "200");
      await user.type(drawer.getByLabelText("LME Fixing Date"), "2026-08-02{Enter}");
      await user.type(drawer.getByLabelText("Agreed %"), "104");
      await user.click(drawer.getByRole("button", { name: "Save" }));

      const editButtons = await within(await findCardElement("LME Records")).findAllByRole("button", { name: "Edit" }, ASYNC);
      expect(editButtons.at(-1)).toBeEnabled();
      await user.click(editButtons.at(-1) as HTMLElement);
      await screen.findByText("Edit LME Records", {}, ASYNC);
      const editDrawer = within(latestDialogElement());
      await user.clear(editDrawer.getByLabelText("Agreed %"));
      await user.type(editDrawer.getByLabelText("Agreed %"), "110");
      await user.click(editDrawer.getByRole("button", { name: "Save" }));

      // 200 x (110/100) = 220, exactly.
      expect(await screen.findByText("220.000000", {}, ASYNC)).toBeInTheDocument();

      // Customer Allocation: add, edit, then remove.
      await user.click(await within(await findCardElement("Customer Allocation")).findByRole("button", { name: "Add" }, ASYNC));
      const allocationDrawer = within(latestDialogElement());
      await user.click(allocationDrawer.getByRole("combobox", { name: "Reserved Customer" }));
      await user.click((await screen.findAllByText("Customers 1", {}, ASYNC)).at(-1) ?? screen.getByText("Customers 1"));
      await user.type(allocationDrawer.getByLabelText("Allocation %"), "60");
      await user.click(allocationDrawer.getByRole("button", { name: "Save" }));

      // The mock's create/update handlers for allocations echo back the raw
      // typed string (no server-side rounding, unlike the real backend's
      // roundRate) - "60", not "60.000000".
      expect(await within(await findCardElement("Customer Allocation")).findByText("60", {}, ASYNC)).toBeInTheDocument();

      await user.click(within(await findCardElement("Customer Allocation")).getByRole("button", { name: "Edit" }));
      // The just-submitted "Add" drawer can still be mid-closing-animation
      // (role="dialog" still in the DOM) at this exact instant - wait for
      // this specific drawer's own title before grabbing it, rather than
      // racing latestDialogElement() against that close.
      await screen.findByText("Edit Customer Allocation", {}, ASYNC);
      const allocationEditDrawer = within(latestDialogElement());
      await user.clear(allocationEditDrawer.getByLabelText("Allocation %"));
      await user.type(allocationEditDrawer.getByLabelText("Allocation %"), "75");
      await user.click(allocationEditDrawer.getByRole("button", { name: "Save" }));
      expect(await within(await findCardElement("Customer Allocation")).findByText("75", {}, ASYNC)).toBeInTheDocument();

      await user.click(within(await findCardElement("Customer Allocation")).getByRole("button", { name: "Remove" }));
      // AntD Popconfirm's default confirm button text is "OK", not "Yes".
      await user.click(await screen.findByRole("button", { name: "OK" }, ASYNC));
      await waitFor(async () => expect(within(await findCardElement("Customer Allocation")).getByText(/none added yet/i)).toBeInTheDocument(), ASYNC);
    },
    120000,
  );
});
