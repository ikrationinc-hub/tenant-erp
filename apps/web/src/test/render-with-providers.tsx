import type { ReactElement } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { queryClient } from "../core/api/query-client";
import { AppThemeProvider } from "../app/AppThemeProvider";

/** Same provider stack as App.tsx (minus the router) for components that don't need routing - reuses the real queryClient singleton, same reasoning as render-app.tsx. */
export function renderWithProviders(ui: ReactElement): ReturnType<typeof render> {
  return render(
    <AppThemeProvider>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </AppThemeProvider>,
  );
}
