import { describe, expect, it } from "vitest";
import { parseBins } from "@/lib/calc";
import { curatorName } from "@/lib/intent";
import { TYPE_TIMING, landingStats, trendingPools, typewriterText } from "@/lib/landing";
import { plannerHref, poolScore, searchActions, searchPools } from "@/lib/palette";
import { singleSideNote } from "@/lib/rangeInputs";
import { activeWindow, dragRange, idxFromX, keyRange, resizeRange, rulerWindow, volumeIntensity } from "@/lib/ruler";
import type { Pool, Tier } from "@/lib/types";

/** Synthetic pools (fake addresses). */
let n = 0;
function pool(pair: string, o: Partial<{ chainId: number; tvl: number; vol: number | null; fee: number | null; net: number | null; tier: Tier; priv: boolean; pause: number; status: string }> = {}): Pool {
  n++;
  const [a, b] = pair.split("/");
  return {
    chainId: o.chainId ?? 56,
    poolAddress: `0x${n.toString(16).padStart(40, "0")}`,
    pair,
    token0: { address: "0x1", symbol: a, decimals: 18, fiatPrice: 1 },
    token1: { address: "0x2", symbol: b, decimals: 18, fiatPrice: 1 },
    tvlFiat: o.tvl ?? 100_000,
    aprBps7d: o.fee === undefined ? 2_000 : o.fee,
    tradingPnlAprBps7d: o.net === undefined ? 1_000 : o.net,
    tier: o.tier ?? "green",
    isPrivate: o.priv ?? false,
    verifiedAdmin: true,
    adminUsername: null,
    priceProviderStatus: o.status ?? "healthy",
    pauseLevel: o.pause ?? 0,
    analytics24h: o.vol === null ? null : { fromTs: 0, toTs: 86400, feesFiat: 1, tvlFiat: o.tvl ?? 100_000, volumeFiat: o.vol ?? 10_000, aprBps: 100 },
  } as unknown as Pool;
}

describe("landing stats", () => {
  it("sums TVL and 24h volume; counts unpaused pools that traded today", () => {
    const s = landingStats([pool("A/B", { tvl: 1000, vol: 50 }), pool("C/D", { tvl: 2000, vol: 0 }), pool("E/F", { tvl: 3000, vol: 10, pause: 1 }), pool("G/H", { tvl: 0, vol: null })]);
    expect(s).toEqual({ tvl: 6000, vol24h: 60, activePools: 1 });
  });
});

describe("trending pools", () => {
  const bestNet = pool("NET/USDT", { fee: 3000, net: 2900, vol: 5_000 });
  const busy = pool("VOL/USDT", { fee: 900, net: 100, vol: 2_000_000, tier: "yellow" });
  const big = pool("BIG/USDT", { tvl: 9_000_000, fee: 500, net: 200, vol: 1_000 });
  const priceDriven = pool("PRC/USDT", { fee: 1000, net: 9000, vol: 9_000 }); // net > fee: not fee-driven
  const risky = pool("RSK/USDT", { fee: 9000, net: 8000, vol: 9_000_000, tier: "red" });
  const tiny = pool("TNY/USDT", { tvl: 5_000, fee: 9000, net: 8000 });
  const priv = pool("PRV/USDT", { fee: 9000, net: 8000, priv: true, tvl: 9_999_999 });
  const dead = pool("DED/USDT", { vol: 0, fee: 9000, net: 8999 });

  it("best net (fee-driven), highest 24h volume and safest (Best Practices, highest TVL), skipping risky/tiny/private/no-trade pools", () => {
    const t = trendingPools([bestNet, busy, big, priceDriven, risky, tiny, priv, dead]);
    expect(t.bestNet?.pair).toBe("NET/USDT");
    expect(t.topVolume?.pair).toBe("VOL/USDT");
    expect(t.safest?.pair).toBe("BIG/USDT");
  });

  it("prefers three different pools, but repeats one if it's the only candidate", () => {
    const solo = pool("ONE/USDT", { fee: 1000, net: 900, vol: 50_000 });
    const t = trendingPools([solo]);
    expect([t.bestNet?.pair, t.topVolume?.pair, t.safest?.pair]).toEqual(["ONE/USDT", "ONE/USDT", "ONE/USDT"]);
    const t2 = trendingPools([solo, pool("TWO/USDT", { fee: 500, net: 100, vol: 10, tvl: 50_000 })]);
    expect(t2.topVolume?.pair).toBe("TWO/USDT"); // ONE already won best net
  });

  it("nothing qualifies → nulls", () => {
    expect(trendingPools([risky, tiny])).toEqual({ bestNet: null, topVolume: null, safest: null, safestFallback: false });
  });
});

