import { useQuery } from "@tanstack/react-query";
import { platformHealthResponseSchema } from "@hyperion/contracts";
import { apiFetch } from "../../core/api/client";
import { endpoints } from "../../core/api/endpoints";

/** 15-30s auto-refresh (ADM-5 task item 2) - a health page is only useful if it's current. */
const HEALTH_REFETCH_INTERVAL_MS = 20_000;

export function usePlatformHealthQuery() {
  return useQuery({
    queryKey: ["platform", "health"],
    queryFn: () => apiFetch(endpoints.health, {}, { schema: platformHealthResponseSchema }),
    refetchInterval: HEALTH_REFETCH_INTERVAL_MS,
  });
}
