import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { notifyError, toToastPayload } from "./error-toast";

/** Sensible defaults for an internal tool: no refetch-on-focus spam, a short retry budget, and a minute of staleness before a background refetch. Every query/mutation error also feeds the global toast (see GlobalErrorToast). */
export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => notifyError(toToastPayload(error)),
  }),
  mutationCache: new MutationCache({
    onError: (error) => notifyError(toToastPayload(error)),
  }),
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
