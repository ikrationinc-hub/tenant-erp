import type { ReactElement } from "react";
import { useLocation } from "react-router-dom";
import { Spin } from "antd";
import { useMenuTree } from "./use-menu-tree";
import { flattenMenuPaths, type FlatMenuEntry } from "./menu-tree-utils";
import { PlaceholderScreen } from "./PlaceholderScreen";
import { NotFoundPage } from "./NotFoundPage";

export interface DynamicRoutesProps {
  /**
   * Resolves a matched menu entry to its real screen; null falls back to
   * the generic placeholder. Keeps this component ignorant of any
   * specific module (frontend rule 2) - a module's own path->screen
   * mapping (e.g. modules/masters/master-registry.tsx) lives in app
   * composition (routes.tsx), not here.
   */
  resolveScreen?: (entry: FlatMenuEntry) => ReactElement | null;
}

/**
 * Everything under the shell besides "/" itself renders here - matched
 * against the LIVE menu tree, never a hardcoded route array (frontend
 * rule 2). A path outside the tree is a 404, not a blank screen.
 */
export function DynamicRoutes({ resolveScreen }: DynamicRoutesProps): ReactElement {
  const location = useLocation();
  const { data, isLoading } = useMenuTree();

  if (isLoading) {
    return <Spin data-testid="dynamic-routes-loading" />;
  }

  const match = flattenMenuPaths(data?.menus ?? []).find((entry) => entry.path === location.pathname);

  if (!match) {
    return <NotFoundPage />;
  }

  return resolveScreen?.(match) ?? <PlaceholderScreen label={match.label} />;
}
