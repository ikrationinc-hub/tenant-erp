import type { CSSProperties, ReactElement } from "react";
import { slate } from "../../theme/palette";

export interface StatusTagProps {
  value: string | null | undefined;
  /** Status value -> a real CSS color (hex), not an AntD Tag preset name. Passed in per call site (see status-colors.ts) - this component never hardcodes a domain's status vocabulary. */
  colorMap: Record<string, string>;
  fallbackColor?: string;
  /** Defaults to capitalizing the raw value. Override for a domain-specific label (e.g. "invited" -> "Invited (pending)"). */
  labelFormatter?: (value: string) => string;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const barStyle = (color: string): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  borderLeft: `3px solid ${color}`,
  paddingLeft: 8,
  fontWeight: 500,
});

/**
 * Left-bar tick: a colored vertical bar + plain text, no pill/background -
 * deliberately echoes the app's existing rail motif (sidebar active item)
 * rather than AntD's default outlined Tag. Single place every status
 * indicator in the app should route through - a status VALUE the backend
 * already returned, never a hardcoded field label (frontend rule 1
 * concerns label/layout, not this).
 */
export function StatusTag({ value, colorMap, fallbackColor = slate[400], labelFormatter = capitalize }: StatusTagProps): ReactElement {
  if (!value) {
    return <span>—</span>;
  }
  return <span style={barStyle(colorMap[value] ?? fallbackColor)}>{labelFormatter(value)}</span>;
}
