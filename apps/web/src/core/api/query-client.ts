import { QueryClient } from "@tanstack/react-query";

/** Sensible defaults for an internal tool: no refetch-on-focus spam, a short retry budget, and a minute of staleness before a background refetch. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
