import type { ReactElement } from "react";
import type { FlatMenuEntry } from "../../core/navigation/menu-tree-utils";
import { SalesListScreen, SALES_LIST_PATH } from "./SalesListScreen";
import { SalesDetailScreen } from "./SalesDetailScreen";

const NEW_PATH = `${SALES_LIST_PATH}/new`;
const DETAIL_PATH_PATTERN = new RegExp(`^${SALES_LIST_PATH}/([^/]+)$`);

/** DynamicRoutes' resolveScreen hook - S-3 (docs/SALES-MODULE-PLAN.md), mirrors resolvePurchaseScreen exactly: "/sales/orders" is the only seeded row; .../new and .../<id> are sub-paths of it, gated by that same row's presence in the user's menu. */
export function resolveSalesScreen(entry: FlatMenuEntry, pathname: string): ReactElement | null {
  if (entry.path !== SALES_LIST_PATH) {
    return null;
  }
  if (pathname === SALES_LIST_PATH) {
    return <SalesListScreen />;
  }
  if (pathname === NEW_PATH) {
    return <SalesDetailScreen mode="create" />;
  }
  const detailMatch = DETAIL_PATH_PATTERN.exec(pathname);
  if (detailMatch?.[1]) {
    return <SalesDetailScreen mode="edit" salesId={detailMatch[1]} />;
  }
  return null;
}
