import type { ReactElement } from "react";
import { useLocation } from "react-router-dom";
import { Spin } from "antd";
import { useMenuTree } from "./use-menu-tree";
import { flattenMenuPaths } from "./menu-tree-utils";
import { PlaceholderScreen } from "./PlaceholderScreen";
import { NotFoundPage } from "./NotFoundPage";

/**
 * Everything under the shell besides "/" itself renders here - matched
 * against the LIVE menu tree, never a hardcoded route array (frontend
 * rule 2). A path outside the tree is a 404, not a blank screen.
 */
export function DynamicRoutes(): ReactElement {
  const location = useLocation();
  const { data, isLoading } = useMenuTree();

  if (isLoading) {
    return <Spin data-testid="dynamic-routes-loading" />;
  }

  const match = flattenMenuPaths(data?.menus ?? []).find((entry) => entry.path === location.pathname);

  if (!match) {
    return <NotFoundPage />;
  }

  return <PlaceholderScreen label={match.label} />;
}