describe("auto-typing placeholder", () => {
  const t = { type: 10, erase: 5, hold: 100, gap: 50 };
  it("types, holds, erases, pauses, then the next sentence; loops", () => {
    expect(typewriterText(["abc", "xy"], 0, t)).toBe("a");
    expect(typewriterText(["abc", "xy"], 25, t)).toBe("abc");
    expect(typewriterText(["abc", "xy"], 60, t)).toBe("abc"); // holding
    expect(typewriterText(["abc", "xy"], 131, t)).toBe("ab"); // erasing
    expect(typewriterText(["abc", "xy"], 150, t)).toBe(""); // gap
    expect(typewriterText(["abc", "xy"], 195, t)).toBe("x"); // second sentence (first span = 30+100+15+50 = 195)
    const loop = 195 + 20 + 100 + 10 + 50;
    expect(typewriterText(["abc", "xy"], loop, t)).toBe("a");
    expect(typewriterText([], 10)).toBe("");
    expect(TYPE_TIMING.type).toBeGreaterThan(0);
  });
});

describe("bin ruler", () => {
  const data = parseBins({
    window: { fromTs: 0, toTs: 7 * 86400 },
    curBinIdx: 0,
    bins: [-3, -2, -1, 0, 1, 2, 3].map((i) => ({
      bin: String(i), swapCount: "1", lengthE6: 100,
      token0: { volumeFiat: i === 0 ? 100 : i === 1 ? 50 : 0, lpFeesFiat: 0, avgLiquidityFiat: i === 3 ? 0 : 500, reserveFiat: i === 3 ? 0 : 500 },
      token1: { volumeFiat: 0, lpFeesFiat: 0, avgLiquidityFiat: i === 3 ? 0 : 500, reserveFiat: i === 3 ? 0 : 500 },
      aprBps: 100, pnlAprBps: 50,
    })),
  });

  it("window covers the range and the active bin, at least 24 bins", () => {
    const w = rulerWindow(data, { from: 5, to: 8 });
    expect(w.lo).toBeLessThanOrEqual(0);
    expect(w.hi).toBeGreaterThanOrEqual(8);
    expect(w.hi - w.lo + 1).toBeGreaterThanOrEqual(24);
  });

  it("tint = volume share relative to the busiest bin", () => {
    const t = volumeIntensity(data, -3, 3);
    expect(t.get(0)).toBe(1);
    expect(t.get(1)).toBe(0.5);
    expect(t.get(-2)).toBe(0);
  });

  it("pointer x → bin, clamped", () => {
    expect(idxFromX(0, 100, -5, 4)).toBe(-5);
    expect(idxFromX(55, 100, -5, 4)).toBe(0);
    expect(idxFromX(500, 100, -5, 4)).toBe(4);
    expect(idxFromX(-20, 100, -5, 4)).toBe(-5);
  });

  it("click = 1 bin, drag either way, edge handles can't cross", () => {
    expect(dragRange(2, 2)).toEqual({ from: 2, to: 2 });
    expect(dragRange(2, -1)).toEqual({ from: -1, to: 2 });
    expect(resizeRange({ from: -2, to: 3 }, "from", -4)).toEqual({ from: -4, to: 3 });
    expect(resizeRange({ from: -2, to: 3 }, "from", 9)).toEqual({ from: 3, to: 3 });
    expect(resizeRange({ from: -2, to: 3 }, "to", -9)).toEqual({ from: -2, to: -2 });
  });

  it("keyboard: arrows move, Shift+arrows resize, bounds respected", () => {
    const r = { from: -1, to: 1 };
    expect(keyRange(r, "ArrowRight", false)).toEqual({ from: 0, to: 2 });
    expect(keyRange(r, "ArrowLeft", false)).toEqual({ from: -2, to: 0 });
    expect(keyRange(r, "ArrowRight", true)).toEqual({ from: -1, to: 2 });
    expect(keyRange(r, "ArrowLeft", true)).toEqual({ from: -1, to: 0 });
    expect(keyRange({ from: 0, to: 0 }, "ArrowLeft", true)).toEqual({ from: 0, to: 0 });
    expect(keyRange({ from: 2, to: 3 }, "ArrowRight", false, { min: -3, max: 3 })).toEqual({ from: 2, to: 3 });
    expect(keyRange(r, "Enter", false)).toBeNull();
  });

  it("histogram auto-zoom: bins with liquidity or volume ± 2, always including the range and active bin", () => {
    expect(activeWindow(data, { from: 0, to: 0 })).toEqual({ lo: -5, hi: 4 }); // liquidity in -3..2, bin 3 empty
    expect(activeWindow(data, { from: 6, to: 8 })).toEqual({ lo: -5, hi: 10 });
  });
});

