import type { ReactElement } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAdminStore } from "../../core/store/admin-store";

/** Unauthenticated -> /login, carrying the attempted path so LoginPage can return the operator to it. No invite/accept flow here (ADM-3 task item 5) - platform admins are seeded/managed out-of-band. */
export function RequireAuth(): ReactElement {
  const accessToken = useAdminStore((s) => s.accessToken);
  const location = useLocation();

  if (!accessToken) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
