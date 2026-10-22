import { describe, expect, it } from "vitest";
import {
  binNetDaily,
  binPoolApr,
  estimateFromBins,
  estimateFromPool,
  fmtBinPct,
  getBin,
  parseBins,
  planText,
  poolWindowDailyFees,
  presetRange,
  projectFees,
  splitTokens,
  strategyWeights,
  windowDays,
} from "@/lib/calc";
import type { RawBin, RawBinsResponse } from "@/lib/types";

/** Synthetic bin: fees/liquidity chosen so aprBps is consistent with Metric's definition. */
function bin(i: number, vol: number, fees: number, liq: number, days: number, extra: Partial<RawBin> = {}): RawBin {
  return {
    bin: String(i),
    swapCount: "10",
    totalShares: "1000",
    lengthE6: 100,
    token0: { volumeFiat: vol / 2, lpFeesFiat: fees / 2, avgLiquidityFiat: liq / 2, reserveFiat: liq / 2 },
    token1: { volumeFiat: vol / 2, lpFeesFiat: fees / 2, avgLiquidityFiat: liq / 2, reserveFiat: liq / 2 },
    aprBps: liq > 0 ? Math.round(((fees / days) * 365 * 1e4) / liq) : 0,
    pnlAprBps: null,
    ...extra,
  };
}

const DAYS = 5.5; // a young pool: window shorter than the 7d period
const raw: RawBinsResponse = {
  window: { fromTs: 1_700_000_000, toTs: 1_700_000_000 + DAYS * 86400 },
  curBinIdx: -1,
  bins: [
    bin(-3, 100, 0.1, 5000, DAYS),
    bin(-2, 1000, 1, 10000, DAYS),
    bin(-1, 5000, 5, 20000, DAYS, {
      token0: { volumeFiat: 2500, lpFeesFiat: 2.5, avgLiquidityFiat: 10000, reserveFiat: 2500 },
      token1: { volumeFiat: 2500, lpFeesFiat: 2.5, avgLiquidityFiat: 10000, reserveFiat: 7500 },
    }),
    bin(0, 3000, 3, 20000, DAYS),
    bin(1, 800, 0.8, 10000, DAYS),
    bin(3, 100, 0.1, 5000, DAYS, { lengthE6: 300 }), // wider bin; bin 2 missing
  ],
};

describe("parseBins", () => {
  const data = parseBins(raw);

  it("computes the window length from timestamps, not the period", () => {
    expect(data.windowDays).toBeCloseTo(DAYS, 9);
    expect(windowDays({ fromTs: 1_792_612_553, toTs: 1_792_612_553 + 14.02 * 86400 })).toBeCloseTo(14.02);
  });

  it("bin i spans [i·w, (i+1)·w] with w = lengthE6/1e6", () => {
    expect(getBin(data, 0).lowPct).toBeCloseTo(0);
    expect(getBin(data, 0).highPct).toBeCloseTo(0.01);
    expect(getBin(data, -1).lowPct).toBeCloseTo(-0.01);
    expect(getBin(data, -8).lowPct).toBeCloseTo(-0.08);
    expect(getBin(data, -8).midPct).toBeCloseTo(-0.075);
    expect(fmtBinPct(getBin(data, 7).midPct)).toBe("+0.07500%"); // matches the official app "#7 · +0.07500%"
    expect(fmtBinPct(getBin(data, -8).midPct)).toBe("-0.07500%");
    // bin 3 uses its own width (300 → 0.03%); missing bins use the most common width
    expect(getBin(data, 3).lowPct).toBeCloseTo(0.09);
    expect(getBin(data, 3).highPct).toBeCloseTo(0.12);
    expect(getBin(data, 2).lowPct).toBeCloseTo(0.02);
    expect(getBin(data, 2).hasData).toBe(false);
  });

  it("sums fees and liquidity across both tokens, falling back to reserves", () => {
    const b = getBin(data, -1);
    expect(b.feesFiat).toBeCloseTo(5);
    expect(b.liquidity).toBeCloseTo(20000);
    const r = parseBins({
      ...raw,
      bins: [
        bin(0, 1, 1, 0, DAYS, {
          token0: { lpFeesFiat: 0, reserveFiat: 300, avgLiquidityFiat: 0 },
          token1: { lpFeesFiat: 0, reserveFiat: 700, avgLiquidityFiat: 0 },
        }),
      ],
    });
    expect(getBin(r, 0).liquidity).toBe(1000);
  });
});

