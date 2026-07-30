import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { renderApp } from "../../test/render-app";
import { useAppStore } from "../../core/store/app-store";
import { server } from "../../mocks/server";
import { endpoints } from "../../core/api/endpoints";

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

const ITEM_ID = "33333333-3333-4333-8333-333333333333";
const WAREHOUSE_ID = "44444444-4444-4444-8444-444444444444";

function mockMasterOptions(): void {
  server.use(
    http.get(`${API_BASE}${endpoints.masterOptions("items")}`, () =>
      HttpResponse.json({ options: [{ value: ITEM_ID, label: "Copper Cathode" }] }),
    ),
    http.get(`${API_BASE}${endpoints.masterOptions("warehouses")}`, () =>
      HttpResponse.json({ options: [{ value: WAREHOUSE_ID, label: "Jebel Ali Warehouse" }] }),
    ),
    http.get(`${API_BASE}${endpoints.masterOptions("item-grades")}`, () => HttpResponse.json({ options: [] })),
    http.get(`${API_BASE}${endpoints.masterOptions("uom")}`, () =>
      HttpResponse.json({ options: [{ value: "uom-1", label: "Metric Ton" }] }),
    ),
  );
}

function mockBalances(): void {
  server.use(
    http.get(`${API_BASE}${endpoints.inventoryBalances}`, () =>
      HttpResponse.json({
        items: [{ itemId: ITEM_ID, gradeId: null, warehouseId: WAREHOUSE_ID, quantity: "150.000000", uomId: "uom-1" }],
        total: 1,
        page: 1,
        pageSize: 20,
      }),
    ),
  );
}

function mockMovementsForBalance(): void {
  server.use(
    http.get(`${API_BASE}${endpoints.inventoryMovementsForBalance(ITEM_ID, WAREHOUSE_ID)}`, () =>
      HttpResponse.json({
        items: [
          {
            id: "movement-1",
            itemId: ITEM_ID,
            warehouseId: WAREHOUSE_ID,
            quantity: "100.000000",
            movementType: "purchase_receipt",
            movementDate: "2024-06-15",
            sourcePurchaseId: "purchase-1",
            sourcePurchaseNumber: "PO-2024-0001",
          },
          {
            id: "movement-2",
            itemId: ITEM_ID,
            warehouseId: WAREHOUSE_ID,
            quantity: "50.000000",
            movementType: "purchase_receipt",
            movementDate: "2024-06-16",
            sourcePurchaseId: "purchase-2",
            sourcePurchaseNumber: "PO-2024-0002",
          },
        ],
        total: 2,
        page: 1,
        pageSize: 20,
      }),
    ),
  );
}

describe("Inventory (Stock Ledger)", () => {
  it(
    "renders stock balances, displaying quantity exactly as the API returns it (a string, never parsed)",
    async () => {
      signIn();
      mockMasterOptions();
      mockBalances();

      renderApp({ initialEntries: ["/inventory"] });

      expect(await screen.findByText("Copper Cathode", {}, ASYNC)).toBeInTheDocument();
      expect(screen.getByText("Jebel Ali Warehouse")).toBeInTheDocument();
      expect(screen.getByText("150.000000")).toBeInTheDocument();
    },
    30000,
  );

  it(
    "clicking a balance row opens its movement history, resolved back to the source purchase",
    async () => {
      signIn();
      mockMasterOptions();
      mockBalances();
      mockMovementsForBalance();
      const user = userEvent.setup();

      renderApp({ initialEntries: ["/inventory"] });

      const row = await screen.findByText("150.000000", {}, ASYNC);
      await user.click(row.closest("tr") ?? row);

      const modal = await screen.findByRole("dialog", {}, ASYNC);
      expect(within(modal).getByText("PO-2024-0001")).toBeInTheDocument();
      expect(within(modal).getByText("PO-2024-0002")).toBeInTheDocument();
    },
    30000,
  );

  it(
    "the Inventory menu item is reachable by clicking, not just typing the URL",
    async () => {
      signIn();
      mockMasterOptions();
      mockBalances();
      const user = userEvent.setup();

      renderApp({ initialEntries: ["/"] });

      await user.click(await screen.findByText("Inventory", {}, ASYNC));

      expect(await screen.findByText("Inventory — Stock Balances", {}, ASYNC)).toBeInTheDocument();
    },
    30000,
  );

  it(
    "a user without inventory.stock.read never sees the menu item, and the direct URL 404s",
    async () => {
      signIn();
      server.use(
        http.get(`${API_BASE}${endpoints.myPermissions}`, () => HttpResponse.json({ permissions: ["purchase.po.read"] })),
        http.get(`${API_BASE}${endpoints.menus}`, () =>
          HttpResponse.json({
            menus: [
              { id: "m-dashboard", key: "dashboard", label: "Dashboard", path: "/dashboard", icon: "dashboard", sortOrder: 1, children: [] },
              // "Inventory" deliberately omitted - resolve.ts already excludes it server-side without inventory.stock.read.
            ],
          }),
        ),
      );

      renderApp({ initialEntries: ["/"] });
      await screen.findByText("Dashboard", {}, ASYNC);
      expect(screen.queryByText("Inventory")).not.toBeInTheDocument();

      renderApp({ initialEntries: ["/inventory"] });
      expect(await screen.findByText("404", {}, ASYNC)).toBeInTheDocument();
    },
    30000,
  );
});
