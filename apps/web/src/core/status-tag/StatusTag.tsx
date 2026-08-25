import type { CSSProperties, ReactElement } from "react";
import { slate } from "../../theme/palette";

export interface StatusTagProps {
  value: string | null | undefined;
  /** Status value -> a real CSS color (hex), not an AntD Tag preset name. Passed in per call site (see status-colors.ts) - this component never hardcodes a domain's status vocabulary. */
  colorMap: Record<string, string>;
  fallbackColor?: string;
  /** Defaults to capitalizing the raw value. Override for a domain-specific label (e.g. "invited" -> "Invited (pending)"). */
  labelFormatter?: (value: string) => string;
  /** For a caller whose label element points at this via htmlFor (e.g. FieldShell's ToggleField usage) - unused when StatusTag renders inside a table cell. */
  id?: string;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** 6-digit hex only - every colorMap in status-colors.ts is a literal hex, never shorthand or a CSS name. */
function hexToRgba(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const pillStyle = (color: string): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "2px 10px 2px 8px",
  borderRadius: 999,
  fontWeight: 600,
  fontSize: 12,
  lineHeight: 1.6,
  // Text always stays a dark neutral, never the status color itself - some
  // domain colors (e.g. draft's slate-400) are too light to read as text at
  // normal size. The color still carries full meaning via the dot + tint.
  color: slate[900],
  background: hexToRgba(color, 0.1),
  border: `1px solid ${hexToRgba(color, 0.32)}`,
});

const dotStyle = (color: string): CSSProperties => ({
  width: 6,
  height: 6,
  borderRadius: "50%",
  background: color,
  flexShrink: 0,
});

/**
 * Filled pill + dot, colored from the domain's own colorMap (status-colors.ts)
 * - replaces an earlier left-bar-tick treatment that echoed the sidebar's
 * rail motif but, on a table row, ended up saying "this is the status" via
 * two cues (a colored bar and bold text) without visually grouping them as
 * one. A pill reads as a single unit at a glance, which is what a status
 * needs to do in a scanned list. Single place every status indicator in the
 * app should route through - a status VALUE the backend already returned,
 * never a hardcoded field label (frontend rule 1 concerns label/layout, not
 * this).
 */
export function StatusTag({ value, colorMap, fallbackColor = slate[400], labelFormatter = capitalize, id }: StatusTagProps): ReactElement {
  if (!value) {
    return <span id={id}>—</span>;
  }
  const color = colorMap[value] ?? fallbackColor;
  return (
    <span id={id} style={pillStyle(color)}>
      <span style={dotStyle(color)} />
      {labelFormatter(value)}
    </span>
  );
}
