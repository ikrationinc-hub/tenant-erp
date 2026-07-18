import { App as AntApp, ConfigProvider } from "antd";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router-dom";
import { render } from "@testing-library/react";
import { queryClient } from "../core/api/query-client";
import { themeTokens } from "../theme/tokens";
import { routes as appRoutes } from "../app/routes";

/**
 * Mirrors App.tsx's provider stack but on a MemoryRouter so a test can pick
 * a starting path and read back where navigation landed. Reuses the REAL
 * queryClient singleton, same reasoning as apps/web's render-app.tsx.
 */
export function renderApp(
  options: { initialEntries?: string[]; routes?: RouteObject[] } = {},
): ReturnType<typeof render> & { router: ReturnType<typeof createMemoryRouter> } {
  const router = createMemoryRouter(options.routes ?? appRoutes, {
    initialEntries: options.initialEntries ?? ["/"],
  });

  const utils = render(
    <ConfigProvider theme={themeTokens} componentSize="middle">
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>,
  );

  return { ...utils, router };
}
