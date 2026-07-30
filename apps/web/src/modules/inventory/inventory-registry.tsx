import type { ReactElement } from "react";
import type { FlatMenuEntry } from "../../core/navigation/menu-tree-utils";
import { InventoryBalancesScreen } from "./InventoryBalancesScreen";
import { InventoryMovementsScreen } from "./InventoryMovementsScreen";
import { INVENTORY_MOVEMENTS_PATH, INVENTORY_PATH } from "./shared";

/**
 * DynamicRoutes' resolveScreen hook (frontend rule 2, no hardcoded route
 * array) - "/inventory" is the single seeded menu entry (one permission,
 * inventory.stock.read, gates both views); ".../movements" is a sub-path
 * of it, same pattern as modules/purchase/purchase-registry.tsx's
 * .../new and .../:id under one "/purchase/orders" row.
 */
export function resolveInventoryScreen(entry: FlatMenuEntry, pathname: string): ReactElement | null {
  if (entry.path !== INVENTORY_PATH) {
    return null;
  }
  if (pathname === INVENTORY_MOVEMENTS_PATH) {
    return <InventoryMovementsScreen />;
  }
  if (pathname === INVENTORY_PATH) {
    return <InventoryBalancesScreen />;
  }
  return null;
}
