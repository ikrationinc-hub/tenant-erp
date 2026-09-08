import { describe, expect, it } from "vitest";
import { costAllocation, grossProfit, landedRatePerUnit } from "../cost-allocation.js";

describe("core/inventory-lots: costAllocation (pure, no DB)", () => {
  it("with zero shared charges, each lot's cost is exactly qty x landedRate", () => {
    const result = costAllocation(
      [
        { lotId: "lot-1", qty: "100", landedRate: "8000" },
        { lotId: "lot-2", qty: "50", landedRate: "8200" },
      ],
      { freight: "0", insurance: "0", customs: "0", other: "0" },
      "qty",
    );

    expect(result).toEqual([
      { lotId: "lot-1", cost: "800000.00" },
      { lotId: "lot-2", cost: "410000.00" },
    ]);
  });

  it("allocates across 3 lots at 3 different landed rates, by qty basis - exact weighted sum, hand-computed", () => {
    // Lots: 100 @ 8000, 200 @ 8500, 50 @ 9000 -> total qty 350
    // Shared charges: freight 3500, insurance 700, customs 1400, other 0 -> total 5600
    // Per-unit share (qty basis) = 5600 / 350 = 16 exactly
    // lot-1: base 100*8000=800000, share 100*16=1600 -> 801600.00
    // lot-2: base 200*8500=1700000, share 200*16=3200 -> 1703200.00
    // lot-3: base 50*9000=450000, share 50*16=800 (last line absorbs remainder, still 800 exactly) -> 450800.00
    const result = costAllocation(
      [
        { lotId: "lot-1", qty: "100", landedRate: "8000" },
        { lotId: "lot-2", qty: "200", landedRate: "8500" },
        { lotId: "lot-3", qty: "50", landedRate: "9000" },
      ],
      { freight: "3500", insurance: "700", customs: "1400", other: "0" },
      "qty",
    );

    expect(result).toEqual([
      { lotId: "lot-1", cost: "801600.00" },
      { lotId: "lot-2", cost: "1703200.00" },
      { lotId: "lot-3", cost: "450800.00" },
    ]);

    // Sum of allocated shares must equal the total shared-charge pool exactly.
    const totalBase = 100 * 8000 + 200 * 8500 + 50 * 9000;
    const totalCost = result.reduce((sum, r) => sum + Number(r.cost), 0);
    expect(Math.round((totalCost - totalBase) * 100) / 100).toBe(5600);
  });

  it("value basis: share is proportional to qty x landedRate, not qty alone", () => {
    // Lots: 100 @ 1000 (value 100000), 100 @ 9000 (value 900000) -> total value 1000000
    // Shared charges total = 1000 -> lot-1 share = 100000/1000000*1000 = 100; lot-2 share = 900
    const result = costAllocation(
      [
        { lotId: "cheap", qty: "100", landedRate: "1000" },
        { lotId: "expensive", qty: "100", landedRate: "9000" },
      ],
      { freight: "1000", insurance: "0", customs: "0", other: "0" },
      "value",
    );

    expect(result).toEqual([
      { lotId: "cheap", cost: "100100.00" },
      { lotId: "expensive", cost: "900900.00" },
    ]);
  });

  it("landedRatePerUnit divides a total cost back down to a per-unit rate, rounded to 6dp", () => {
    expect(landedRatePerUnit("801600.00", "100")).toBe("8016.000000");
    expect(landedRatePerUnit("100", "3")).toBe("33.333333");
  });

  it("empty allocations list returns an empty result, never throws", () => {
    expect(costAllocation([], { freight: "100", insurance: "0", customs: "0", other: "0" })).toEqual([]);
  });

  it("a single lot absorbs the entire shared-charge pool exactly", () => {
    const result = costAllocation([{ lotId: "solo", qty: "10", landedRate: "500" }], { freight: "37", insurance: "0", customs: "0", other: "0" });
    expect(result).toEqual([{ lotId: "solo", cost: "5037.00" }]);
  });

});

describe("core/inventory-lots: grossProfit (pure, no DB)", () => {
  it("computes exact 2dp gross profit and profit percent for a realistic sale", () => {
    // Sale: 40 units @ 8500/unit = 340000.00 sales value
    // Specific-lot cost: 40 units @ landedRate 8016 = 320640.00
    // Gross profit = 340000.00 - 320640.00 = 19360.00
    // Profit % = 19360 / 340000 * 100 = 5.694117647... -> 5.69
    const result = grossProfit({ salesValue: "340000.00", totalCost: "320640.00" });
    expect(result.grossProfit).toBe("19360.00");
    expect(result.profitPercent).toBe("5.69");
  });

  it("a loss (cost exceeds sales value) yields a negative gross profit and negative percent", () => {
    const result = grossProfit({ salesValue: "1000.00", totalCost: "1200.00" });
    expect(result.grossProfit).toBe("-200.00");
    expect(result.profitPercent).toBe("-20.00");
  });

  it("a zero sales value never throws - reports 0.00 percent rather than dividing by zero", () => {
    const result = grossProfit({ salesValue: "0.00", totalCost: "0.00" });
    expect(result.grossProfit).toBe("0.00");
    expect(result.profitPercent).toBe("0.00");
  });
});
