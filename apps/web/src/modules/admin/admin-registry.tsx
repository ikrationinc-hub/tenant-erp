import type { ReactElement } from "react";
import type { FlatMenuEntry } from "../../core/navigation/menu-tree-utils";
import { CompanyScreen } from "./CompanyScreen";
import { BranchScreen } from "./BranchScreen";
import { UserManagementScreen } from "./UserManagementScreen";
import { RoleListScreen } from "./RoleListScreen";

/**
 * DynamicRoutes' resolveScreen hook for the tenant-admin surface (FE-5.5) -
 * same pattern as modules/masters/master-registry.tsx's
 * resolveMasterScreen. A fixed, small set of paths (unlike masters, there's
 * no per-instance registry needed here - each of these is its own
 * screen), still driven entirely by the live menu tree: a path not in a
 * user's menu never reaches this function at all (DynamicRoutes 404s
 * first).
 */
const ADMIN_SCREENS: Record<string, () => ReactElement> = {
  "/companies": () => <CompanyScreen />,
  "/branches": () => <BranchScreen />,
  "/users": () => <UserManagementScreen />,
  "/roles": () => <RoleListScreen />,
};

export function resolveAdminScreen(entry: FlatMenuEntry): ReactElement | null {
  const render = entry.path ? ADMIN_SCREENS[entry.path] : undefined;
  return render ? render() : null;
}
