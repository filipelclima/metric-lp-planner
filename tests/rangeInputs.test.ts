import { describe, expect, it } from "vitest";
import { parseBins } from "@/lib/calc";
import {
  activePreset,
  binBounds,
  clampBin,
  concentrationNote,
  edgeLabel,
  parseBinInput,
  presetOptions,
  presetSubLabel,
  tokenNeeds,
  widerRange,
} from "@/lib/rangeInputs";
import type { RawBinsResponse } from "@/lib/types";

/** Synthetic pool, bins -5..5 (0.01% wide), price at 0; volume per bin from `vol` (index 0 = bin -5). */
function pool(vol: number[]) {
  const raw: RawBinsResponse = {
    window: { fromTs: 0, toTs: 7 * 86400 },
    curBinIdx: 0,
    bins: vol.map((v, i) => ({
      bin: String(i - 5),
      swapCount: "1",
      lengthE6: 100,
      token0: { volumeFiat: v / 2, lpFeesFiat: v / 2000, avgLiquidityFiat: 500, reserveFiat: i >= 5 ? 1000 : 0 },
      token1: { volumeFiat: v / 2, lpFeesFiat: v / 2000, avgLiquidityFiat: 500, reserveFiat: i <= 5 ? 1000 : 0 },
      aprBps: 100,
      pnlAprBps: 50,
    })),
  };
  return parseBins(raw);
}
// 3 bins (#-2…#0) hold 96% of volume, like SPCX/USDG.
const concentrated = pool([0, 0, 1, 40, 16, 40, 1, 1, 1, 0, 0]);
const spread = pool([1, 2, 4, 8, 15, 40, 15, 8, 4, 2, 1]);

describe("bin input parsing", () => {
  it('accepts "+1", "1", "-2" and the unicode minus "−2"', () => {
    expect(parseBinInput("+1")).toEqual({ ok: true, value: 1 });
    expect(parseBinInput("1")).toEqual({ ok: true, value: 1 });
    expect(parseBinInput("-2")).toEqual({ ok: true, value: -2 });
    expect(parseBinInput("−2")).toEqual({ ok: true, value: -2 });
    expect(parseBinInput("  +12 ")).toEqual({ ok: true, value: 12 });
    expect(parseBinInput("-0")).toEqual({ ok: true, value: 0 });
  });

  it('rejects "" and "abc" (the field keeps its last valid value)', () => {
    expect(parseBinInput("")).toEqual({ ok: false, error: "empty" });
    expect(parseBinInput("+")).toEqual({ ok: false, error: "empty" });
    expect(parseBinInput("abc")).toEqual({ ok: false, error: "invalid" });
    expect(parseBinInput("1.5")).toEqual({ ok: false, error: "invalid" });
    expect(parseBinInput("+-1")).toEqual({ ok: false, error: "invalid" });
  });

  it("clamps out-of-range bins to the pool's bins and says which side", () => {
    const b = binBounds(spread);
    expect(b).toEqual({ min: -5, max: 5 });
    expect(clampBin(9, b)).toEqual({ value: 5, clamped: "max" });
    expect(clampBin(-40, b)).toEqual({ value: -5, clamped: "min" });
    expect(clampBin(3, b)).toEqual({ value: 3, clamped: null });
    expect(clampBin(99, null)).toEqual({ value: 99, clamped: null }); // no data yet: nothing to clamp to
  });

  it("edge labels: start = lower edge, end = upper edge", () => {
    expect(edgeLabel(spread, -2, "start")).toBe("#-2 = -0.02%");
    expect(edgeLabel(spread, 0, "end")).toBe("#0 = +0.01%");
  });
});

describe("presets on a concentrated pool", () => {
  it("80/90/95% all give #-2…#0 with their real coverage (96%), plus a note", () => {
    const o = presetOptions(concentrated);
    expect(o.slice(0, 3).map(presetSubLabel)).toEqual(["#-2…#0 (96%)", "#-2…#0 (96%)", "#-2…#0 (96%)"]);
    expect(concentrationNote(o)).toBe("This pool is concentrated: 3 bins hold 96% of volume, so these presets match.");
  });

  it("Wider is the 95% range + 2 bins each side, always distinct", () => {
    const o = presetOptions(concentrated);
    expect(widerRange(concentrated)).toEqual({ from: -4, to: 2 });
    expect(presetSubLabel(o[3])).toBe("#-4…#2 (99%)");
    expect(activePreset({ kind: "manual", from: -4, to: 2 }, concentrated)).toBe("wider");
    expect(activePreset({ kind: "manual", from: -4, to: 3 }, concentrated)).toBe("manual");
    expect(activePreset({ kind: "preset", share: 95 }, concentrated)).toBe(95);
  });

  it("Wider stays within the pool's bins", () => {
    const edge = pool([30, 30, 30, 2, 2, 2, 2, 2, 0, 0, 0]); // volume near the low edge
    const w = widerRange(edge);
    expect(w.from).toBeGreaterThanOrEqual(-5);
    expect(w.to).toBeLessThanOrEqual(5);
  });

  it("no note when presets differ; a partial match names the presets", () => {
    expect(concentrationNote(presetOptions(spread))).toBeNull();
    const o = presetOptions(spread).map((x) => (x.key === 90 ? { ...x, from: -1, to: 1, coverage: 0.7 } : x.key === 80 ? { ...x, from: -1, to: 1, coverage: 0.7 } : x));
    expect(concentrationNote(o)).toBe("This pool is concentrated: 3 bins hold 70% of volume, so the 80% and 90% presets match.");
  });
});

describe("tokens needed", () => {
  const usdg = { symbol: "USDG", fiatPrice: 1 };
  const spcx = { symbol: "SPCX", fiatPrice: 147.78 };
  it("shows each token's USD value and the total", () => {
    const n = tokenNeeds({ token0Usd: 33.33, token1Usd: 166.67, token0Amount: 33.33 / 147.78, token1Amount: 166.67 }, spcx, usdg);
    expect(n.text).toBe("166.67 USDG ≈ $166.67 + 0.22554 SPCX ≈ $33.33 · total $200.00");
    expect(n.parts.map((p) => p.side)).toEqual([1, 0]);
  });
  it('says "price n/a" when a token has no price', () => {
    const n = tokenNeeds({ token0Usd: 50, token1Usd: 150, token0Amount: 0, token1Amount: 150 }, { symbol: "SPCX", fiatPrice: null }, usdg);
    expect(n.text).toBe("150.00 USDG ≈ $150.00 + $50.00 of SPCX (price n/a) · total $200.00");
    expect(n.parts[1].amount).toBeNull();
  });
});
