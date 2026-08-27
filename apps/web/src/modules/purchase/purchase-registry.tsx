import type { ReactElement } from "react";
import type { FlatMenuEntry } from "../../core/navigation/menu-tree-utils";
import { PurchaseListScreen, PURCHASE_LIST_PATH } from "./PurchaseListScreen";
import { PurchaseDetailScreen } from "./PurchaseDetailScreen";
import { PurchaseReceiptsListScreen, PURCHASE_RECEIPTS_LIST_PATH } from "./PurchaseReceiptsListScreen";
import { PurchaseBillsListScreen, PURCHASE_BILLS_LIST_PATH } from "./PurchaseBillsListScreen";
import { PurchasePaymentsListScreen, PURCHASE_PAYMENTS_LIST_PATH } from "./PurchasePaymentsListScreen";

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

/**
 * PL-4: the two standalone "Purchase Receipts"/"Bills" list screens - each
 * a single seeded menu row with no sub-paths of its own (unlike the PO's
 * own list/create/detail trio above), so a flat entry.path match is enough.
 */
export function resolvePurchaseReceiptsScreen(entry: FlatMenuEntry, pathname: string): ReactElement | null {
  if (entry.path !== PURCHASE_RECEIPTS_LIST_PATH || pathname !== PURCHASE_RECEIPTS_LIST_PATH) {
    return null;
  }
  return <PurchaseReceiptsListScreen />;
}

export function resolvePurchaseBillsScreen(entry: FlatMenuEntry, pathname: string): ReactElement | null {
  if (entry.path !== PURCHASE_BILLS_LIST_PATH || pathname !== PURCHASE_BILLS_LIST_PATH) {
    return null;
  }
  return <PurchaseBillsListScreen />;
}

/** PL-5: the "Payments Made" list screen - same flat, single-menu-row shape as Receipts/Bills above. */
export function resolvePurchasePaymentsScreen(entry: FlatMenuEntry, pathname: string): ReactElement | null {
  if (entry.path !== PURCHASE_PAYMENTS_LIST_PATH || pathname !== PURCHASE_PAYMENTS_LIST_PATH) {
    return null;
  }
  return <PurchasePaymentsListScreen />;
}
