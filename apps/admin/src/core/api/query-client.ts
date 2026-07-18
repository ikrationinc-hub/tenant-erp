import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api-error";
import { notifyError, type ErrorToastPayload } from "./error-toast";

function toToastPayload(error: unknown): ErrorToastPayload {
  if (error instanceof ApiError) {
    return { message: error.code.replace(/_/g, " "), description: error.message };
  }
  if (error instanceof Error) {
    return { message: "Request failed", description: error.message };
  }
  return { message: "Request failed" };
}

/** Sensible defaults for an internal ops tool: no refetch-on-focus spam, a short retry budget. Every query/mutation error also feeds the global toast (see GlobalErrorToast). */
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
