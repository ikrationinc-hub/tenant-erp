import type { ComponentType } from "react";
import {
  AccountBookOutlined,
  ApartmentOutlined,
  AppstoreOutlined,
  BankOutlined,
  ContactsOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  DollarOutlined,
  FileDoneOutlined,
  FileTextOutlined,
  FormOutlined,
  InboxOutlined,
  OrderedListOutlined,
  SafetyOutlined,
  SettingOutlined,
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
  "ordered-list": OrderedListOutlined,
  setting: SettingOutlined,
  "file-text": FileTextOutlined,
  "file-done": FileDoneOutlined,
  "account-book": AccountBookOutlined,
  dollar: DollarOutlined,
};

export function resolveMenuIcon(iconKey: string | null): ComponentType {
  const icon = iconKey ? ICONS[iconKey] : undefined;
  return icon ?? AppstoreOutlined;
}
