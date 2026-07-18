import type { ThemeConfig } from "antd";

/**
 * Single source of truth for AntD's design tokens. A trading desk tool, not
 * a marketing site: dense by default (see ConfigProvider's componentSize in
 * main.tsx), tight spacing, no rounded-corner playfulness.
 */
export const themeTokens: ThemeConfig = {
  token: {
    colorPrimary: "#1554f5",
    colorSuccess: "#0e9f6e",
    colorWarning: "#d97706",
    colorError: "#dc2626",
    colorInfo: "#1554f5",
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
    },
  },
};
