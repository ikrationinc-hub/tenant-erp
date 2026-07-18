import type { RouteObject } from "react-router-dom";
import { Navigate } from "react-router-dom";
import { LoginPage } from "../modules/auth/LoginPage";
import { TenantsPage } from "../modules/tenants/TenantsPage";
import { HealthPage } from "../modules/health/HealthPage";
import { RequireAuth } from "./guards/RequireAuth";
import { AppShell } from "./layout/AppShell";

export const routes: RouteObject[] = [
  { path: "/login", element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        path: "/",
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/tenants" replace /> },
          { path: "tenants", element: <TenantsPage /> },
          { path: "health", element: <HealthPage /> },
        ],
      },
    ],
  },
];
