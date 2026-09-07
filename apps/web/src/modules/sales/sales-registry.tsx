import type { ReactElement } from "react";
import type { FlatMenuEntry } from "../../core/navigation/menu-tree-utils";
import { SalesListScreen, SALES_LIST_PATH } from "./SalesListScreen";
import { SalesDetailScreen } from "./SalesDetailScreen";
import { SalesDeliveriesListScreen, SALES_DELIVERIES_LIST_PATH } from "./SalesDeliveriesListScreen";
import { SalesInvoicesListScreen, SALES_INVOICES_LIST_PATH } from "./SalesInvoicesListScreen";
import { SalesPaymentsReceivedListScreen, SALES_PAYMENTS_RECEIVED_LIST_PATH } from "./SalesPaymentsReceivedListScreen";

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

/** S-4: the standalone "Deliveries" list screen - a single seeded menu row with no sub-paths of its own, mirroring resolvePurchaseReceiptsScreen exactly. */
export function resolveSalesDeliveriesScreen(entry: FlatMenuEntry, pathname: string): ReactElement | null {
  if (entry.path !== SALES_DELIVERIES_LIST_PATH || pathname !== SALES_DELIVERIES_LIST_PATH) {
    return null;
  }
  return <SalesDeliveriesListScreen />;
}

/** S-5: the standalone "Invoices" list screen - mirrors resolveSalesDeliveriesScreen exactly. */
export function resolveSalesInvoicesScreen(entry: FlatMenuEntry, pathname: string): ReactElement | null {
  if (entry.path !== SALES_INVOICES_LIST_PATH || pathname !== SALES_INVOICES_LIST_PATH) {
    return null;
  }
  return <SalesInvoicesListScreen />;
}

/** S-5: the standalone "Payments Received" list screen - mirrors resolveSalesDeliveriesScreen exactly. */
export function resolveSalesPaymentsReceivedScreen(entry: FlatMenuEntry, pathname: string): ReactElement | null {
  if (entry.path !== SALES_PAYMENTS_RECEIVED_LIST_PATH || pathname !== SALES_PAYMENTS_RECEIVED_LIST_PATH) {
    return null;
  }
  return <SalesPaymentsReceivedListScreen />;
}
