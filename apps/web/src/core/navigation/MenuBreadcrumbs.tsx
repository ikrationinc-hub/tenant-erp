import type { ReactElement } from "react";
import { Breadcrumb } from "antd";
import { Link, useLocation } from "react-router-dom";
import { useMenuTree } from "./use-menu-tree";
import { findBreadcrumbTrail } from "./menu-tree-utils";

/** Derived from the same tree NavigationMenu renders - never a screen-declared trail. */
export function MenuBreadcrumbs(): ReactElement | null {
  const { data } = useMenuTree();
  const location = useLocation();
  const trail = findBreadcrumbTrail(data?.menus ?? [], location.pathname);

  if (!trail || trail.length === 0) {
    return null;
  }

  return (
    <Breadcrumb
      style={{ marginBottom: 16 }}
      items={trail.map((node, index) => {
        const isLast = index === trail.length - 1;
        return {
          title: isLast || !node.path ? node.label : <Link to={node.path}>{node.label}</Link>,
        };
      })}
    />
  );
}
