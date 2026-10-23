import { describe, expect, it } from "vitest";
import { estimateFromBins, parseBins, projectFees } from "@/lib/calc";
import {
  DEFAULT_SCENARIOS,
  bestPerRow,
  computeScenario,
  decodeScenarios,
  encodeScenarios,
  idleBins,
  liquidityShare,
  resolveRange,
  resolveRanges,
  scenarioTitle,
  verdictsWithDuplicates,
  type Scenario,
  verdicts,
  volumeCovered,
  type ScenarioMetrics,
} from "@/lib/compare";
import { compareOgQuery, freezeCompareSnapshot, parseCompareSnapshot } from "@/lib/share";
import type { RawBinsResponse } from "@/lib/types";

/** Synthetic pool: bins -5..5, price at 0, volume concentrated near 0; bins ±5 never traded. */
const VOL = [0, 50, 200, 800, 3000, 6000, 3000, 800, 100, 50, 0]; // total 14000
function raw(): RawBinsResponse {
  return {
    window: { fromTs: 0, toTs: 7 * 86400 },
    curBinIdx: 0,
    bins: VOL.map((v, i) => {
      const idx = i - 5;
      const liq = 1000;
      return {
        bin: String(idx),
        swapCount: "1",
        lengthE6: 100,
        token0: { volumeFiat: v / 2, lpFeesFiat: (v * 0.001) / 2, avgLiquidityFiat: liq / 2, reserveFiat: idx >= 0 ? liq : 0 },
        token1: { volumeFiat: v / 2, lpFeesFiat: (v * 0.001) / 2, avgLiquidityFiat: liq / 2, reserveFiat: idx <= 0 ? liq : 0 },
        aprBps: Math.round(((v * 0.001) / 7) * 365 * 1e4 / liq),
        pnlAprBps: idx < -2 ? -20_000 : Math.round(((v * 0.001) / 7) * 365 * 1e4 / liq) - 50,
      };
    }),
  };
}
const data = parseBins(raw());
const prices = { token0: 2, token1: 1 };

describe("range metrics", () => {
  it("volume covered = share of the window's volume traded inside the range", () => {
    expect(volumeCovered(data, 0, 0)).toBeCloseTo(6000 / 14000, 12);
    expect(volumeCovered(data, -1, 1)).toBeCloseTo(12000 / 14000, 12);
    expect(volumeCovered(data, -5, 5)).toBeCloseTo(1, 12);
    expect(volumeCovered(data, 20, 30)).toBe(0); // outside the returned bins
    const empty = parseBins({ ...raw(), bins: raw().bins.map((b) => ({ ...b, token0: { ...b.token0, volumeFiat: 0 }, token1: { ...b.token1, volumeFiat: 0 } })) });
    expect(volumeCovered(empty, -1, 1)).toBeNull();
  });

  it("idle bins: ~0 volume (≤ 0.1% of the window) inside the range", () => {
    expect(idleBins(data, -5, 5)).toEqual([-5, 5]); // the two bins that never traded
    expect(idleBins(data, -1, 1)).toEqual([]);
    expect(idleBins(data, 4, 7)).toEqual([5, 6, 7]); // 6, 7 aren't in the data → no volume
    // threshold ≈ 0.1% of the window total (~14): a bin trading 10 is idle, one trading 20 isn't
    const withBin4 = (v: number) =>
      parseBins({ ...raw(), bins: raw().bins.map((b) => (b.bin === "4" ? { ...b, token0: { ...b.token0, volumeFiat: v / 2 }, token1: { ...b.token1, volumeFiat: v / 2 } } : b)) });
    expect(idleBins(withBin4(10), 4, 4)).toEqual([4]);
    expect(idleBins(withBin4(20), 4, 4)).toEqual([]);
  });

  it("your share of liquidity in the range", () => {
    expect(liquidityShare(data, 0, 0, 1000)).toBeCloseTo(0.5, 12);
    expect(liquidityShare(data, -1, 1, 1000)).toBeCloseTo(0.25, 12);
    expect(liquidityShare(data, 0, 0, 0)).toBe(0);
  });

  it("presets resolve via calc.presetRange (80/90/95)", () => {
    const r = DEFAULT_SCENARIOS.map((s) => resolveRange(s, data));
    expect(r[0]).toEqual({ from: -1, to: 1 }); // 12000/14000 = 85.7% ≥ 80%
    expect(r[1].to - r[1].from).toBeGreaterThanOrEqual(r[0].to - r[0].from);
    expect(r[2].to - r[2].from).toBeGreaterThanOrEqual(r[1].to - r[1].from);
    expect(resolveRange({ range: { kind: "manual", from: -3, to: 1 }, strategy: "uniform" }, data)).toEqual({ from: -3, to: 1 });
  });

  it("computeScenario reuses the planner's estimate and projection", () => {
    const m = computeScenario(data, { from: -1, to: 1 }, "uniform", 3000, 30, prices);
    const e = estimateFromBins(data, -1, 1, "uniform", 3000, prices);
    expect(m.feeApr).toBe(e.apr);
    expect(m.feesSimple).toBeCloseTo(projectFees(e.dailyFees, 3000, 30).simple, 12);
    expect(m.feesCompounded).toBeCloseTo(projectFees(e.dailyFees, 3000, 30).compounded, 12);
    expect(m.netUsd).toBeCloseTo(e.netDaily! * 30, 12);
    expect(m.priceDrag).toBeCloseTo(e.apr - e.netApr!, 12);
    expect(m.bins).toBe(3);
    expect(m.widthPct).toBeCloseTo(0.03, 12);
    expect(m.token0Usd + m.token1Usd).toBeCloseTo(3000, 9);
  });
});

