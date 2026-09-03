import type { RouteObject } from "react-router-dom";
import { LoginPage } from "../modules/auth/LoginPage";
import { AcceptInvitationPage } from "../modules/auth/AcceptInvitationPage";
import { ForcedPasswordChangePage } from "../modules/auth/ForcedPasswordChangePage";
import { RequireAuth } from "./guards/RequireAuth";
import { RequireFullScope } from "./guards/RequireFullScope";
import { AppShell } from "./layout/AppShell";
import { SettingsShell } from "./layout/SettingsShell";
import { BootstrapStatus } from "./BootstrapStatus";
import { LegacyRedirect, LegacyMastersRedirect } from "./LegacyRedirects";
import { DynamicRoutes } from "../core/navigation/DynamicRoutes";
import { SettingsLauncher } from "../modules/settings/SettingsLauncher";
import { resolveMasterScreen } from "../modules/masters/master-registry";
import { resolveAdminScreen } from "../modules/admin/admin-registry";
import { resolveContractScreen } from "../modules/contract/contract-registry";
import { resolveSupplierScreen } from "../modules/suppliers/supplier-registry";
import { resolveBrokerScreen } from "../modules/brokers/broker-registry";
import { resolvePurchaseScreen, resolvePurchaseReceiptsScreen, resolvePurchaseBillsScreen, resolvePurchasePaymentsScreen } from "../modules/purchase/purchase-registry";
import { resolveInventoryScreen } from "../modules/inventory/inventory-registry";
import { SchemaFormDevPage } from "./dev/SchemaFormDevPage";
import { SchemaTableDevPage } from "./dev/SchemaTableDevPage";

/**
 * Bookmarked pre-restructure paths -> their new /settings/* home (task
 * acceptance: "old routes redirect, no 404s"). Config screens' ROUTES moved
 * under /settings; the screens/components/permissions themselves did not.
 */
const LEGACY_SETTINGS_REDIRECTS: Record<string, string> = {
  "/companies": "/settings/companies",
  "/branches": "/settings/branches",
  "/users": "/settings/users",
  "/roles": "/settings/roles",
  "/admin/field-definitions": "/settings/field-definitions",
};

const legacyRedirectRoutes: RouteObject[] = Object.entries(LEGACY_SETTINGS_REDIRECTS).map(([from, to]) => ({
  path: from,
  element: <LegacyRedirect to={to} />,
}));

/** Storybook-free renderer checks (FE-3, FE-4) - never shipped in a production build. */
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      { path: "/_dev/schema-form", element: <SchemaFormDevPage /> },
      { path: "/_dev/schema-table", element: <SchemaTableDevPage /> },
    ]
  : [];

/**
 * Empty of hardcoded BUSINESS routes (frontend rule 2). "/" is the fixed
 * dashboard landing page; every other path under the shell is matched at
 * runtime against the live GET /menus tree by DynamicRoutes - a path
 * outside that tree is a 404, not a blank screen.
 */
export const routes: RouteObject[] = [
  { path: "/login", element: <LoginPage /> },
  { path: "/accept-invitation/:token", element: <AcceptInvitationPage /> },
  ...devRoutes,
  {
    element: <RequireAuth />,
    children: [
      { path: "/password-change", element: <ForcedPasswordChangePage /> },
      {
        element: <RequireFullScope />,
        children: [
          {
            path: "/settings",
            element: <SettingsShell />,
            children: [
              { index: true, element: <SettingsLauncher /> },
              {
                path: "*",
                element: (
                  <DynamicRoutes
                    resolveScreen={(entry, pathname) =>
                      resolveMasterScreen(entry, pathname) ??
                      resolveAdminScreen(entry, pathname) ??
                      resolveContractScreen(entry, pathname)
                    }
                  />
                ),
              },
            ],
          },
          {
            path: "/",
            element: <AppShell />,
            children: [
              { index: true, element: <BootstrapStatus /> },
              ...legacyRedirectRoutes,
              { path: "/masters/*", element: <LegacyMastersRedirect /> },
              {
                path: "*",
                element: (
                  <DynamicRoutes
                    resolveScreen={(entry, pathname) =>
                      resolveSupplierScreen(entry, pathname) ??
                      resolveBrokerScreen(entry, pathname) ??
                      resolvePurchaseScreen(entry, pathname) ??
                      resolvePurchaseReceiptsScreen(entry, pathname) ??
                      resolvePurchaseBillsScreen(entry, pathname) ??
                      resolvePurchasePaymentsScreen(entry, pathname) ??
                      resolveInventoryScreen(entry, pathname)
                    }
                  />
                ),
              },
            ],
          },
        ],
      },
    ],
  },
];
