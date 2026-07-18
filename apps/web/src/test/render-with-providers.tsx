import type { ReactElement } from "react";
import { App as AntApp, ConfigProvider } from "antd";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { queryClient } from "../core/api/query-client";
import { themeTokens } from "../theme/tokens";

/** Same provider stack as App.tsx (minus the router) for components that don't need routing - reuses the real queryClient singleton, same reasoning as render-app.tsx. */
export function renderWithProviders(ui: ReactElement): ReturnType<typeof render> {
  return render(
    <ConfigProvider theme={themeTokens} componentSize="middle">
      <AntApp>
        <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
      </AntApp>
    </ConfigProvider>,
  );
}