describe("fee model", () => {
  const data = parseBins(raw);

  it("per-bin APR with U→0 matches Metric's aprBps", () => {
    for (const b of data.bins.filter((b) => b.hasData && b.liquidity > 0)) {
      expect(binPoolApr(b)).toBeCloseTo(b.aprBps! / 1e4, 3);
    }
  });

  it("user fees: Σ dailyFees × U/(liq+U), APR = daily × 365 / deposit", () => {
    const est = estimateFromBins(data, -2, 0, "uniform", 3000, { token0: 2, token1: 1 });
    const expected = [1, 5, 3].reduce((a, fees, k) => {
      const liq = [10000, 20000, 20000][k];
      return a + (fees / DAYS) * (1000 / (liq + 1000));
    }, 0);
    expect(est.dailyFees).toBeCloseTo(expected, 10);
    expect(est.apr).toBeCloseTo((expected * 365) / 3000, 10);
    // tiny deposit → APR approaches the liquidity-weighted pool APR
    const tiny = estimateFromBins(data, 0, 0, "uniform", 1e-6, { token0: 1, token1: 1 });
    expect(tiny.apr).toBeCloseTo(binPoolApr(getBin(data, 0)), 6);
  });

  it("splits tokens: below → token1, above → token0, current → reserve ratio", () => {
    const est = estimateFromBins(data, -2, 0, "uniform", 3000, { token0: 2, token1: 1 });
    const [below, cur, above] = est.positions;
    expect(below.token0Usd).toBe(0);
    expect(below.token1Usd).toBeCloseTo(1000);
    expect(above.token1Usd).toBe(0);
    expect(above.token0Amount).toBeCloseTo(500); // $1000 at $2
    expect(cur.token0Usd).toBeCloseTo(250); // reserves 2500 : 7500
    expect(cur.token1Usd).toBeCloseTo(750);
    expect(est.token0Usd + est.token1Usd).toBeCloseTo(3000);
    expect(splitTokens(getBin(data, 50), 10, -1)).toEqual({ token0Usd: 10, token1Usd: 0 });
  });

  it("pool-level fallback uses analytics24h.feesFiat / analytics24h.tvlFiat", () => {
    const a24 = { fromTs: 0, toTs: 86400, feesFiat: 100, tvlFiat: 99000, volumeFiat: 0, aprBps: 0 };
    const a = estimateFromPool({ analytics24h: a24 }, 1000)!;
    expect(a.source).toBe("pool");
    expect(a.dailyFees).toBeCloseTo(1);
    // tiny deposit → APR ≈ feesFiat × 365 / tvlFiat
    expect(estimateFromPool({ analytics24h: a24 }, 1e-6)!.apr).toBeCloseTo((100 * 365) / 99000, 6);
    // a 12h window doubles the daily rate
    expect(estimateFromPool({ analytics24h: { ...a24, toTs: 43200 } }, 1000)!.dailyFees).toBeCloseTo(2);
    expect(estimateFromPool({ analytics24h: null }, 1000)).toBeNull();
  });

  it("projects simple and compounded fees", () => {
    const p = projectFees(1, 1000, 30);
    expect(p.simple).toBe(30);
    expect(p.compounded).toBeCloseTo(1000 * (1.001 ** 30 - 1));
    expect(p.compounded).toBeGreaterThan(p.simple);
  });
});

describe("ranges and strategies", () => {
  const data = parseBins(raw);

  it("presets pick the smallest contiguous range around the current bin", () => {
    // total volume 10000; current bin -1 has 5000
    expect(presetRange(data, 0.5)).toEqual({ from: -1, to: -1 });
    expect(presetRange(data, 0.8)).toEqual({ from: -1, to: 0 }); // 8000
    expect(presetRange(data, 0.9)).toEqual({ from: -2, to: 0 }); // 9000
    expect(presetRange(data, 0.95)).toEqual({ from: -2, to: 1 }); // 9800
    expect(presetRange({ ...data, bins: data.bins.map((b) => ({ ...b, volumeFiat: 0 })) }, 0.9)).toBeNull();
  });

  it("strategy weights sum to 1 and have the right shape", () => {
    const bins = [-3, -2, -1, 0, 1].map((i) => getBin(data, i));
    for (const s of ["uniform", "curve", "fee"] as const) {
      const w = strategyWeights(bins, s, -1);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    }
    const curve = strategyWeights(bins, "curve", -1);
    expect(Math.max(...curve)).toBe(curve[2]);
    expect(curve[1]).toBeCloseTo(curve[3]);
    const fee = strategyWeights(bins, "fee", -1);
    expect(fee[2] / fee[1]).toBeCloseTo((5 / 20000) / (1 / 10000));
    // all-zero fees fall back to uniform
    expect(strategyWeights([getBin(data, 40), getBin(data, 41)], "fee", -1)).toEqual([0.5, 0.5]);
  });

  it("renders the copyable bin plan", () => {
    const flat = parseBins({ ...raw, bins: raw.bins.filter((b) => b.bin !== "3") });
    expect(planText(flat, -8, 7)).toBe(
      ["Start bin: #-8 = -0.075%", "End bin:   #7  = +0.075%", "16 bins · 0.01% each · active bin #-1"].join("\n"),
    );
  });
});

