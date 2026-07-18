import type { RouteObject } from "react-router-dom";
import { LoginPage } from "../modules/auth/LoginPage";
import { AcceptInvitationPage } from "../modules/auth/AcceptInvitationPage";
import { ForcedPasswordChangePage } from "../modules/auth/ForcedPasswordChangePage";
import { RequireAuth } from "./guards/RequireAuth";
import { RequireFullScope } from "./guards/RequireFullScope";
import { AppShell } from "./layout/AppShell";
import { BootstrapStatus } from "./BootstrapStatus";
import { SchemaFormDevPage } from "./dev/SchemaFormDevPage";

/** Storybook-free renderer check (FE-3) - never shipped in a production build. */
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [{ path: "/_dev/schema-form", element: <SchemaFormDevPage /> }]
  : [];

/**
 * Empty of hardcoded BUSINESS routes (frontend rule 2) - FE-4 replaces the
 * "/" subtree with routes generated from GET /menus. Everything here is
 * shell/auth scaffolding: login, invitation acceptance, forced password
 * change, and the guards that gate access to the shell itself.
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
            path: "/",
            element: <AppShell />,
            children: [{ index: true, element: <BootstrapStatus /> }],
          },
        ],
      },
    ],
  },
];
