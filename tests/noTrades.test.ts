import { describe, expect, it } from "vitest";
import { parseBins } from "@/lib/calc";
import { longerPeriods, noTradesMessage, noTradesState } from "@/lib/noTrades";
import { NO_VOLUME_PRESETS, concentrationNote, hasVolume, presetOptions } from "@/lib/rangeInputs";
import type { RawBinsResponse } from "@/lib/types";

/** Synthetic 11-bin pool (bins -5..5) with liquidity everywhere and the given total volume per bin. */
function bins(volPerBin: number) {
  const raw: RawBinsResponse = {
    window: { fromTs: 0, toTs: 7 * 86400 },
    curBinIdx: 0,
    bins: Array.from({ length: 11 }, (_, i) => ({
      bin: String(i - 5),
      swapCount: volPerBin > 0 ? "3" : "0",
      lengthE6: 100,
      token0: { volumeFiat: volPerBin / 2, lpFeesFiat: volPerBin / 2000, avgLiquidityFiat: 500, reserveFiat: i >= 5 ? 1000 : 0 },
      token1: { volumeFiat: volPerBin / 2, lpFeesFiat: volPerBin / 2000, avgLiquidityFiat: 500, reserveFiat: i <= 5 ? 1000 : 0 },
      aprBps: volPerBin > 0 ? 100 : 0,
      pnlAprBps: 0,
    })),
  };
  return parseBins(raw);
}
const idle = bins(0);
const busy = bins(100);

describe("no-trades empty state", () => {
  it("message names the window", () => {
    expect(noTradesMessage("24h")).toBe("No trades in the last 24h: this pool earned no fees, so there's nothing to estimate.");
    expect(noTradesMessage("7d")).toBe("No trades in the last 7d: this pool earned no fees, so there's nothing to estimate.");
  });

  it("longer periods", () => {
    expect(longerPeriods("24h")).toEqual(["7d", "30d"]);
    expect(longerPeriods("7d")).toEqual(["30d"]);
    expect(longerPeriods("30d")).toEqual([]);
  });

  it("null (normal results) when the window has volume", () => {
    expect(noTradesState(busy, "7d", {})).toBeNull();
  });

  it("offers only longer periods that have volume", () => {
    expect(noTradesState(idle, "24h", { "7d": idle, "30d": busy })).toEqual({ message: noTradesMessage("24h"), switchTo: ["30d"] });
    expect(noTradesState(idle, "24h", { "7d": busy, "30d": busy })!.switchTo).toEqual(["7d", "30d"]);
    expect(noTradesState(idle, "7d", { "30d": idle })!.switchTo).toEqual([]); // TEST/WETH: nothing anywhere
    expect(noTradesState(idle, "7d", {})!.switchTo).toEqual([]); // not loaded (yet / failed) → not offered
    expect(noTradesState(idle, "30d", { "7d": busy })!.switchTo).toEqual([]); // shorter periods never offered
  });
});

describe("presets with no volume", () => {
  it("no coverage and no concentrated-pool note (was '11 bins hold no volume of volume')", () => {
    expect(hasVolume(idle)).toBe(false);
    const o = presetOptions(idle);
    expect(o.every((x) => x.coverage === null)).toBe(true);
    expect(concentrationNote(o)).toBeNull();
    expect(NO_VOLUME_PRESETS).toBe("Presets need trading volume");
  });
});
