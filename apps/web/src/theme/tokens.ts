import type { ThemeConfig } from "antd";
import { semantic, sider, slate, steelCobalt, surface } from "./palette";

/**
 * Single source of truth for AntD's design tokens. A trading desk tool, not
 * a marketing site: dense by default (see ConfigProvider's componentSize in
 * App.tsx), tight spacing, no rounded-corner playfulness.
 *
 * Takes a `scale` multiplier (HeaderBar's font-size control, backed by
 * useAppStore's `fontScale`) so the whole size scale - not just text - grows
 * together: control height, padding, and table/form spacing are pinned
 * literals here that AntD would NOT otherwise recompute from `fontSize`
 * alone (its own derivation only covers tokens this file leaves unset, e.g.
 * fontSizeSM/LG, headings, line-height). Colors, radius, and font family are
 * untouched by scale.
 */
export function buildThemeTokens(scale: number): ThemeConfig {
  return {
    token: {
      colorPrimary: steelCobalt.base,
      colorLink: steelCobalt.base,
      colorInfo: steelCobalt.base,
      colorSuccess: semantic.success,
      colorWarning: semantic.warning,
      colorError: semantic.error,
      colorTextBase: slate[900],
      colorTextSecondary: slate[600],
      colorTextTertiary: slate[400],
      colorTextPlaceholder: slate[400],
      colorBorder: slate[200],
      colorBorderSecondary: slate[200],
      colorBgLayout: slate.bg,
      colorBgContainer: surface,
      borderRadius: 4,
      borderRadiusLG: 6,
      fontSize: Math.round(13 * scale),
      fontFamily:
        "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      fontFamilyCode: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      controlHeight: Math.round(28 * scale),
      // Tables/filters stay dense at controlHeight (28, componentSize
      // "middle" in App.tsx). Forms opt into this via a nested
      // ConfigProvider componentSize="large" (SchemaForm.tsx) - a form is
      // read and typed into, not scanned row-by-row like a table, so it
      // gets more breathing room than the app's default density.
      controlHeightLG: Math.round(34 * scale),
      padding: Math.round(12 * scale),
      paddingSM: Math.round(8 * scale),
      marginSM: Math.round(8 * scale),
    },
    components: {
      Table: {
        // 6/8 read as cramped for data someone stares at for hours (e.g.
        // Purchase Orders) - bumped once, app-wide, rather than per-screen.
        cellPaddingBlock: Math.round(10 * scale),
        cellPaddingInline: Math.round(12 * scale),
        headerBg: slate[100],
        headerColor: slate[600],
        rowHoverBg: slate[100],
        rowSelectedBg: slate[100],
        rowSelectedHoverBg: slate[100],
      },
      Form: {
        itemMarginBottom: Math.round(16 * scale),
      },
      Layout: {
        headerHeight: 48,
        headerPadding: "0 16px",
        headerBg: surface,
        // AppShell's Sider uses theme="dark" (it's a dark gunmetal panel),
        // which reads this token - not `lightSiderBg`, that's for
        // theme="light" and no longer applies. AppShell renders its own
        // collapse trigger (trigger={null}), so the default trigger*
        // tokens have no element left to style.
        siderBg: sider.bg,
      },
      Menu: {
        // Menu paints its own opaque background by default (itemBg defaults
        // to the white colorBgContainer seed) - without this override it
        // covers the Sider's siderBg with white everywhere the menu list
        // actually renders. Must match Layout.siderBg above. This Menu
        // instance is only ever rendered inside the sidebar (NavigationMenu),
        // so overriding its text color here is safe - it isn't shared with
        // any light-background Menu elsewhere.
        itemBg: sider.bg,
        itemColor: sider.text,
        itemHoverBg: sider.hoverBg,
        itemHoverColor: sider.text,
        itemSelectedBg: sider.selectedBg,
        itemSelectedColor: sider.selectedText,
        // Not overriding this left the parent "Purchase" label (a submenu
        // title whose child route is active) on AntD's own default, which
        // rendered inconsistently with the rest of this palette - pin it
        // explicitly to match the leaf item's selected color.
        subMenuItemSelectedColor: sider.selectedText,
        subMenuItemBg: sider.bg,
        groupTitleColor: sider.textSecondary,
        // The collapsed-rail flyout (hover a top-level icon that has
        // children) is painted from this token, not itemBg - without it,
        // it fell back to colorBgElevated (white), so itemColor's
        // near-white text became invisible against it.
        popupBg: sider.bg,
      },
      Button: {
        primaryShadow: "none",
        borderRadius: 4,
      },
      Card: {
        headerBg: "transparent",
      },
    },
  };
}
