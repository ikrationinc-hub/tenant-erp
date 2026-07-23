import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { paginatedRowsResponseSchema, type PaginatedRowsResponse } from "@hyperion/contracts";
import { apiFetch } from "../api/client";
import { withQuery } from "../api/endpoints";
import type { EntityListState } from "./use-entity-list-state";

/** Server-side pagination/sort/filter, always - never fetch-all-and-slice client-side (backend rule 10). Sort/filter params are sent regardless of whether a given endpoint honors them yet (e.g. masters has no sort param today); nothing here re-sorts or re-filters the response itself. */
export function useEntityList(endpoint: string, state: EntityListState): UseQueryResult<PaginatedRowsResponse> {
  const params: Record<string, string | undefined> = {
    page: String(state.page),
    pageSize: String(state.pageSize),
    search: state.search,
    sortBy: state.sortBy,
    sortDir: state.sortDir,
    ...state.filters,
  };

  return useQuery({
    queryKey: ["entity-list", endpoint, params],
    queryFn: () => apiFetch(withQuery(endpoint, params), {}, { schema: paginatedRowsResponseSchema }),
    placeholderData: keepPreviousData,
  });
}
