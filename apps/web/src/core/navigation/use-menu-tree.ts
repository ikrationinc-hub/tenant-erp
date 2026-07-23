import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { menuTreeResponseSchema, type MenuTreeResponse } from "@hyperion/contracts";
import { apiFetch } from "../api/client";
import { endpoints } from "../api/endpoints";

export const MENU_TREE_QUERY_KEY = ["menus"] as const;

/**
 * Company switch already invalidates the whole query cache (frontend rule
 * 5's CompanyBranchSwitcher), which covers this key for free. A role
 * change has no client-side trigger yet - the mutation that will cause
 * one (FE-5.5's role editor) doesn't exist; when it does, it must call
 * `queryClient.invalidateQueries({ queryKey: MENU_TREE_QUERY_KEY })` (or
 * invalidate everything, matching the company-switch precedent) after a
 * successful save.
 */
export function useMenuTree(): UseQueryResult<MenuTreeResponse> {
  return useQuery({
    queryKey: MENU_TREE_QUERY_KEY,
    queryFn: () => apiFetch(endpoints.menus, {}, { schema: menuTreeResponseSchema }),
    staleTime: 5 * 60_000,
  });
}
