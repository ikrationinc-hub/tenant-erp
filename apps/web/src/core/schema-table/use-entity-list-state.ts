import { useSearchParams } from "react-router-dom";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;

export interface EntityListState {
  page: number;
  pageSize: number;
  sortBy: string | undefined;
  sortDir: "asc" | "desc" | undefined;
  search: string | undefined;
  filters: Record<string, string>;
}

export interface EntityListStateControls {
  state: EntityListState;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  setSort: (sortBy: string | undefined, sortDir: "asc" | "desc" | undefined) => void;
  setSearch: (search: string | undefined) => void;
  setFilter: (key: string, value: string | undefined) => void;
}

function parsePositiveInt(raw: string | null, fallback: number): number {
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

/**
 * The URL is the only state - reading it fresh every render instead of
 * mirroring it into useState means there's nothing to fall out of sync.
 * A filtered/sorted/paginated view is shareable and survives a refresh
 * (FE-4) for free.
 */
export function useEntityListState(filterKeys: readonly string[]): EntityListStateControls {
  const [searchParams, setSearchParams] = useSearchParams();

  const sortDirRaw = searchParams.get("sortDir");
  const filters: Record<string, string> = {};
  for (const key of filterKeys) {
    const value = searchParams.get(key);
    if (value !== null) {
      filters[key] = value;
    }
  }

  const state: EntityListState = {
    page: parsePositiveInt(searchParams.get("page"), DEFAULT_PAGE),
    pageSize: parsePositiveInt(searchParams.get("pageSize"), DEFAULT_PAGE_SIZE),
    sortBy: searchParams.get("sortBy") ?? undefined,
    sortDir: sortDirRaw === "asc" || sortDirRaw === "desc" ? sortDirRaw : undefined,
    search: searchParams.get("search") ?? undefined,
    filters,
  };

  function update(patch: Record<string, string | undefined>): void {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === "") {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      }
      return next;
    });
  }

  return {
    state,
    setPage: (page) => update({ page: String(page) }),
    setPageSize: (pageSize) => update({ pageSize: String(pageSize), page: "1" }),
    setSort: (sortBy, sortDir) => update({ sortBy, sortDir, page: "1" }),
    setSearch: (search) => update({ search, page: "1" }),
    setFilter: (key, value) => update({ [key]: value, page: "1" }),
  };
}