describe("command palette search", () => {
  const ai = pool("AI/USDG", { chainId: 4663, tvl: 2_000 });
  const weth = pool("WETH/USDC", { chainId: 1, tvl: 5_000_000 });
  const sk = { ...pool("SKHYB/USDT", { chainId: 56, tvl: 50_000 }), poolAddress: "0xee90641e7c3b4d6338ab7f1c23dfb979fab5f096" } as Pool;
  const all = [ai, weth, sk];
  it("matches pair, token, chain and address; every word must match", () => {
    expect(searchPools(all, "ai/usdg")[0]).toBe(ai);
    expect(searchPools(all, "ai-usdg")[0]).toBe(ai);
    expect(searchPools(all, "usdc")[0]).toBe(weth);
    expect(searchPools(all, "skh")[0]).toBe(sk);
    expect(searchPools(all, "eth weth")).toEqual([weth]);
    expect(searchPools(all, "rh")).toEqual([ai]);
    expect(searchPools(all, sk.poolAddress.slice(0, 10))[0]).toBe(sk);
    expect(searchPools(all, "doge")).toEqual([]);
    expect(poolScore(ai, "")).toBe(0);
  });
  it("empty query → largest pools first", () => {
    expect(searchPools(all, "")).toEqual([weth, sk, ai]);
  });
  it("quick actions and planner links", () => {
    expect(searchActions("top").map((a) => a.href)).toEqual(["/pools"]);
    expect(searchActions("").length).toBe(4);
    expect(plannerHref(sk)).toBe(`/?chain=56&pool=${sk.poolAddress}`);
  });
});

describe("curator display", () => {
  it("name, else short address, else 'curator'", () => {
    expect(curatorName({ adminUsername: "metricdao", admin: "0x80aa000000000000000000000000000000004f" })).toBe("metricdao");
    expect(curatorName({ adminUsername: null, admin: "0x80aa000000000000000000000000000000004f" })).toBe("0x80…4f");
    expect(curatorName({ adminUsername: null, admin: null })).toBe("curator");
  });
});

describe("review fixes", () => {
  it("palette: 'nvda' finds NVDAB/USDT on BNB by TVL among symbol-prefix matches, hides $0 pools", () => {
    const big = pool("NVDAB/USDT", { chainId: 56, tvl: 1_000_000 });
    const rh = [pool("NVDA/USDG", { chainId: 4663, tvl: 5_000 }), pool("NVDA/USDG", { chainId: 4663, tvl: 0 }), pool("NVDA/WETH", { chainId: 4663, tvl: 0 })];
    const zeros = Array.from({ length: 9 }, () => pool("NVDA/USDG", { chainId: 4663, tvl: 0 }));
    const out = searchPools([...zeros, ...rh, big], "nvda");
    expect(out[0]).toBe(big);
    expect(out.map((p) => p.pair)).toEqual(["NVDAB/USDT", "NVDA/USDG"]);
    expect(out.every((p) => p.tvlFiat > 0)).toBe(true);
    // only $0 pools match → shown anyway
    expect(searchPools(zeros, "nvda").length).toBe(9);
    // substring inside a symbol still matches (lower tier)
    expect(searchPools([big], "vdab")).toEqual([big]);
    expect(poolScore(big, "nvda")).toBeGreaterThan(poolScore(big, "vdab")!);
  });

  it("histogram zoom ignores dust far from the price (< 1% of the largest bin)", () => {
    const bins = [-50, -10, -1, 0, 1, 25].map((i) => ({
      bin: String(i), swapCount: "1", lengthE6: 100,
      token0: { volumeFiat: i === 0 ? 100 : 0, lpFeesFiat: 0, avgLiquidityFiat: Math.abs(i) >= 10 ? 1 : 5_000, reserveFiat: 0 },
      token1: { volumeFiat: 0, lpFeesFiat: 0, avgLiquidityFiat: Math.abs(i) >= 10 ? 1 : 5_000, reserveFiat: 0 },
      aprBps: 1, pnlAprBps: 1,
    }));
    const d = parseBins({ window: { fromTs: 0, toTs: 7 * 86400 }, curBinIdx: 0, bins });
    expect(activeWindow(d, { from: 0, to: 0 })).toEqual({ lo: -3, hi: 3 });
    expect(d.minIdx).toBe(-50); // "Show all bins" still has the full span
  });

  it("single-token note: above → only token0, below → only token1, straddling → none", () => {
    expect(singleSideNote(-6, -3, -9, "SKHYB", "USDT")).toBe(
      "Your range is entirely above the current price (active #-9), so it's funded only with SKHYB. It earns once price moves into it.",
    );
    expect(singleSideNote(-15, -12, -9, "SKHYB", "USDT")).toBe(
      "Your range is entirely below the current price (active #-9), so it's funded only with USDT. It earns once price moves into it.",
    );
    expect(singleSideNote(-10, -9, -9, "SKHYB", "USDT")).toBeNull();
  });

  it("'Safest' needs net APR ≥ 0; otherwise the largest Best Practices pool, flagged as a fallback", () => {
    const losing = pool("WETH/USDG", { tvl: 5_000_000, fee: 500, net: -2_473, vol: 1_000 });
    const ok = pool("OK/USDT", { tvl: 200_000, fee: 500, net: 100, vol: 1_000 });
    const t = trendingPools([losing, ok]);
    expect(t.safest?.pair).not.toBe("WETH/USDG");
    expect(t.safestFallback).toBe(false);
    const t2 = trendingPools([losing]);
    expect(t2.safest?.pair).toBe("WETH/USDG");
    expect(t2.safestFallback).toBe(true);
  });
});
