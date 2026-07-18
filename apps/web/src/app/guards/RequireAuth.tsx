import type { ReactElement } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAppStore } from "../../core/store/app-store";

/** Unauthenticated -> /login, carrying the attempted path so LoginPage can return the user to it. */
export function RequireAuth(): ReactElement {
  const accessToken = useAppStore((s) => s.accessToken);
  const location = useLocation();

  if (!accessToken) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
