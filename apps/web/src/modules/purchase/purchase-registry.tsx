import type { ReactElement } from "react";
import type { FlatMenuEntry } from "../../core/navigation/menu-tree-utils";
import { PurchaseListScreen, PURCHASE_LIST_PATH } from "./PurchaseListScreen";
import { PurchaseDetailScreen } from "./PurchaseDetailScreen";

const NEW_PATH = `${PURCHASE_LIST_PATH}/new`;
const DETAIL_PATH_PATTERN = new RegExp(`^${PURCHASE_LIST_PATH}/([^/]+)$`);

/**
 * DynamicRoutes' resolveScreen hook - the one module whose real routes go
 * beyond its own menu entry ("/purchase/orders" is the only seeded row;
 * .../new and .../<id> are sub-paths of it, gated by the SAME row's
 * presence in the user's menu, not additional rows of their own).
 */
export function resolvePurchaseScreen(entry: FlatMenuEntry, pathname: string): ReactElement | null {
  if (entry.path !== PURCHASE_LIST_PATH) {
    return null;
  }
  if (pathname === PURCHASE_LIST_PATH) {
    return <PurchaseListScreen />;
  }
  if (pathname === NEW_PATH) {
    return <PurchaseDetailScreen mode="create" />;
  }
  const detailMatch = DETAIL_PATH_PATTERN.exec(pathname);
  if (detailMatch?.[1]) {
    return <PurchaseDetailScreen mode="edit" purchaseId={detailMatch[1]} />;
  }
  return null;
}
