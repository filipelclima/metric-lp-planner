import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  filterRows,
  fmtPostPct,
  highlights,
  planUrl,
  readRankingState,
  sortRows,
  toRow,
  topByNet,
  weeklyPost,
  writeRankingState,
  type RankRow,
} from "@/lib/ranking";
import type { Pool, Tier } from "@/lib/types";

/** Synthetic pool (no real addresses). APRs in bps like the API. */
function pool(
  n: number,
  o: Partial<{ pair: string; chainId: number; tier: Tier; tvl: number; fee: number | null; net: number | null; vol: number | null; verified: boolean; status: Pool["priceProviderStatus"]; pause: number; priv: boolean }> = {},
): Pool {
  const addr = `0x${n.toString(16).padStart(40, "0")}`;
  const pair = o.pair ?? `T${n}/USDT`;
  return {
    chainId: o.chainId ?? 56,
    poolAddress: addr,
    pair,
    token0: { address: addr, symbol: pair.split("/")[0], decimals: 18, fiatPrice: 1 },
    token1: { address: addr, symbol: "USDT", decimals: 18, fiatPrice: 1 },
    tvlFiat: o.tvl ?? 100_000,
    aprBps7d: o.fee === undefined ? 1000 : o.fee,
    tradingPnlAprBps7d: o.net === undefined ? 500 : o.net,
    curBinIdx: 0,
    tier: o.tier ?? "green",
    reasonCodes: [],
    isPrivate: o.priv ?? false,
    verifiedAdmin: o.verified ?? true,
    adminUsername: null,
    priceProviderStatus: o.status ?? "healthy",
    priceProviderCooldown: { value: null, never: true },
    pauseLevel: o.pause ?? 0,
    lockedPricing: false,
    spreadAdminFeeE6: 0,
    spreadProtocolFeeE6: 0,
    stopLoss: null,
    analytics24h: o.vol === null ? null : { fromTs: 0, toTs: 86400, feesFiat: (o.vol ?? 50_000) * 0.0005, tvlFiat: o.tvl ?? 100_000, volumeFiat: o.vol ?? 50_000, aprBps: 0 },
  };
}

describe("rows", () => {
  it("converts bps, never adds fee and net, and derives price drag and efficiency", () => {
    const r = toRow(pool(1, { fee: 10_800, net: 6_010, tvl: 200_000, vol: 500_000 }));
    expect(r.feeApr).toBeCloseTo(1.08);
    expect(r.netApr).toBeCloseTo(0.601);
    expect(r.priceDrag).toBeCloseTo(1.08 - 0.601);
    expect(r.efficiency).toBeCloseTo(2.5);
    expect(toRow(pool(2, { net: null })).priceDrag).toBeNull();
    expect(toRow(pool(3, { vol: null })).efficiency).toBeNull();
    expect(toRow(pool(4, { tvl: 0 })).efficiency).toBeNull();
  });
});

describe("filters", () => {
  const rows: RankRow[] = [
    pool(1, { tier: "green" }),
    pool(2, { tier: "red" }),
    pool(3, { tier: "black" }),
    pool(4, { tier: "yellow", chainId: 1 }),
    pool(5, { tvl: 800, net: 9_000_000, fee: 9_500_000 }), // absurd APR on a tiny pool
    pool(6, { verified: false }),
    pool(7, { pause: 1 }),
    pool(8, { status: "feed_down" }),
    pool(9, { priv: true }),
  ].map(toRow);
  const pairs = (rs: RankRow[]) => rs.map((r) => r.pair);

  it("defaults: hide High Risk, min TVL $25k, active pools only", () => {
    expect(pairs(filterRows(rows, DEFAULT_FILTERS))).toEqual(["T1/USDT", "T4/USDT", "T6/USDT"]);
  });

  it("the tiny pool's absurd APR is excluded by default and back with min TVL 0", () => {
    expect(topByNet(filterRows(rows, DEFAULT_FILTERS))[0].pair).not.toBe("T5/USDT");
    expect(topByNet(filterRows(rows, { ...DEFAULT_FILTERS, minTvl: 0 }))[0].pair).toBe("T5/USDT");
  });

  it("chain, tier, verified-only and show-all", () => {
    expect(pairs(filterRows(rows, { ...DEFAULT_FILTERS, chain: 1 }))).toEqual(["T4/USDT"]);
    expect(pairs(filterRows(rows, { ...DEFAULT_FILTERS, tier: "best-practices" }))).toEqual(["T1/USDT", "T6/USDT"]);
    expect(pairs(filterRows(rows, { ...DEFAULT_FILTERS, tier: "all" }))).toEqual(["T1/USDT", "T2/USDT", "T3/USDT", "T4/USDT", "T6/USDT"]);
    expect(pairs(filterRows(rows, { ...DEFAULT_FILTERS, verifiedOnly: true }))).toEqual(["T1/USDT", "T4/USDT"]);
    expect(pairs(filterRows(rows, { ...DEFAULT_FILTERS, showAll: true }))).toEqual(["T1/USDT", "T4/USDT", "T6/USDT", "T7/USDT", "T8/USDT", "T9/USDT"]);
  });
});

