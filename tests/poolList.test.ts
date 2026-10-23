import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFS,
  filterSortPools,
  isInactivePool,
  pickerParams,
  poolApr,
  readPickerPrefs,
  serializePrefs,
  toggleSort,
  withPickerParams,
  type PickerPrefs,
} from "@/lib/poolList";
import type { Pool } from "@/lib/types";

/** Synthetic pools (addresses are fake). */
function pool(n: number, pair: string, chainId: number, tvl: number, apr7d: number | null, apr24h: number | null): Pool {
  return {
    chainId,
    poolAddress: `0x${String(n).padStart(40, "0")}`,
    pair,
    token0: { symbol: pair.split("/")[0], fiatPrice: 1 },
    token1: { symbol: pair.split("/")[1], fiatPrice: 1 },
    tvlFiat: tvl,
    aprBps7d: apr7d,
    analytics24h: apr24h === null ? null : { fromTs: 0, toTs: 86400, feesFiat: 1, tvlFiat: tvl, volumeFiat: 1, aprBps: apr24h },
  } as unknown as Pool;
}
const POOLS = [
  pool(1, "AAA/USDT", 56, 2_000_000, 1000, 3000),
  pool(2, "BBB/USDT", 1, 50_000, 5000, null), // no 24h analytics
  pool(3, "CCC/USDC", 56, 5_000, 9000, 9000), // under $10k
  pool(4, "DDD/USDT", 4663, 300_000, null, 500), // no 7d APR
  pool(5, "EEE/USDT", 1, 150_000, 2000, 100),
];
const pairs = (p: PickerPrefs, q = "") => filterSortPools(POOLS, p, q).pools.map((x) => x.pair.slice(0, 3));

describe("pool picker sorting & filters", () => {
  it("defaults: TVL ≥ $10k, TVL high → low", () => {
    expect(pairs(DEFAULT_PREFS)).toEqual(["AAA", "DDD", "EEE", "BBB"]);
    expect(filterSortPools(POOLS, DEFAULT_PREFS).total).toBe(5); // "Showing 4 of 5 pools"
  });

  it("TVL floors", () => {
    expect(pairs({ ...DEFAULT_PREFS, minTvl: 0 })).toHaveLength(5);
    expect(pairs({ ...DEFAULT_PREFS, minTvl: 1e5 })).toEqual(["AAA", "DDD", "EEE"]);
    expect(pairs({ ...DEFAULT_PREFS, minTvl: 1e6 })).toEqual(["AAA"]);
  });

  it("APR follows the period; pools without a value show null and sort last in both directions", () => {
    expect(poolApr(POOLS[0], "7d")).toBeCloseTo(0.1);
    expect(poolApr(POOLS[0], "24h")).toBeCloseTo(0.3);
    expect(poolApr(POOLS[1], "24h")).toBeNull();
    expect(poolApr(POOLS[3], "7d")).toBeNull();
    const p7: PickerPrefs = { ...DEFAULT_PREFS, sort: "apr", dir: "desc", minTvl: 0 };
    expect(pairs(p7)).toEqual(["CCC", "BBB", "EEE", "AAA", "DDD"]);
    expect(pairs({ ...p7, dir: "asc" })).toEqual(["AAA", "EEE", "BBB", "CCC", "DDD"]);
    const p24: PickerPrefs = { ...p7, period: "24h" };
    expect(pairs(p24)).toEqual(["CCC", "AAA", "DDD", "EEE", "BBB"]);
    expect(pairs({ ...p24, dir: "asc" })).toEqual(["EEE", "DDD", "AAA", "CCC", "BBB"]);
  });

  it("pair and chain sorts, chain filter, search", () => {
    expect(pairs({ ...DEFAULT_PREFS, sort: "pair", dir: "desc" })).toEqual(["EEE", "DDD", "BBB", "AAA"]);
    expect(pairs({ ...DEFAULT_PREFS, sort: "chain", dir: "asc" }).length).toBe(4);
    expect(pairs({ ...DEFAULT_PREFS, chain: 1 })).toEqual(["EEE", "BBB"]);
    expect(pairs({ ...DEFAULT_PREFS, minTvl: 0 }, "usdc")).toEqual(["CCC"]);
  });

  it("clicking a header: same column flips, a new column starts at its natural direction", () => {
    const a = toggleSort(DEFAULT_PREFS, "tvl");
    expect([a.sort, a.dir]).toEqual(["tvl", "asc"]);
    const b = toggleSort(a, "apr");
    expect([b.sort, b.dir]).toEqual(["apr", "desc"]);
    const c = toggleSort(b, "pair");
    expect([c.sort, c.dir]).toEqual(["pair", "asc"]);
  });
});

