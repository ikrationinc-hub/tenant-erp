import type { ReactElement } from "react";
import type { FlatMenuEntry } from "../../core/navigation/menu-tree-utils";
import { CustomerScreen } from "./CustomerScreen";

const CUSTOMERS_PATH = "/customers";

/** DynamicRoutes' resolveScreen hook - S-1 (docs/SALES-MODULE-PLAN.md), exact mirror of supplier-registry.tsx's resolveSupplierScreen. */
export function resolveCustomerScreen(entry: FlatMenuEntry, pathname: string): ReactElement | null {
  if (pathname !== CUSTOMERS_PATH || entry.path !== CUSTOMERS_PATH) {
    return null;
  }
  return <CustomerScreen />;
}
