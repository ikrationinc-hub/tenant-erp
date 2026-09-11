import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router-dom";
import { render } from "@testing-library/react";
import { queryClient } from "../core/api/query-client";
import { AppThemeProvider } from "../app/AppThemeProvider";
import { routes as appRoutes } from "../app/routes";

/**
 * Mirrors App.tsx's provider stack but on a MemoryRouter so a test can pick
 * a starting path and read back where navigation landed. Deliberately
 * reuses the REAL queryClient singleton (not a fresh instance) - shell
 * components like CompanyBranchSwitcher call queryClient.invalidateQueries()
 * directly against that singleton rather than through context, so a test
 * double here would silently stop exercising the thing being tested.
 */
export function renderApp(
  options: { initialEntries?: string[]; routes?: RouteObject[] } = {},
): ReturnType<typeof render> & { router: ReturnType<typeof createMemoryRouter> } {
  const router = createMemoryRouter(options.routes ?? appRoutes, {
    initialEntries: options.initialEntries ?? ["/"],
  });

  const utils = render(
    <AppThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AppThemeProvider>,
  );

  return { ...utils, router };
}