describe("pool picker persistence", () => {
  const custom: PickerPrefs = { sort: "apr", dir: "asc", period: "24h", minTvl: 1e6, chain: 56, showInactive: true };

  it("URL round trip; defaults write nothing", () => {
    expect(pickerParams(DEFAULT_PREFS).toString()).toBe("");
    const q = pickerParams(custom);
    expect(q.toString()).toBe("psort=apr&pdir=asc&papr=24h&ptvl=1m&pchain=56&pinactive=1");
    expect(readPickerPrefs(q, null)).toEqual(custom);
    expect(withPickerParams("chain=56&amount=1", custom)).toBe("chain=56&amount=1&psort=apr&pdir=asc&papr=24h&ptvl=1m&pchain=56&pinactive=1");
    expect(withPickerParams("chain=56", DEFAULT_PREFS)).toBe("chain=56");
  });

  it("URL wins over storage; storage used when the URL has no picker params", () => {
    const stored = serializePrefs(custom);
    expect(readPickerPrefs(new URLSearchParams("chain=56"), stored)).toEqual(custom);
    expect(readPickerPrefs(new URLSearchParams("papr=24h"), stored)).toEqual({ ...DEFAULT_PREFS, period: "24h" });
  });

  it("invalid or corrupt values fall back to defaults", () => {
    expect(readPickerPrefs(new URLSearchParams("psort=evil&pdir=x&papr=1y&ptvl=5&pchain=999"), null)).toEqual(DEFAULT_PREFS);
    expect(readPickerPrefs(new URLSearchParams(""), "{not json")).toEqual(DEFAULT_PREFS);
    expect(readPickerPrefs(new URLSearchParams(""), null)).toEqual(DEFAULT_PREFS);
  });
});

describe("inactive pools", () => {
  // TEST/WETH-like: 0 swaps in 24h and 7d, tiny TVL.
  const dead = pool(10, "TST/WETH", 1, 3_000, 0, null);
  const deadNo24h = { ...pool(11, "TSU/WETH", 1, 9_000, null, 0), analytics24h: { fromTs: 0, toTs: 86400, feesFiat: 0, tvlFiat: 9000, volumeFiat: 0, aprBps: 0 } } as Pool;
  const bigIdle = pool(12, "BIG/WETH", 1, 500_000, 0, 0); // no trades but ≥ $10k TVL → not inactive
  const smallBusy = pool(13, "SML/WETH", 1, 2_000, 4000, 4000); // small but trading → not inactive
  const list = [...POOLS, dead, deadNo24h, bigIdle, smallBusy];

  it("no 7d volume and TVL < $10k", () => {
    expect([dead, deadNo24h, bigIdle, smallBusy].map(isInactivePool)).toEqual([true, true, false, false]);
  });

  it("hidden by default even with TVL = Any; 'Show inactive pools' brings them back; combines with search", () => {
    const any: PickerPrefs = { ...DEFAULT_PREFS, minTvl: 0 };
    const names = (p: PickerPrefs, q = "") => filterSortPools(list, p, q).pools.map((x) => x.pair);
    expect(names(any)).not.toContain("TST/WETH");
    expect(names(any)).toContain("SML/WETH");
    expect(names({ ...any, showInactive: true })).toEqual(expect.arrayContaining(["TST/WETH", "TSU/WETH"]));
    expect(names({ ...any, showInactive: true }, "weth")).toHaveLength(4);
    expect(names(any, "weth")).toEqual(["BIG/WETH", "SML/WETH"]);
    expect(filterSortPools(list, any).total).toBe(9);
  });

  it("the toggle round-trips through the URL", () => {
    expect(readPickerPrefs(new URLSearchParams("pinactive=1"), null).showInactive).toBe(true);
    expect(readPickerPrefs(new URLSearchParams("pinactive=yes"), null).showInactive).toBe(false);
  });
});
