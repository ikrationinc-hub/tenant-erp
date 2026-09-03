import type { ReactElement } from "react";
import type { FlatMenuEntry } from "../../core/navigation/menu-tree-utils";
import { CONTRACTS_LIST_PATH, ContractsListScreen } from "./ContractsListScreen";
import { ContractDetailScreen } from "./ContractDetailScreen";
import { ContractFieldSetupScreen } from "./ContractFieldSetupScreen";
import { ClauseLibraryScreen } from "./ClauseLibraryScreen";
import { ContractTemplatesScreen } from "./ContractTemplatesScreen";

const DETAIL_PATH_PATTERN = new RegExp(`^${CONTRACTS_LIST_PATH}/([^/]+)$`);

/**
 * DynamicRoutes' resolveScreen hook for the Contract module - the
 * operational "Contracts" node (list + detail/assembly, main sidebar) and
 * the Settings-side admin screens (Clause Library, Contract Field Setup,
 * Templates), same pattern as modules/purchase/purchase-registry.tsx's
 * resolvePurchaseScreen for the list+detail pair.
 */
export function resolveContractScreen(entry: FlatMenuEntry, pathname: string): ReactElement | null {
  if (entry.path === CONTRACTS_LIST_PATH) {
    if (pathname === CONTRACTS_LIST_PATH) {
      return <ContractsListScreen />;
    }
    const detailMatch = DETAIL_PATH_PATTERN.exec(pathname);
    if (detailMatch?.[1]) {
      return <ContractDetailScreen contractId={detailMatch[1]} />;
    }
    return null;
  }

  if (pathname !== entry.path) {
    return null;
  }
  switch (entry.path) {
    case "/settings/contract/clauses":
      return <ClauseLibraryScreen />;
    case "/settings/contract/field-setup":
      return <ContractFieldSetupScreen />;
    case "/settings/contract/templates":
      return <ContractTemplatesScreen />;
    default:
      return null;
  }
}