function metrics(o: Partial<ScenarioMetrics>): ScenarioMetrics {
  return {
    from: 0, to: 0, bins: 1, widthPct: 0.01, volumeCovered: 0.8, share: 0.1, feeApr: 1, feesSimple: 10, feesCompounded: 10.1,
    netApr: 0.5, netUsd: 5, priceDrag: 0.5, token0Amount: 0, token1Amount: 0, token0Usd: 0, token1Usd: 0, idle: [], ...o,
  };
}

describe("best per row", () => {
  it("highlights the best value per row, lower-is-better for drag and idle bins, ties included", () => {
    const list = [
      metrics({ feeApr: 3, netApr: 0.2, priceDrag: 2.8, volumeCovered: 0.8, idle: [] }),
      metrics({ feeApr: 2, netApr: 0.9, priceDrag: 1.1, volumeCovered: 0.9, idle: [4] }),
      metrics({ feeApr: 1, netApr: 0.9, priceDrag: 0.1, volumeCovered: 0.95, idle: [] }),
    ];
    const b = bestPerRow(list);
    expect(b.feeApr).toEqual([0]);
    expect(b.netApr).toEqual([1, 2]);
    expect(b.priceDrag).toEqual([2]);
    expect(b.volumeCovered).toEqual([2]);
    expect(b.idle).toEqual([0, 2]);
  });

  it("no highlight when values are all equal, only one value, or missing", () => {
    const b = bestPerRow([metrics({ netApr: null, priceDrag: null }), metrics({ netApr: 0.4, priceDrag: null }), null]);
    expect(b.feeApr).toEqual([]); // all equal
    expect(b.netApr).toEqual([]); // only one value present
    expect(b.priceDrag).toEqual([]);
  });
});

describe("verdicts", () => {
  it("narrow: highest fees but lowest coverage; wide: safest; best net named", () => {
    const v = verdicts([
      metrics({ feeApr: 3, volumeCovered: 0.8, netApr: 0.4 }),
      metrics({ feeApr: 2, volumeCovered: 0.9, netApr: 0.7 }),
      metrics({ feeApr: 1, volumeCovered: 0.95, netApr: 0.3 }),
    ]);
    expect(v[0]).toBe("Highest fees, but only 80% of volume: earns nothing if price drifts");
    expect(v[1]).toBe("Best net");
    expect(v[2]).toBe("Safest: 95% of volume, lower APR");
  });

  it("negative net and idle bins; up to two phrases; balanced when nothing stands out", () => {
    const v = verdicts([
      metrics({ feeApr: 2, volumeCovered: 0.9, netApr: -0.3, idle: [5, 6] }),
      metrics({ feeApr: 1, volumeCovered: 0.9, netApr: 0.1 }),
    ]);
    expect(v[0]).toBe("Highest fees · Net negative: price moves outweighed fees here");
    expect(v[1]).toBe("Best net");
    expect(verdicts([metrics({ netApr: 0.2 })])).toEqual(["Balanced"]);
    expect(verdicts([metrics({ netApr: 0.2, idle: [3] })])).toEqual(["1 idle bin: liquidity there earned ~nothing"]);
    expect(verdicts([null, metrics({})])[0]).toBeNull();
  });
});

