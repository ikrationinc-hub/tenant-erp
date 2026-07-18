import type { ReactElement } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAppStore } from "../../core/store/app-store";

/** must_change_password blocks every route except /password-change (nested under RequireAuth, so this only ever runs for an authenticated session). */
export function RequireFullScope(): ReactElement {
  const mustChangePassword = useAppStore((s) => s.mustChangePassword);

  if (mustChangePassword) {
    return <Navigate to="/password-change" replace />;
  }

  return <Outlet />;
}