describe("sorting", () => {
  const rows = [
    pool(1, { net: 500, fee: 900, tvl: 50_000, pair: "BBB/USDT", tier: "yellow" }),
    pool(2, { net: -300, fee: 4000, tvl: 300_000, pair: "aaa/USDT", tier: "green" }),
    pool(3, { net: null, fee: 100, tvl: 90_000, pair: "CCC/USDT" }),
    pool(4, { net: 2000, fee: 2100, tvl: 70_000, pair: "DDD/USDT", tier: "red" }),
  ].map(toRow);
  const order = (key: Parameters<typeof sortRows>[1], dir: "asc" | "desc") => sortRows(rows, key, dir).map((r) => r.pair);

  it("default is net APR descending; missing values always last", () => {
    expect(order("netApr", "desc")).toEqual(["DDD/USDT", "BBB/USDT", "aaa/USDT", "CCC/USDT"]);
    expect(order("netApr", "asc")).toEqual(["aaa/USDT", "BBB/USDT", "DDD/USDT", "CCC/USDT"]);
  });

  it("pair (case-insensitive), tier (best first), TVL, price drag", () => {
    expect(order("pair", "asc")).toEqual(["aaa/USDT", "BBB/USDT", "CCC/USDT", "DDD/USDT"]);
    expect(order("tier", "desc")[0]).toBe("aaa/USDT");
    expect(order("tier", "desc").at(-1)).toBe("DDD/USDT");
    expect(order("tvl", "desc")).toEqual(["aaa/USDT", "CCC/USDT", "DDD/USDT", "BBB/USDT"]);
    expect(order("priceDrag", "desc")).toEqual(["aaa/USDT", "BBB/USDT", "DDD/USDT", "CCC/USDT"]);
  });
});

describe("highlights", () => {
  it("best net (fee-driven), the trap (highest fee APR with negative net) and most efficient", () => {
    const rows = [
      pool(1, { net: 1200, fee: 1500, vol: 10_000 }), // most efficient among non-negative net
      pool(2, { net: -400, fee: 9000, vol: 20_000 }), // the trap
      pool(3, { net: -50, fee: 3000, vol: 900_000 }), // highest vol/TVL but negative net: excluded
      pool(4, { net: 3000, fee: 3100, vol: 0 }), // best fee-driven net; zero volume can't be "efficient"
    ].map(toRow);
    const h = highlights(rows);
    expect(h.bestNet?.pair).toBe("T4/USDT");
    expect(h.trap?.pair).toBe("T2/USDT");
    expect(h.mostEfficient?.pair).toBe("T1/USDT");
  });

  it("best net skips price-driven pools (QNT/USDC-like: net 372% on 37% fees)", () => {
    const rows = [pool(1, { pair: "QNT/USDC", net: 37_200, fee: 3_700 }), pool(2, { pair: "NVDAB/USDT", net: 6_010, fee: 10_800 })].map(toRow);
    expect(highlights(rows).bestNet?.pair).toBe("NVDAB/USDT");
    // net between fee and 1.5× fee: not flagged, but not fee-driven either
    expect(highlights([pool(3, { net: 1_200, fee: 1_000 })].map(toRow)).bestNet).toBeNull();
    // net exactly equal to fee counts as fee-driven
    expect(highlights([pool(4, { net: 1_000, fee: 1_000 })].map(toRow)).bestNet?.pair).toBe("T4/USDT");
  });

  it("most efficient never picks the trap (WETH/USDG-like: highest vol/TVL, net −306%)", () => {
    const rows = [
      pool(1, { pair: "WETH/USDG", net: -30_600, fee: 25_000, vol: 5_000_000, tvl: 100_000 }),
      pool(2, { pair: "AAPLB/USDT", net: 1_500, fee: 1_800, vol: 300_000, tvl: 1_200_000 }),
      pool(3, { pair: "NONET/USDT", net: null, fee: 900, vol: 200_000, tvl: 400_000 }),
    ].map(toRow);
    const h = highlights(rows);
    expect(h.trap?.pair).toBe("WETH/USDG");
    expect(h.mostEfficient?.pair).toBe("NONET/USDT"); // 0.5× beats 0.25×; unknown net isn't excluded
    expect(h.mostEfficient?.pair).not.toBe(h.trap?.pair);
  });

  it("no trap when every net APR is positive", () => {
    expect(highlights([pool(1), pool(2)].map(toRow)).trap).toBeNull();
    expect(highlights([])).toEqual({ bestNet: null, trap: null, mostEfficient: null });
  });
});