describe("URL encoding of scenarios", () => {
  it("round-trips presets, manual ranges, strategies and a pool override", () => {
    const list = [
      { range: { kind: "manual" as const, from: -3, to: 1 }, strategy: "uniform" as const },
      { range: { kind: "preset" as const, share: 90 as const }, strategy: "curve" as const },
      { range: { kind: "manual" as const, from: -8, to: 6 }, strategy: "fee" as const, pool: { chainId: 1, address: "0x" + "ab".repeat(20) } },
    ];
    const s = encodeScenarios(list);
    expect(s).toBe(`-3:1:u,p90:c,-8:6:f:1:0x${"ab".repeat(20)}`);
    expect(decodeScenarios(s)).toEqual(list);
    expect(decodeScenarios("-3:1:u,-5:3:u,-8:6:c")?.map((x) => x.range)).toEqual([
      { kind: "manual", from: -3, to: 1 },
      { kind: "manual", from: -5, to: 3 },
      { kind: "manual", from: -8, to: 6 },
    ]);
  });

  it("drops invalid entries, caps at 3, swaps reversed ranges, null when empty", () => {
    expect(decodeScenarios("1:-3:u")?.[0].range).toEqual({ kind: "manual", from: -3, to: 1 });
    expect(decodeScenarios("p85:u,x:y:u,-1:1:z,1:2:u:137:0x" + "a".repeat(40), )).toBeNull();
    expect(decodeScenarios("p80:u,p90:u,p95:u,p80:c")).toHaveLength(3);
    expect(decodeScenarios("p80:u,garbage")).toHaveLength(1);
    expect(decodeScenarios("")).toBeNull();
    expect(decodeScenarios(null)).toBeNull();
  });
});

describe("compare snapshot", () => {
  const NOW = Date.UTC(2026, 9, 23, 12);
  it("round-trips columns and rejects arbitrary text or malformed values", () => {
    const f = freezeCompareSnapshot(
      {
        pair: "SKHYB/USDT",
        chainId: 56,
        days: 30,
        date: "2026-10-23",
        cols: [
          { from: -1, to: 1, feeApr: 412.345, netApr: -12.3, fees: 101.234, pair: null },
          { from: -5, to: 3, feeApr: 230, netApr: null, fees: 56.7, pair: "WEIRD PAIR/X" },
        ],
      },
      NOW,
    )!;
    expect(f.cols[0]).toEqual({ from: -1, to: 1, feeApr: 412.35, netApr: -12.3, fees: 101.23, pair: null });
    expect(f.cols[1].pair).toBeNull(); // dropped, didn't validate
    const qs = compareOgQuery(f);
    expect(parseCompareSnapshot(new URLSearchParams(qs), NOW)).toEqual(f);
    for (const bad of [
      "cp=FREE%20MONEY%2FX&cdays=30&ca1=0&cb1=1&cf1=1&ce1=1&sd=2026-10-23",
      "cdays=30&ca1=0&cb1=1&cf1=abc&ce1=1&sd=2026-10-23",
      "cdays=30&ca1=0.5&cb1=1&cf1=1&ce1=1&sd=2026-10-23",
      "cdays=99999&ca1=0&cb1=1&cf1=1&ce1=1&sd=2026-10-23",
      "cdays=30&ca1=0&cb1=1&cf1=1&ce1=1&ca3=0&cb3=1&cf3=1&ce3=1&sd=2026-10-23",
      "cdays=30&ca1=0&cb1=1&cf1=1&sd=2026-10-23",
      "cdays=30&ca1=0&cb1=1&cf1=1&ce1=1&cc=137&sd=2026-10-23",
    ]) {
      expect(parseCompareSnapshot(new URLSearchParams(bad), NOW), bad).toBeNull();
    }
    expect(compareOgQuery(null)).toBe("kind=compare&v=2");
  });
});

describe("compare page URL state", () => {
  it("keeps the planner params and encodes scenarios in cmp; defaults to 80/90/95", async () => {
    const { readCompareState, writeCompareState } = await import("@/lib/compare");
    const d = readCompareState(new URLSearchParams("chain=56&pool=0x" + "1".repeat(40) + "&amount=500&days=60&period=30d"));
    expect(d).toMatchObject({ chain: 56, amount: 500, days: 60, period: "30d" });
    expect(d.scenarios).toEqual(DEFAULT_SCENARIOS);
    const qs = writeCompareState({ ...d, scenarios: decodeScenarios("-3:1:u,-5:3:u,-8:6:c")! });
    expect(qs).toContain("cmp=-3%3A1%3Au%2C-5%3A3%3Au%2C-8%3A6%3Ac");
    expect(readCompareState(new URLSearchParams(qs)).scenarios).toHaveLength(3);
  });
});

