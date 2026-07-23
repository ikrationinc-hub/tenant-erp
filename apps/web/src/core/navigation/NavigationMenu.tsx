import type { ReactElement } from "react";
import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Menu, type MenuProps } from "antd";
import type { MenuNode } from "@hyperion/contracts";
import { resolveMenuIcon } from "./icon-registry";
import { useMenuTree } from "./use-menu-tree";
import { findBreadcrumbTrail } from "./menu-tree-utils";

type AntMenuItems = NonNullable<MenuProps["items"]>;

function toAntItems(nodes: MenuNode[]): AntMenuItems {
  return nodes.map((node) => {
    const Icon = resolveMenuIcon(node.icon);
    const children = node.children.length > 0 ? toAntItems(node.children) : undefined;
    return {
      key: node.path ?? node.key,
      icon: <Icon />,
      label: node.label,
      ...(children ? { children } : {}),
    };
  });
}

/** Renders GET /menus into an AntD Menu - tree, icons, sort_order/parent_id nesting all already resolved server-side (frontend rule 2: no hardcoded route array anywhere here). */
export function NavigationMenu(): ReactElement {
  const { data } = useMenuTree();
  const navigate = useNavigate();
  const location = useLocation();

  const tree = useMemo(() => data?.menus ?? [], [data]);
  const items = useMemo(() => toAntItems(tree), [tree]);

  const trail = findBreadcrumbTrail(tree, location.pathname);
  const openKeys = trail ? trail.slice(0, -1).map((node) => node.path ?? node.key) : [];

  function handleClick(info: { key: string }): void {
    // A group header's key is its menu `key` (e.g. "masters"), not a route - only a real path is navigable.
    if (info.key.startsWith("/")) {
      void navigate(info.key);
    }
  }

  return (
    <Menu
      mode="inline"
      items={items}
      selectedKeys={[location.pathname]}
      defaultOpenKeys={openKeys}
      onClick={handleClick}
    />
  );
}
