import { readFileSync } from "node:fs";
import { join } from "node:path";
import { encodeAbiParameters, encodeEventTopics, pad, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { LIQUIDITY_ADDED, LIQUIDITY_ADDED_TOPIC, LIQUIDITY_REMOVED, LIQUIDITY_REMOVED_TOPIC } from "@/lib/portfolio/abi";
import {
  calibrateScale,
  decodeLiquidityLog,
  groupPositions,
  hodlValue,
  insights,
  rangeStatus,
  replanUrl,
  runs,
  shareOf,
  valueBins,
  weightedApr,
  type BinInput,
  type RawLog,
} from "@/lib/portfolio/model";

// Synthetic addresses only.
const WALLET = "0x1111111111111111111111111111111111111111" as const;
const POOL = "0x2222222222222222222222222222222222222222" as const;
const OTHER = "0x3333333333333333333333333333333333333333" as const;

function makeLog(
  kind: "add" | "remove",
  pool: Hex,
  salt: bigint,
  rows: { bin: number; d0: bigint; d1: bigint; shares: bigint }[],
  block = 100n,
): RawLog {
  const ev = kind === "add" ? LIQUIDITY_ADDED : LIQUIDITY_REMOVED;
  const topics = encodeEventTopics({ abi: [ev], eventName: ev.name, args: { provider: WALLET, salt } }) as Hex[];
  const data = encodeAbiParameters(
    [{ type: "int256[]" }, { type: "tuple[]", components: [{ type: "int256", name: "delta0Scaled" }, { type: "int256", name: "delta1Scaled" }] }, { type: "uint256[]" }],
    [rows.map((r) => BigInt(r.bin)), rows.map((r) => ({ delta0Scaled: r.d0, delta1Scaled: r.d1 })), rows.map((r) => r.shares)],
  );
  return { address: pool, topics, data, blockNumber: `0x${block.toString(16)}` };
}

describe("log decoding", () => {
  it("topic0 constants match the event signatures", () => {
    expect(encodeEventTopics({ abi: [LIQUIDITY_ADDED], eventName: "LiquidityAdded" })[0]).toBe(LIQUIDITY_ADDED_TOPIC);
    expect(encodeEventTopics({ abi: [LIQUIDITY_REMOVED], eventName: "LiquidityRemoved" })[0]).toBe(LIQUIDITY_REMOVED_TOPIC);
  });

  it("decodes dynamic arrays, tuples and negative bins", () => {
    const log = makeLog("add", POOL, 7n, [
      { bin: -300, d0: 0n, d1: 5n * 10n ** 18n, shares: 123n },
      { bin: -1, d0: 2n * 10n ** 18n, d1: 3n * 10n ** 18n, shares: 456n },
      { bin: 32767, d0: 1n, d1: 0n, shares: 2n ** 200n },
    ]);
    expect(log.topics[1]).toBe(pad(WALLET).toLowerCase());
    const e = decodeLiquidityLog(log)!;
    expect(e).toMatchObject({ kind: "add", pool: POOL, provider: WALLET, salt: 7n, bins: [-300, -1, 32767], blockNumber: 100n });
    expect(e.delta1[0]).toBe(5n * 10n ** 18n);
    expect(e.shares[2]).toBe(2n ** 200n);
  });

  it("decodes removals with negative deltas and ignores unrelated or malformed logs", () => {
    const r = decodeLiquidityLog(makeLog("remove", POOL, 7n, [{ bin: -1, d0: -10n, d1: -20n, shares: 5n }]))!;
    expect(r).toMatchObject({ kind: "remove", delta0: [-10n], delta1: [-20n] });
    expect(decodeLiquidityLog({ address: POOL, topics: [pad("0x01")], data: "0x", blockNumber: "0x1" })).toBeNull();
    expect(decodeLiquidityLog({ ...makeLog("add", POOL, 1n, [{ bin: 0, d0: 1n, d1: 1n, shares: 1n }]), data: "0x1234" })).toBeNull();
  });
});

describe("positions", () => {
  const events = [
    makeLog("add", POOL, 1n, [{ bin: -2, d0: 0n, d1: 100n, shares: 10n }, { bin: 0, d0: 50n, d1: 0n, shares: 10n }], 200n),
    makeLog("add", POOL, 1n, [{ bin: 3, d0: 30n, d1: 0n, shares: 3n }], 150n),
    makeLog("remove", POOL, 1n, [{ bin: 0, d0: -20n, d1: 0n, shares: 4n }], 300n),
    makeLog("add", POOL, 2n, [{ bin: 5, d0: 1n, d1: 0n, shares: 1n }]),
    makeLog("add", OTHER, 1n, [{ bin: 0, d0: 1n, d1: 1n, shares: 1n }]),
  ].map((l) => decodeLiquidityLog(l)!);

  it("groups by (pool, salt), unions bins, nets |Δ| adds minus removes, keeps the first block", () => {
    const ps = groupPositions(events, new Set([POOL]));
    expect(ps).toHaveLength(2);
    const p = ps.find((x) => x.salt === 1n)!;
    expect(p.bins).toEqual([-2, 0, 3]);
    expect(p.net0Scaled).toBe(50n + 30n - 20n);
    expect(p.net1Scaled).toBe(100n);
    expect(p.firstBlock).toBe(150n);
    expect(p.events).toBe(3);
  });

  it("drops logs from unknown pools", () => {
    expect(groupPositions(events, new Set([OTHER]))).toHaveLength(1);
    expect(groupPositions(events)).toHaveLength(3);
  });
});

describe("value math (synthetic fixture)", () => {
  const fx = JSON.parse(readFileSync(join(__dirname, "fixtures/portfolio-synthetic.json"), "utf8"));
  const bins: BinInput[] = fx.bins.map((b: Record<string, string | number | null>) => ({
    ...b,
    userShares: BigInt(b.userShares as string),
    totalShares: BigInt(b.totalShares as string),
    balance0Scaled: BigInt(b.balance0Scaled as string),
    balance1Scaled: BigInt(b.balance1Scaled as string),
  }));

  it("share of 256-bit values", () => {
    expect(shareOf(1n, 4n)).toBe(0.25);
    expect(shareOf(2n ** 250n, 2n ** 252n)).toBe(0.25);
    expect(shareOf(0n, 10n)).toBe(0);
    expect(shareOf(5n, 0n)).toBe(0);
  });

  it("bin value = share × (reserve0Fiat + reserve1Fiat); fees capped by position age", () => {
    const v = valueBins(bins, fx.windowDays, fx.positionAgeDays);
    // 0.25×4000 + 0.1×5000 + 0.25×1000 + 0 = 1750
    expect(v.reduce((s, b) => s + b.valueUsd, 0)).toBeCloseTo(fx.expected.valueUsd, 9);
    // (0.25×70 + 0.1×140 + 0.25×0.1) × 3.5/7
    expect(v.reduce((s, b) => s + b.feesUsd, 0)).toBeCloseTo(fx.expected.feesUsd, 9);
    // older than the window → full window fees
    expect(valueBins(bins, 7, 30).reduce((s, b) => s + b.feesUsd, 0)).toBeCloseTo(fx.expected.feesUsd * 2, 9);
  });

  it("calibrates the scaled unit from bin balances vs reserveFiat", () => {
    const c = calibrateScale(bins, fx.price0, fx.price1);
    expect(c.usdPerScaled0).toBeCloseTo(fx.expected.usdPerScaled0, 30);
    expect(c.usdPerScaled1).toBeCloseTo(fx.expected.usdPerScaled1, 30);
    expect(c.confirmed).toBe(true);
    expect(c.impliedExp0).toBe(fx.expected.impliedExp0);
    expect(c.impliedExp1).toBe(fx.expected.impliedExp1);
    // inconsistent rates → not confirmed
    const bad = bins.map((b) => (b.idx === 0 ? { ...b, reserve0Fiat: 5000 } : b));
    expect(calibrateScale(bad, 2.5, 1).confirmed).toBe(false);
  });

  it("HODL = net scaled amounts × calibrated USD rate; falls back to 1e18 + price and flags approx", () => {
    const c = calibrateScale(bins, 2.5, 1);
    const h = hodlValue(400n * 10n ** 18n, 1000n * 10n ** 18n, c, 2.5, 1);
    expect(h.usd).toBeCloseTo(2000, 9);
    expect(h.approx).toBe(false);
    const none = { usdPerScaled0: null, usdPerScaled1: null, confirmed: false, impliedExp0: null, impliedExp1: null };
    expect(hodlValue(2n * 10n ** 18n, 0n, none, 3, 1)).toEqual({ usd: 6, approx: true });
    expect(hodlValue(1n, 0n, none, null, 1)).toEqual({ usd: null, approx: true });
  });

  it("value-weighted fee and net APR", () => {
    const v = valueBins(bins, 7, 30);
    // weights 1000, 500, 250
    expect(weightedApr(v, (b) => b.aprBps)).toBeCloseTo((1000 * 0.9125 + 500 * 1.46 + 250 * 0.0052) / 1750, 9);
    expect(weightedApr(v, (b) => b.pnlAprBps)).toBeCloseTo((1000 * -5.1 + 500 * 0.9 + 250 * 0.004) / 1750, 9);
    expect(weightedApr([], (b) => b.aprBps)).toBeNull();
  });
});

describe("status", () => {
  it("in / edge / out of the bins that still hold shares", () => {
    expect(rangeStatus([-3, -2, -1, 0, 1], -1)).toBe("in");
    expect(rangeStatus([-3, -2, -1, 0, 1], -3)).toBe("edge");
    expect(rangeStatus([-3, -2, -1, 0, 1], 1)).toBe("edge");
    expect(rangeStatus([-3, 1], 5)).toBe("out");
    expect(rangeStatus([-3, 1], -4)).toBe("out");
    expect(rangeStatus([4], 4)).toBe("in"); // single bin: active means in range
    expect(rangeStatus([], 0)).toBe("out");
  });
});

describe("insights", () => {
  const b = (idx: number, valueUsd: number, aprBps: number | null, pnlAprBps: number | null) => ({ idx, share: 0.1, valueUsd, feesUsd: 0, aprBps, pnlAprBps });

  it("flags out of range, idle runs, a very negative net bin and HODL outperformance", () => {
    const list = insights({
      bins: [b(3, 10, 3000, -51000), b(4, 10, 2500, 100), b(10, 10, 100, 50), b(11, 10, 120, 50), b(12, 10, 80, 50)],
      curBinIdx: 20,
      status: "out",
      pnlUsd: -5,
      pnlApprox: true,
    }).map((i) => i.text);
    expect(list[0]).toMatch(/Price is at bin #20, outside your bins #3–#12/);
    expect(list).toContain("Bins #10–#12 had ~1.0% APR in 7d: liquidity there is idle.");
    expect(list).toContain("Bin #3 had −510% net APR: price moves outweighed fees.".replace("−", "-"));
    expect(list).toContain("Holding the deposited tokens would have been worth more (approx.).");
  });

  it("edge warning, closed positions and the all-good case", () => {
    expect(insights({ bins: [b(0, 10, 3000, 100), b(1, 10, 3000, 100)], curBinIdx: 1, status: "edge", pnlUsd: 1, pnlApprox: false })[0].tone).toBe("warn");
    expect(insights({ bins: [b(0, 0, 3000, 100)], curBinIdx: 0, status: "out", pnlUsd: null, pnlApprox: true })[0].text).toMatch(/no longer holds/);
    expect(insights({ bins: [b(0, 10, 3000, 100)], curBinIdx: 0, status: "in", pnlUsd: 1, pnlApprox: false })).toEqual([
      { tone: "good", text: "All bins are earning and price is inside your range." },
    ]);
  });

  it("runs groups contiguous bins", () => {
    expect(runs([7, 1, 2, 3, 9, 10])).toEqual([[1, 3], [7, 7], [9, 10]]);
  });
});

describe("links", () => {
  it("re-plan link carries pool, rounded value and the 90% preset", () => {
    expect(replanUrl(56, POOL, 131.81)).toBe(`/?chain=56&pool=${POOL}&amount=132&days=30&preset=90&strategy=uniform&period=7d`);
  });
});
