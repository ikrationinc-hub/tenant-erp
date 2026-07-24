import type { ReactElement } from "react";
import type { FlatMenuEntry } from "../../core/navigation/menu-tree-utils";
import { SupplierScreen } from "./SupplierScreen";

const SUPPLIERS_PATH = "/suppliers";

/** DynamicRoutes' resolveScreen hook - a single, non-generic screen (unlike masters, Suppliers has its own bespoke sub-tables), same registration pattern as modules/admin/admin-registry.tsx. */
export function resolveSupplierScreen(entry: FlatMenuEntry, pathname: string): ReactElement | null {
  if (pathname !== SUPPLIERS_PATH || entry.path !== SUPPLIERS_PATH) {
    return null;
  }
  return <SupplierScreen />;
}
