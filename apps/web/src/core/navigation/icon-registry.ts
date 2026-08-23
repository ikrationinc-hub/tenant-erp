import type { ComponentType } from "react";
import {
  ApartmentOutlined,
  AppstoreOutlined,
  BankOutlined,
  ContactsOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  FormOutlined,
  InboxOutlined,
  SafetyOutlined,
  ShopOutlined,
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
  shop: ShopOutlined,
  bank: BankOutlined,
  apartment: ApartmentOutlined,
  form: FormOutlined,
  contacts: ContactsOutlined,
  inbox: InboxOutlined,
};

export function resolveMenuIcon(iconKey: string | null): ComponentType {
  const icon = iconKey ? ICONS[iconKey] : undefined;
  return icon ?? AppstoreOutlined;
}
