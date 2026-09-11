export interface FontScaleStep {
  key: string;
  label: string;
  scale: number;
}

/** HeaderBar's font-size dropdown options (Small/Default/Large/Extra Large) - fixed presets rather than a continuous stepper, so every step is a known-good multiplier against buildThemeTokens (theme/tokens.ts). */
export const FONT_SCALE_STEPS: readonly FontScaleStep[] = [
  { key: "sm", label: "Small", scale: 0.9 },
  { key: "md", label: "Default", scale: 1 },
  { key: "lg", label: "Large", scale: 1.1 },
  { key: "xl", label: "Extra Large", scale: 1.25 },
];

export const DEFAULT_FONT_SCALE = 1;