describe("distinct default ranges in concentrated pools", () => {
  /** Same shape as the main fixture, with custom per-bin volume (bins -5..5, price at 0). */
  const concentrated = (vol: number[]) =>
    parseBins({ ...raw(), bins: raw().bins.map((b, i) => ({ ...b, token0: { ...b.token0, volumeFiat: vol[i] / 2 }, token1: { ...b.token1, volumeFiat: vol[i] / 2 } })) });
  const items = (d: ReturnType<typeof parseBins>, list: Scenario[], keys?: string[]) => list.map((scenario, i) => ({ scenario, data: d, key: keys?.[i] ?? "56:0xpool" }));
  const span = (r: { from: number; to: number } | null) => (r ? [r.from, r.to] : null);

  it("90% and 95% presets coincide → C is B widened by 2 bins each side", () => {
    const d = concentrated([0, 0, 0, 10, 1500, 8000, 480, 5, 5, 0, 0]); // bin 0 = 80%, bins -1..0 = 95%
    expect(resolveRange(DEFAULT_SCENARIOS[1], d)).toEqual(resolveRange(DEFAULT_SCENARIOS[2], d)); // the live bug
    const r = resolveRanges(items(d, DEFAULT_SCENARIOS));
    expect(r.map(span)).toEqual([[0, 0], [-1, 0], [-3, 2]]);
    expect(r[1]!.widened).toBe(0); // the real 90% preset is already strictly wider than A
    expect(r[2]).toMatchObject({ widened: 2, widenedFrom: 1, sameAs: null });
    expect(scenarioTitle(DEFAULT_SCENARIOS[2], r[2])).toBe("Wide (+2 bins each side)");
    expect(scenarioTitle(DEFAULT_SCENARIOS[1], r[1])).toBe("Medium");
    expect(new Set(r.map((x) => `${x!.from}:${x!.to}`)).size).toBe(3);
  });

  it("all three presets coincide → A, A ± 1, (A ± 1) ± 2; active bin stays inside", () => {
    const d = concentrated([0, 0, 0, 0, 20, 9960, 20, 0, 0, 0, 0]);
    const r = resolveRanges(items(d, DEFAULT_SCENARIOS));
    expect(r.map(span)).toEqual([[0, 0], [-1, 1], [-3, 3]]);
    expect(scenarioTitle(DEFAULT_SCENARIOS[1], r[1])).toBe("Medium (+1 bin each side)");
    for (const x of r) expect(x!.from <= d.curBinIdx && d.curBinIdx <= x!.to).toBe(true);
  });

  it("keeps real presets when they're already strictly wider (normal pool)", () => {
    const r = resolveRanges(items(data, DEFAULT_SCENARIOS));
    expect(r.map(span)).toEqual(DEFAULT_SCENARIOS.map((s) => span(resolveRange(s, data))));
    expect(r.every((x) => x!.widened === 0)).toBe(true);
  });

  it("a preset equal to an earlier manual range is widened 1 bin per side until distinct", () => {
    const d = concentrated([0, 0, 0, 10, 1500, 8000, 480, 5, 5, 0, 0]);
    const list: Scenario[] = [
      { range: { kind: "manual", from: -1, to: 0 }, strategy: "uniform" },
      { range: { kind: "manual", from: -2, to: 1 }, strategy: "uniform" },
      { range: { kind: "preset", share: 90 }, strategy: "uniform" }, // preset gives -1..0 = A, then -2..1 = B
    ];
    const r = resolveRanges(items(d, list));
    expect(span(r[2])).toEqual([-3, 2]);
    expect(r[2]).toMatchObject({ widened: 2, widenedFrom: 0 });
  });

  it("different pools never collapse each other", () => {
    const d = concentrated([0, 0, 0, 0, 20, 9960, 20, 0, 0, 0, 0]);
    const r = resolveRanges(items(d, [DEFAULT_SCENARIOS[0], DEFAULT_SCENARIOS[0]], ["56:0xa", "56:0xb"]));
    expect(r.map(span)).toEqual([[0, 0], [0, 0]]);
    expect(r[1]!.sameAs).toBeNull();
  });

  it("manual duplicates get 'Same range as X' instead of repeated verdicts", () => {
    const list: Scenario[] = [
      { range: { kind: "manual", from: -1, to: 1 }, strategy: "uniform" },
      { range: { kind: "manual", from: -1, to: 1 }, strategy: "uniform" },
      { range: { kind: "manual", from: -5, to: 5 }, strategy: "uniform" },
    ];
    const r = resolveRanges(items(data, list));
    expect(r.map((x) => x!.sameAs)).toEqual([null, 0, null]);
    expect(span(r[1])).toEqual([-1, 1]); // manual picks are never moved
    const m = r.map((x, i) => computeScenario(data, x!, list[i].strategy, 1000, 30, prices));
    const v = verdictsWithDuplicates(m, r);
    expect(v[1]).toBe("Same range as A");
    expect(v[0]).toBe(verdicts([m[0], null, m[2]])[0]);
  });

  it("unloaded scenarios resolve to null and are skipped", () => {
    const r = resolveRanges([null, { scenario: DEFAULT_SCENARIOS[1], data, key: "k" }]);
    expect(r[0]).toBeNull();
    expect(r[1]!.widened).toBe(0);
  });
});
