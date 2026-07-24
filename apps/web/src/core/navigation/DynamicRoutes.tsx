import type { ReactElement } from "react";
import { useLocation } from "react-router-dom";
import { Spin } from "antd";
import { useMenuTree } from "./use-menu-tree";
import { flattenMenuPaths, type FlatMenuEntry } from "./menu-tree-utils";
import { PlaceholderScreen } from "./PlaceholderScreen";
import { NotFoundPage } from "./NotFoundPage";

export interface DynamicRoutesProps {
  /**
   * Resolves a matched menu entry (plus the full current pathname, for a
   * module with its own sub-paths - e.g. modules/purchase's list/new/:id
   * under the single "/purchase/orders" menu entry) to its real screen;
   * null falls back to the generic placeholder for an exact-path match, or
   * a 404 for an unresolved sub-path. Keeps this component ignorant of any
   * specific module (frontend rule 2) - a module's own path->screen
   * mapping (e.g. modules/masters/master-registry.tsx) lives in app
   * composition (routes.tsx), not here.
   */
  resolveScreen?: (entry: FlatMenuEntry, pathname: string) => ReactElement | null;
}

/**
 * Everything under the shell besides "/" itself renders here - matched
 * against the LIVE menu tree, never a hardcoded route array (frontend
 * rule 2). A path outside the tree is a 404, not a blank screen. Matching
 * is longest-prefix, not exact-only: a menu entry like "/purchase/orders"
 * also covers "/purchase/orders/new" and "/purchase/orders/<id>" - those
 * sub-paths never get their own menu row, but they're still gated by the
 * SAME row's presence in the user's tree.
 */
export function DynamicRoutes({ resolveScreen }: DynamicRoutesProps): ReactElement {
  const location = useLocation();
  const { data, isLoading } = useMenuTree();

  if (isLoading) {
    return <Spin data-testid="dynamic-routes-loading" />;
  }

  const candidates = flattenMenuPaths(data?.menus ?? []).filter(
    (entry) => location.pathname === entry.path || location.pathname.startsWith(`${entry.path}/`),
  );
  const match = [...candidates].sort((a, b) => b.path.length - a.path.length)[0];

  if (!match) {
    return <NotFoundPage />;
  }

  const resolved = resolveScreen?.(match, location.pathname);
  if (resolved) {
    return resolved;
  }

  if (location.pathname !== match.path) {
    return <NotFoundPage />;
  }

  return <PlaceholderScreen label={match.label} />;
}
