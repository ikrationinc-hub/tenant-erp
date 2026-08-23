/**
 * Named color consts for the trading-desk theme. Kept separate from
 * tokens.ts so a future dark-mode variant can swap these without
 * reshaping ThemeConfig itself.
 */

export const steelCobalt = {
  base: "#1B4B91",
  hover: "#163C74",
  active: "#122F5C",
} as const;

export const slate = {
  900: "#0F172A", // text primary
  600: "#475467", // text secondary
  400: "#98A2B3", // text tertiary / placeholder
  200: "#E4E7EC", // border
  100: "#EEF1F5", // table header / subtle fill
  bg: "#F8F9FB", // page background
} as const;

export const surface = "#FFFFFF";

/**
 * Dark "gunmetal" scale for the sidebar only - distinct from the light
 * `slate` scale used everywhere else (tables, borders, body text). Kept
 * separate so sidebar treatment never touches table/content styling.
 * Chosen over the app's cool slate/steel-cobalt scheme deliberately: a
 * dark panel next to the light content area, evaluated against several
 * alternatives (warm taupe, steel navy, graphite, anthracite) via a
 * mockup before landing here. The accent (rail + selected state) was
 * originally copper, but a warm orange-brown fought this cool gunmetal
 * ground - re-evaluated against several accents via a second mockup and
 * settled on steel cobalt, the app's own primary color, instead.
 */
export const sider = {
  bg: "#2B333D",
  hoverBg: "rgba(255, 255, 255, 0.07)",
  border: "#414B58",
  text: "#DCE3EA",
  textSecondary: "#98A6B5",
  logoText: "#E7EDF4",
  rail: steelCobalt.base,
  // Solid, pre-blended steel-cobalt-into-gunmetal (not rgba/alpha) - an
  // alpha overlay here rendered far more saturated than intended under
  // this machine's browser dark-mode color handling, so the blend is
  // baked into a literal hex instead of left to runtime compositing.
  selectedBg: "#27384F",
  selectedText: "#DCE7F5",
} as const;

export const semantic = {
  success: "#0e9f6e",
  warning: "#d97706",
  error: "#dc2626",
} as const;
