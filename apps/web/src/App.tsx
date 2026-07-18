import type { ReactElement } from "react";
import { ConfigProvider } from "antd";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { RouterProvider } from "react-router-dom";
import { queryClient } from "./core/api/query-client";
import { router } from "./app/router";
import { themeTokens } from "./theme/tokens";

export function App(): ReactElement {
  return (
    <ConfigProvider theme={themeTokens} componentSize="middle">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
      </QueryClientProvider>
    </ConfigProvider>
  );
}
