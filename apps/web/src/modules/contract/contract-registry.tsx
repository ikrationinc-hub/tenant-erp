import type { ReactElement } from "react";
import type { FlatMenuEntry } from "../../core/navigation/menu-tree-utils";
import { ContractFieldSetupScreen } from "./ContractFieldSetupScreen";

/** DynamicRoutes' resolveScreen hook for the Contract module's Settings-side screens - same pattern as modules/admin/admin-registry.tsx's resolveAdminScreen. */
const CONTRACT_SCREENS: Record<string, () => ReactElement | null> = {
  "/settings/contract/field-setup": () => <ContractFieldSetupScreen />,
};

export function resolveContractScreen(entry: FlatMenuEntry, pathname: string): ReactElement | null {
  if (pathname !== entry.path) {
    return null;
  }
  const render = entry.path ? CONTRACT_SCREENS[entry.path] : undefined;
  return render ? render() : null;
}
