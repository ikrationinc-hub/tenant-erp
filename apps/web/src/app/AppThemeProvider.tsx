import type { PropsWithChildren, ReactElement } from "react";
import { useMemo } from "react";
import { App as AntApp, ConfigProvider } from "antd";
import { buildThemeTokens } from "../theme/tokens";
import { useAppStore } from "../core/store/app-store";

/**
 * ConfigProvider + AntD's App context, scaled live by HeaderBar's font-size
 * control (useAppStore's fontScale) - shared by App.tsx and the test render
 * helpers (render-app.tsx, render-with-providers.tsx) so they stay in sync
 * with the real provider stack instead of each hardcoding a static theme.
 */
export function AppThemeProvider({ children }: PropsWithChildren): ReactElement {
  const fontScale = useAppStore((s) => s.fontScale);
  const theme = useMemo(() => buildThemeTokens(fontScale), [fontScale]);

  return (
    <ConfigProvider theme={theme} componentSize="middle">
      <AntApp>{children}</AntApp>
    </ConfigProvider>
  );
}
