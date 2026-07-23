import { useQuery } from "@tanstack/react-query";
import { myPermissionsResponseSchema } from "@hyperion/contracts";
import { apiFetch } from "../api/client";
import { endpoints } from "../api/endpoints";

/** The company switcher invalidates the whole query cache on scope change (frontend rule 5), which covers this key too - no extra wiring needed for a company switch to refresh what a user can do. */
export function usePermissions(): { permissions: Set<string>; isLoading: boolean } {
  const query = useQuery({
    queryKey: ["users", "me", "permissions"],
    queryFn: () => apiFetch(endpoints.myPermissions, {}, { schema: myPermissionsResponseSchema }),
    staleTime: 5 * 60_000,
  });

  return {
    permissions: new Set(query.data?.permissions ?? []),
    isLoading: query.isLoading,
  };
}

/**
 * UX only (frontend rule 4) - hides an action the user can't perform so
 * they aren't clicking into a 403. The backend remains the actual gate on
 * every write; this never substitutes for it.
 */
export function useHasPermission(permission: string): boolean {
  const { permissions } = usePermissions();
  return permissions.has(permission);
}