describe("formatting", () => {
  it("formats token amounts to ~cent precision given a price", async () => {
    const { fmtAmount } = await import("@/lib/calc");
    expect(fmtAmount(812.4, 1)).toBe("812.40");
    expect(fmtAmount(6.123456, 132.7)).toBe("6.12346");
    expect(fmtAmount(0.0123456789, 60000)).toBe("0.0123457");
  });
});

describe("net APR (trading PnL, fees included)", () => {
  // bin -1: 36.5% net on $20k → +$20/day; bin 0: -73% net on $10k → -$20/day; bin 1: no pnl data.
  const netRaw: RawBinsResponse = {
    window: { fromTs: 0, toTs: 7 * 86400 },
    curBinIdx: -1,
    bins: [
      bin(-1, 1000, 7, 20000, 7, { pnlAprBps: 3650 }),
      bin(0, 1000, 7, 10000, 7, { pnlAprBps: -7300 }),
      bin(1, 1000, 7, 10000, 7, { pnlAprBps: null }),
    ],
  };
  const data = parseBins(netRaw);

  it("pool-level net/day per bin = pnlAprBps/10000 × liq / 365", () => {
    expect(binNetDaily(getBin(data, -1))).toBeCloseTo(20);
    expect(binNetDaily(getBin(data, 0))).toBeCloseTo(-20);
    expect(binNetDaily(getBin(data, 1))).toBe(0);
  });

  it("positive range: user share applied like fees", () => {
    const e = estimateFromBins(data, -1, -1, "uniform", 1000, { token0: 1, token1: 1 });
    expect(e.netDaily).toBeCloseTo(20 * (1000 / 21000), 10);
    expect(e.netApr).toBeCloseTo((e.netDaily! * 365) / 1000, 10);
    expect(e.netSkippedBins).toBe(0);
    // tiny deposit → bin net APR approaches pnlAprBps / 10000
    const tiny = estimateFromBins(data, -1, -1, "uniform", 1e-6, { token0: 1, token1: 1 });
    expect(tiny.positions[0].netApr).toBeCloseTo(0.365, 6);
  });

  it("negative range: losses outweigh, null bins are skipped", () => {
    const e = estimateFromBins(data, -1, 1, "uniform", 3000, { token0: 1, token1: 1 });
    const expected = 20 * (1000 / 21000) - 20 * (1000 / 11000);
    expect(e.netDaily).toBeCloseTo(expected, 10);
    expect(e.netDaily!).toBeLessThan(0);
    expect(e.netApr!).toBeLessThan(0);
    expect(e.netApr).toBeCloseTo((expected * 365) / 3000, 10);
    expect(e.netSkippedBins).toBe(1);
    expect(e.positions[2].netApr).toBeNull();
    expect(e.positions[1].netApr).toBeCloseTo(-0.73 * (10000 / 11000), 10);
    // the fee estimate is unaffected and positive
    expect(e.apr).toBeGreaterThan(0);
  });

  it("is null when no bin in range has pnl data, and for the pool-level fallback", () => {
    expect(estimateFromBins(data, 1, 1, "uniform", 1000, { token0: 1, token1: 1 }).netApr).toBeNull();
    const a24 = { fromTs: 0, toTs: 86400, feesFiat: 100, tvlFiat: 99000, volumeFiat: 0, aprBps: 0 };
    expect(estimateFromPool({ analytics24h: a24 }, 1000)!.netApr).toBeNull();
  });

  it("pool avg fees/day over the window sums every bin", () => {
    expect(poolWindowDailyFees(data)).toBeCloseTo(3);
  });
});

describe("axis ticks and APR formatting", () => {
  it("picks a consistent nice tick step", async () => {
    const { tickStep } = await import("@/lib/calc");
    expect(tickStep(20, 30)).toBe(1); // every bin fits
    expect(tickStep(45, 30)).toBe(2);
    expect(tickStep(61, 20)).toBe(5);
    expect(tickStep(160, 10)).toBe(20);
    expect(tickStep(10, 0)).toBe(10);
  });

  it("formats net APR with 2 decimals and thousands separators", async () => {
    const { fmtAprFixed } = await import("@/lib/calc");
    expect(fmtAprFixed(10.99)).toBe("1,099.00%");
    expect(fmtAprFixed(-3.9586)).toBe("-395.86%");
    expect(fmtAprFixed(0.05)).toBe("5.00%");
    expect(fmtAprFixed(null)).toBe("—");
  });
});