describe("weekly post", () => {
  it("top 5 by net APR from the filtered rows, in the expected format", () => {
    const rows = [
      pool(1, { pair: "NVDAB/USDT", net: 6010, fee: 10_800 }),
      pool(2, { pair: "SKHYB/USDT", net: 4000, fee: 5000 }),
      pool(3, { pair: "A/USDT", net: 100, fee: 200 }),
      pool(4, { pair: "B/USDT", net: 200, fee: null }),
      pool(5, { pair: "C/USDT", net: -100, fee: 300 }),
      pool(6, { pair: "D/USDT", net: 50, fee: 60 }),
      pool(7, { pair: "E/USDT", net: null, fee: 99_000 }),
    ].map(toRow);
    expect(weeklyPost(rows, { url: "metric-lp-planner.vercel.app/pools" })).toBe(
      [
        "Top 5 @metricxyz pools by NET APR (7d, fees + price moves):",
        "1. NVDAB/USDT 60.1% (fee 108%)",
        "2. SKHYB/USDT 40.0% (fee 50.0%)",
        "3. B/USDT 2.0% (fee n/a)",
        "4. A/USDT 1.0% (fee 2.0%)",
        "5. D/USDT 0.5% (fee 0.6%)",
        "Plan your bins → metric-lp-planner.vercel.app/pools",
        "Historical data, not financial advice.",
      ].join("\n"),
    );
    expect(weeklyPost(rows.slice(0, 2), { url: "x", chainName: "BNB Chain" }).split("\n")[0]).toBe(
      "Top 2 @metricxyz pools on BNB Chain by NET APR (7d, fees + price moves):",
    );
    expect(fmtPostPct(-1.234)).toBe("-123%");
  });
});

describe("links and URL state", () => {
  it("plan link opens the planner with the pool", () => {
    expect(planUrl({ chainId: 56, pool: "0xabc" })).toBe("/?chain=56&pool=0xabc&amount=1000&days=30&preset=90&strategy=uniform&period=7d");
  });

  it("round-trips filters and sort, omitting defaults", () => {
    expect(writeRankingState(DEFAULT_FILTERS, { key: "netApr", dir: "desc" })).toBe("");
    const qs = writeRankingState({ chain: 56, tier: "all", minTvl: 0, verifiedOnly: true, showAll: true }, { key: "efficiency", dir: "asc" });
    expect(readRankingState(new URLSearchParams(qs))).toEqual({
      filters: { chain: 56, tier: "all", minTvl: 0, verifiedOnly: true, showAll: true },
      sort: { key: "efficiency", dir: "asc" },
    });
    expect(readRankingState(new URLSearchParams("chain=9&tier=x&minTvl=7&sort=zzz")).filters).toEqual(DEFAULT_FILTERS);
  });
});

describe("price-driven chip", () => {
  it("flags net APR above 1.5× fee APR", async () => {
    const { isPriceDriven, isFeeDriven, PRICE_DRIVEN_RATIO } = await import("@/lib/ranking");
    expect(PRICE_DRIVEN_RATIO).toBe(1.5);
    expect(isPriceDriven({ feeApr: 0.37, netApr: 3.72 })).toBe(true); // QNT/USDC
    expect(isPriceDriven({ feeApr: 1, netApr: 1.5 })).toBe(false); // boundary: not above
    expect(isPriceDriven({ feeApr: 1, netApr: 1.5001 })).toBe(true);
    expect(isPriceDriven({ feeApr: 1.08, netApr: 0.601 })).toBe(false);
    expect(isPriceDriven({ feeApr: 0, netApr: 0.1 })).toBe(true); // no fees at all
    expect(isPriceDriven({ feeApr: null, netApr: 2 })).toBe(false);
    expect(isPriceDriven({ feeApr: 1, netApr: null })).toBe(false);
    expect(isFeeDriven({ feeApr: 1.08, netApr: 0.601 })).toBe(true);
    expect(isFeeDriven({ feeApr: 0.37, netApr: 3.72 })).toBe(false);
  });
});
