import type { ReactElement } from "react";
import { Navigate, useLocation } from "react-router-dom";

/** A single bookmarked pre-restructure path -> its new /settings/* home. */
export function LegacyRedirect({ to }: { to: string }): ReactElement {
  return <Navigate to={to} replace />;
}

/** "/masters/:segment" bookmarks - a whole param'd subtree, so it gets one route instead of one entry per master. */
export function LegacyMastersRedirect(): ReactElement {
  const location = useLocation();
  return <Navigate to={location.pathname.replace("/masters/", "/settings/masters/")} replace />;
}
