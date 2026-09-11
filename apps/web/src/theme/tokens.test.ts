import { describe, expect, it } from "vitest";
import { buildThemeTokens } from "./tokens";

describe("buildThemeTokens", () => {
  it("matches the app's base sizes at scale 1", () => {
    const theme = buildThemeTokens(1);

    expect(theme.token?.fontSize).toBe(13);
    expect(theme.token?.controlHeight).toBe(28);
    expect(theme.token?.controlHeightLG).toBe(34);
    expect(theme.token?.padding).toBe(12);
    expect(theme.token?.paddingSM).toBe(8);
    expect(theme.token?.marginSM).toBe(8);
    expect(theme.components?.Table?.cellPaddingBlock).toBe(10);
    expect(theme.components?.Table?.cellPaddingInline).toBe(12);
    expect(theme.components?.Form?.itemMarginBottom).toBe(16);
  });

  it("scales size-bearing tokens proportionally, rounded to whole pixels", () => {
    const theme = buildThemeTokens(1.25);

    expect(theme.token?.fontSize).toBe(16); // 13 * 1.25 = 16.25
    expect(theme.token?.controlHeight).toBe(35); // 28 * 1.25 = 35
    expect(theme.token?.controlHeightLG).toBe(43); // 34 * 1.25 = 42.5
    expect(theme.token?.padding).toBe(15);
    expect(theme.token?.paddingSM).toBe(10);
    expect(theme.token?.marginSM).toBe(10);
    expect(theme.components?.Table?.cellPaddingBlock).toBe(13); // 10 * 1.25 = 12.5
    expect(theme.components?.Table?.cellPaddingInline).toBe(15);
    expect(theme.components?.Form?.itemMarginBottom).toBe(20);
  });

  it("leaves colors and non-size tokens untouched by scale", () => {
    const base = buildThemeTokens(1);
    const scaled = buildThemeTokens(1.25);

    expect(scaled.token?.colorPrimary).toBe(base.token?.colorPrimary);
    expect(scaled.token?.borderRadius).toBe(base.token?.borderRadius);
    expect(scaled.components?.Menu?.itemBg).toBe(base.components?.Menu?.itemBg);
  });
});
