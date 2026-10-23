import { describe, expect, it } from "vitest";
import { tradeBadge } from "@/lib/activity";
import { bestPerRow, comparableMetrics, noTradesColumnText, verdictsWithDuplicates, type ScenarioMetrics } from "@/lib/compare";
import { NO_TRADES_LABEL, insights, poolHadNoTrades } from "@/lib/portfolio/model";
import { highlights, type RankRow } from "@/lib/ranking";

describe("No trades badge rule", () => {
  it("no badge when the pool traded in the last 24h", () => {
    expect(tradeBadge(1, 0)).toBeNull();
    expect(tradeBadge(1, null)).toBeNull();
    expect(tradeBadge(0.01, 1200)).toBeNull();
  });
  it('"No trades" when 24h volume is 0 (or missing) but the 7d fee APR is positive', () => {
    expect(tradeBadge(0, 1200)).toBe("No trades");
    expect(tradeBadge(null, 0.4)).toBe("No trades");
    expect(tradeBadge(undefined, 5)).toBe("No trades");
  });
  it('"No trades 7d" when the 7d fee APR is 0 or missing too (TEST/WETH)', () => {
    expect(tradeBadge(0, 0)).toBe("No trades 7d");
    expect(tradeBadge(0, null)).toBe("No trades 7d");
    expect(tradeBadge(null, undefined)).toBe("No trades 7d");
  });
});

/** Synthetic scenario metrics; a no-trade column has ~0 everywhere (and would "win" low-is-better rows). */
function m(o: Partial<ScenarioMetrics>): ScenarioMetrics {
  return {
    from: 0, to: 0, bins: 1, widthPct: 0.01, volumeCovered: 0.8, share: 0.1, feeApr: 1, feesSimple: 10, feesCompounded: 10.1,
    netApr: 0.5, netUsd: 5, priceDrag: 0.5, token0Amount: 0, token1Amount: 0, token0Usd: 0, token1Usd: 0, idle: [], ...o,
  };
}

describe("Compare: no-trade column", () => {
  const a = m({ feeApr: 0.6, netApr: 0.2, priceDrag: 0.4, share: 0.02 });
  const b = m({ feeApr: 0.5, netApr: 0.3, priceDrag: 0.2, share: 0.03 });
  const dead = m({ feeApr: 0, netApr: 0, priceDrag: 0, volumeCovered: null, share: 0.5, feesSimple: 0, feesCompounded: 0, netUsd: 0, idle: [1, 2, 3] });

  it("warning text names the period", () => {
    expect(noTradesColumnText("7d")).toBe("No trades in the last 7d: no fees to estimate");
    expect(noTradesColumnText("24h")).toBe("No trades in the last 24h: no fees to estimate");
  });

  it("is excluded from best-value highlighting", () => {
    const naive = bestPerRow([a, b, dead]);
    expect(naive.priceDrag).toEqual([2]); // without the rule, the dead pool "wins" price drag and share
    expect(naive.share).toEqual([2]);
    const best = bestPerRow(comparableMetrics([a, b, dead], [false, false, true]));
    expect(best.priceDrag).toEqual([1]);
    expect(best.share).toEqual([1]);
    expect(best.feeApr).toEqual([0]);
    expect(Object.values(best).some((ix) => ix.includes(2))).toBe(false);
  });

  it("gets no verdict and doesn't change the others'", () => {
    const v = verdictsWithDuplicates(comparableMetrics([a, b, dead], [false, false, true]), [null, null, null]);
    expect(v[2]).toBeNull();
    expect(v.slice(0, 2)).toEqual(verdictsWithDuplicates([a, b], [null, null]));
  });

  it("a single comparable column gets no highlights", () => {
    const best = bestPerRow(comparableMetrics([a, dead], [false, true]));
    expect(Object.values(best).every((ix) => ix.length === 0)).toBe(true);
  });
});

describe("Top pools: highlights skip no-trade pools", () => {
  const row = (pair: string, o: Partial<RankRow>): RankRow => ({
    chainId: 1, pool: "0x" + "1".repeat(40), pair, token0: { symbol: "A" }, token1: { symbol: "B" }, tier: "green", isPrivate: false,
    verified: true, healthy: true, paused: false, tvl: 100_000, vol24h: 10_000, fees24h: 10, feeApr: 0.2, netApr: 0.1, priceDrag: 0.1, efficiency: 0.1, ...o,
  });
  it("a no-trade pool can't be best net, the trap or most efficient", () => {
    const h = highlights([
      row("LIVE/USDT", { feeApr: 0.2, netApr: 0.15 }),
      row("DEAD/USDT", { vol24h: 0, feeApr: 0.9, netApr: 0.9, efficiency: 0 }),
      row("DEADTRAP/USDT", { vol24h: null, feeApr: 3, netApr: -1 }),
    ]);
    expect(h.bestNet?.pair).toBe("LIVE/USDT");
    expect(h.trap).toBeNull();
    expect(h.mostEfficient?.pair).toBe("LIVE/USDT");
  });
});

describe("Portfolio: no trades in the window", () => {
  const bin = (idx: number) => ({ idx, share: 0.1, valueUsd: 10, feesUsd: 0, dailyFeesUsd: 0, netUsd: null, aprBps: 0, pnlAprBps: 0 });
  it("detects a window with no volume", () => {
    expect(poolHadNoTrades([{ volumeFiat: 0 }, { volumeFiat: 0 }])).toBe(true);
    expect(poolHadNoTrades([{ volumeFiat: 0 }, { volumeFiat: 3 }])).toBe(false);
    expect(poolHadNoTrades([])).toBe(false);
    expect(NO_TRADES_LABEL).toBe("No trades: earning nothing");
  });
  it("explains it in the first insight instead of listing every bin as idle", () => {
    const list = insights({ bins: [bin(0), bin(1), bin(2)], curBinIdx: 1, status: "in", pnlUsd: 0, pnlApprox: false, noTrades: true, windowDays: 7 });
    expect(list[0]).toEqual({
      tone: "warn",
      text: "Nobody traded in this pool in the last 7d, so your liquidity earned no fees, in range or not. Fees only come from swaps; consider a more active pool.",
    });
    expect(list.some((i) => /idle/.test(i.text))).toBe(false);
    expect(list.some((i) => i.tone === "good")).toBe(false);
  });
  it("young pools name their real window", () => {
    expect(insights({ bins: [bin(0)], curBinIdx: 0, status: "in", pnlUsd: 0, pnlApprox: false, noTrades: true, windowDays: 1.2 })[0].text).toMatch(/last 29h/);
  });
});
