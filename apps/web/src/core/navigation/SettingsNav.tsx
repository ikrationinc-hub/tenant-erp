import type { ReactElement } from "react";
import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Menu, type MenuProps } from "antd";
import type { MenuNode } from "@ikration/contracts";
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

/**
 * The Settings area's own sub-nav sidebar (Zoho's "All Settings" second
 * screenshot) - same GET /menus tree as the main NavigationMenu, filtered to
 * `section === "settings"` instead of "operate", and the SAME dark gunmetal
 * visual treatment (className "nav-menu" for the selected-rail indicator;
 * the dark color scheme itself comes from AntD's Sider->Menu theme context,
 * same as NavigationMenu - see SettingsShell's Sider theme="dark"). Two
 * components rather than one parametrized one only because they filter to
 * different tree sections and live in different Siders, not because they
 * should look different - this is still one app, one nav language.
 */
export function SettingsNav(): ReactElement {
  const { data } = useMenuTree();
  const navigate = useNavigate();
  const location = useLocation();

  const tree = useMemo(() => (data?.menus ?? []).filter((node) => node.section === "settings"), [data]);
  const items = useMemo(() => toAntItems(tree), [tree]);

  const trail = findBreadcrumbTrail(tree, location.pathname);
  const openKeys = trail ? trail.slice(0, -1).map((node) => node.path ?? node.key) : [];

  function handleClick(info: { key: string }): void {
    if (info.key.startsWith("/")) {
      void navigate(info.key);
    }
  }

  return (
    <Menu
      className="nav-menu settings-nav-menu"
      mode="inline"
      items={items}
      selectedKeys={[location.pathname]}
      defaultOpenKeys={openKeys}
      onClick={handleClick}
    />
  );
}
