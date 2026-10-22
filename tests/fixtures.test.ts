/**
 * Sanity checks against REAL Metric API data in tests/fixtures:
 * - *.bins.json: raw /analytics/bins responses (refresh with `npm run fixtures`)
 * - *.summary.json: per-bin totals [bin, swapCount, lpFeesFiat, avgLiquidityFiat, aprBps] for a known window
 * Our per-bin APR (dailyFees × 365 / liquidity) must match Metric's aprBps within ~1%.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { binPoolApr, estimateFromBins, getBin, parseBins, splitTokens } from "@/lib/calc";
import { parseChains } from "@/lib/normalize";
import type { RawBinsResponse, RawChainsResponse } from "@/lib/types";

const dir = join(__dirname, "fixtures");
const read = <T>(f: string): T => JSON.parse(readFileSync(join(dir, f), "utf8"));
const files = readdirSync(dir);

/** 1% relative, with a 0.5bp absolute floor for rounding on tiny APRs. */
function expectAprMatch(ours: number, aprBps: number, label: string) {
  const theirs = aprBps / 1e4;
  expect(Math.abs(ours - theirs), `${label}: ${ours} vs ${theirs}`).toBeLessThanOrEqual(Math.max(0.01 * theirs, 0.5e-4));
}

describe("real bins responses", () => {
  for (const f of files.filter((f) => f.endsWith(".bins.json"))) {
    const data = parseBins(read<RawBinsResponse>(f));

    it(`${f}: dailyFees×365/liq matches aprBps`, () => {
      expect(data.windowDays).toBeGreaterThan(0);
      const checked = data.bins.filter((b) => b.hasData && b.aprBps !== null && b.aprBps > 0 && b.liquidity > 0);
      expect(checked.length).toBeGreaterThan(0);
      for (const b of checked) expectAprMatch(binPoolApr(b), b.aprBps!, `bin ${b.idx}`);
    });
  }
});

describe("SKHYB/USDT 24h excerpt", () => {
  const data = parseBins(read<RawBinsResponse>("56-0xee90641E7c3b4d6338Ab7f1c23Dfb979FAb5f096-24h-excerpt.bins.json"));

  it("parses string bin/swapCount and a 1-day window", () => {
    expect(data.windowDays).toBe(1);
    expect(data.curBinIdx).toBe(-1);
    expect(getBin(data, -1).swapCount).toBe(3820);
    expect(getBin(data, -2).feesFiat).toBeCloseTo(815.561624 + 1032.376088, 6);
    expect(getBin(data, 14).hasData).toBe(true);
    expect(getBin(data, 14).pnlAprBps).toBeNull();
    expect(getBin(data, 5).hasData).toBe(false); // not in the excerpt
  });

  it("reserves confirm the token split: below → token1 only, above → token0 only, current → both", () => {
    const below = getBin(data, -2);
    expect(below.reserve0Fiat).toBe(0);
    expect(below.reserve1Fiat).toBeGreaterThan(0);
    const above = getBin(data, 0);
    expect(above.reserve1Fiat).toBe(0);
    expect(above.reserve0Fiat).toBeGreaterThan(0);
    const cur = splitTokens(getBin(data, -1), 1000, -1);
    expect(cur.token0Usd).toBeCloseTo((1000 * 206650.836671) / (206650.836671 + 400748.379476), 6);
    expect(splitTokens(below, 1000, -1)).toEqual({ token0Usd: 0, token1Usd: 1000 });
    expect(splitTokens(above, 1000, -1)).toEqual({ token0Usd: 1000, token1Usd: 0 });
  });
});

describe("SKHYB/USDT 7d per-bin totals", () => {
  const s = read<{ windowDays: number; rows: [number, number, number, number, number][] }>(
    "56-0xee90641E7c3b4d6338Ab7f1c23Dfb979FAb5f096-7d.summary.json",
  );
  for (const [bin, , fees, liq, aprBps] of s.rows) {
    it(`bin ${bin}: fees/windowDays×365/liq ≈ aprBps/10000`, () => {
      expectAprMatch(binPoolApr({ dailyFees: fees / s.windowDays, liquidity: liq }), aprBps, `bin ${bin}`);
    });
  }
});

describe("chains", () => {
  it("keys on chainId", () => {
    const m = parseChains(read<RawChainsResponse>("chains.json"));
    expect([...m.keys()]).toEqual([1, 56, 4663]);
    expect(m.get(56)).toBe("BSC");
  });
});

describe("SKHYB/USDT 24h excerpt: net APR", () => {
  const data = parseBins(read<RawBinsResponse>("56-0xee90641E7c3b4d6338Ab7f1c23Dfb979FAb5f096-24h-excerpt.bins.json"));
  it("negative pnlAprBps yields a negative net estimate", () => {
    const e = estimateFromBins(data, -2, -2, "uniform", 1, { token0: 1, token1: 1 });
    expect(e.netApr).toBeCloseTo(-3.9586, 3);
    expect(e.apr).toBeCloseTo(2.8904, 3);
  });
});
