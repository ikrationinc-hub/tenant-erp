import type { ThemeConfig } from "antd";

/**
 * Deliberately distinct from apps/web's theme (ADM-3 task item 7) - a dark
 * slate/amber palette instead of web's blue trading-desk look, so an
 * operator can never mistake this console for a tenant login by color
 * alone. Still dense, still utilitarian - this is an internal ops tool, not
 * a marketing site.
 */
export const themeTokens: ThemeConfig = {
  token: {
    colorPrimary: "#0f172a",
    colorSuccess: "#0e9f6e",
    colorWarning: "#d97706",
    colorError: "#dc2626",
    colorInfo: "#0f172a",
    borderRadius: 4,
    fontSize: 13,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    controlHeight: 28,
    padding: 12,
    paddingSM: 8,
    marginSM: 8,
  },
  components: {
    Table: {
      cellPaddingBlock: 6,
      cellPaddingInline: 8,
      headerBg: "#f5f6f8",
    },
    Form: {
      itemMarginBottom: 12,
    },
    Layout: {
      headerHeight: 48,
      headerPadding: "0 16px",
      headerBg: "#0f172a",
      siderBg: "#0f172a",
    },
    Menu: {
      darkItemBg: "#0f172a",
      darkItemSelectedBg: "#1e293b",
    },
  },
};

/** The one accent color every "this is the platform console" marker (header badge, sider logo) shares. */
export const PLATFORM_ACCENT_COLOR = "#d97706";
