import type { ReactElement } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { RouterProvider } from "react-router-dom";
import { queryClient } from "./core/api/query-client";
import { router } from "./app/router";
import { AppThemeProvider } from "./app/AppThemeProvider";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { GlobalErrorToast } from "./app/GlobalErrorToast";

export function App(): ReactElement {
  return (
    <AppThemeProvider>
      <QueryClientProvider client={queryClient}>
        <GlobalErrorToast />
        <ErrorBoundary>
          <RouterProvider router={router} />
        </ErrorBoundary>
        {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
      </QueryClientProvider>
    </AppThemeProvider>
  );
}
