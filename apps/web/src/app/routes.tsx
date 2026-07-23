import type { RouteObject } from "react-router-dom";
import { LoginPage } from "../modules/auth/LoginPage";
import { AcceptInvitationPage } from "../modules/auth/AcceptInvitationPage";
import { ForcedPasswordChangePage } from "../modules/auth/ForcedPasswordChangePage";
import { RequireAuth } from "./guards/RequireAuth";
import { RequireFullScope } from "./guards/RequireFullScope";
import { AppShell } from "./layout/AppShell";
import { BootstrapStatus } from "./BootstrapStatus";
import { DynamicRoutes } from "../core/navigation/DynamicRoutes";
import { SchemaFormDevPage } from "./dev/SchemaFormDevPage";
import { SchemaTableDevPage } from "./dev/SchemaTableDevPage";

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
            path: "/",
            element: <AppShell />,
            children: [
              { index: true, element: <BootstrapStatus /> },
              { path: "*", element: <DynamicRoutes /> },
            ],
          },
        ],
      },
    ],
  },
];
