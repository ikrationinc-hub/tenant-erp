import type { ComponentType } from "react";
import {
  AppstoreOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  SafetyOutlined,
  ShoppingCartOutlined,
  TeamOutlined,
} from "@ant-design/icons";

/** Menu rows carry an icon KEY (seed-menu-tree.ts), not a component - this is the one place that maps a key to a real icon. Unknown keys fall back to a generic icon rather than rendering nothing. */
const ICONS: Record<string, ComponentType> = {
  dashboard: DashboardOutlined,
  users: TeamOutlined,
  shield: SafetyOutlined,
  database: DatabaseOutlined,
  "shopping-cart": ShoppingCartOutlined,
};

export function resolveMenuIcon(iconKey: string | null): ComponentType {
  const icon = iconKey ? ICONS[iconKey] : undefined;
  return icon ?? AppstoreOutlined;
}
