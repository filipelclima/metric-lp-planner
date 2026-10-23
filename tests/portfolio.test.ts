import { readFileSync } from "node:fs";
import { join } from "node:path";
import { encodeAbiParameters, encodeEventTopics, pad, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { LIQUIDITY_ADDED, LIQUIDITY_ADDED_TOPIC, LIQUIDITY_REMOVED, LIQUIDITY_REMOVED_TOPIC } from "@/lib/portfolio/abi";
import {
  annualizedPnl,
  calibrateScale,
  estNetUsd,
  depositAgeText,
  heldDaysSince,
  userFeeApr,
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

  it("bin value = share × (reserve0Fiat + reserve1Fiat); fees = value × 7d fee APR × days held / 365", () => {
    const v = valueBins(bins, fx.windowDays, fx.positionAgeDays);
    // 0.25×4000 + 0.1×5000 + 0.25×1000 + 0 = 1750
    expect(v.reduce((s, b) => s + b.valueUsd, 0)).toBeCloseTo(fx.expected.valueUsd, 9);
    // (1000×0.9125 + 500×1.46 + 250×0.0052) × 3.5 / 365
    expect(v.reduce((s, b) => s + b.feesUsd, 0)).toBeCloseTo(fx.expected.feesUsd, 6);
    // older than the window → full window fees
    expect(valueBins(bins, 7, 30).reduce((s, b) => s + b.feesUsd, 0)).toBeCloseTo(fx.expected.feesUsd * 2, 5);
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
  const b = (idx: number, valueUsd: number, aprBps: number | null, pnlAprBps: number | null) => ({
    idx,
    share: 0.1,
    valueUsd,
    feesUsd: 0,
    dailyFeesUsd: 0,
    netUsd: null,
    aprBps,
    pnlAprBps,
  });

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

describe("fee and net estimates from each bin's 7d APR", () => {
  const held = 28.5 / 24;
  /** A uniform position: the same user share in 16 bins with known aprBps / pnlAprBps. */
  function bins(liquidityMultiplier = 1): BinInput[] {
    return Array.from({ length: 16 }, (_, i) => {
      const reserve = (40 + 15 * i) * liquidityMultiplier;
      return {
        idx: i - 3,
        userShares: 25n * 10n ** 18n,
        totalShares: BigInt(100 * liquidityMultiplier) * 10n ** 18n, // 25% share, diluted when liquidity grows
        balance0Scaled: 0n,
        balance1Scaled: 0n,
        reserve0Fiat: reserve / 2,
        reserve1Fiat: reserve / 2,
        lpFeesFiat: 0.4 + 0.1 * i, // window fees (no longer used for the estimate)
        aprBps: 20_000 + 2_000 * i,
        pnlAprBps: i % 4 === 0 ? null : -5_000 + 1_000 * i,
      };
    });
  }
  const sum = (v: ReturnType<typeof valueBins>, f: (b: ReturnType<typeof valueBins>[number]) => number) => v.reduce((s, b) => s + f(b), 0);

  it("estFees = Σ value_b × aprBps_b/1e4 × heldDays/365, and equals your fee APR × value × heldDays/365", () => {
    const input = bins();
    const v = valueBins(input, 7, held);
    const expected = input.reduce((s, b) => s + 0.25 * (b.reserve0Fiat + b.reserve1Fiat) * (b.aprBps! / 1e4) * (held / 365), 0);
    expect(sum(v, (b) => b.feesUsd)).toBeCloseTo(expected, 12);
    const apr = userFeeApr(v)!;
    expect(apr).toBeCloseTo(sum(v, (b) => b.valueUsd * (b.aprBps! / 1e4)) / sum(v, (b) => b.valueUsd), 12);
    expect(sum(v, (b) => b.feesUsd)).toBeCloseTo((apr * sum(v, (b) => b.valueUsd) * held) / 365, 12);
  });

  it("net uses pnlAprBps the same way and skips bins without it", () => {
    const input = bins();
    const v = valueBins(input, 7, held);
    const expected = input
      .filter((b) => b.pnlAprBps !== null)
      .reduce((s, b) => s + 0.25 * (b.reserve0Fiat + b.reserve1Fiat) * (b.pnlAprBps! / 1e4) * (held / 365), 0);
    expect(estNetUsd(v)).toBeCloseTo(expected, 12);
    expect(estNetUsd(valueBins(input.map((b) => ({ ...b, pnlAprBps: null })), 7, held))).toBeNull();
  });

  it("bin liquidity doubling during the window doesn't drop the estimate (current share halves, value and rate don't)", () => {
    const before = valueBins(bins(1), 7, held);
    const after = valueBins(bins(2), 7, held); // others doubled liquidity: share 25% → 12.5%, same aprBps
    expect(after[0].share).toBeCloseTo(before[0].share / 2, 12);
    expect(sum(after, (b) => b.feesUsd)).toBeGreaterThanOrEqual(sum(before, (b) => b.feesUsd) - 1e-12);
    // …whereas current share × window fees (the old estimate) would have halved
    const shareBased = (v: ReturnType<typeof valueBins>, input: BinInput[]) => v.reduce((s, b, i) => s + b.share * input[i].lpFeesFiat * (held / 7), 0);
    expect(shareBased(after, bins(2))).toBeCloseTo(shareBased(before, bins(1)) / 2, 12);
    expect(sum(after, (b) => b.feesUsd)).toBeGreaterThan(shareBased(after, bins(2)));
  });

  it("caps held days at the window and counts missing aprBps as 0", () => {
    const input = bins();
    expect(sum(valueBins(input, 7, 30), (b) => b.feesUsd)).toBeCloseTo(sum(valueBins(input, 7, 7), (b) => b.feesUsd), 12);
    const v = valueBins(input.map((b, i) => (i === 0 ? { ...b, aprBps: null } : b)), 7, held);
    expect(v[0].feesUsd).toBe(0);
    expect(sum(v, (b) => b.feesUsd)).toBeCloseTo((userFeeApr(v)! * sum(v, (b) => b.valueUsd) * held) / 365, 12);
  });
});

describe("your result", () => {
  it("annualizes PnL vs HODL only after a day", () => {
    expect(annualizedPnl(-0.17, 131.79, 28.5 / 24)).toBeCloseTo((-0.17 / 131.79 / (28.5 / 24)) * 365, 12);
    expect(annualizedPnl(5, 100, 0.9)).toBeNull();
    expect(annualizedPnl(null, 100, 3)).toBeNull();
    expect(annualizedPnl(5, 0, 3)).toBeNull();
  });

  it("deposit age text and held days", () => {
    expect(heldDaysSince(1000, 1000 + 28.5 * 3600)).toBeCloseTo(1.1875, 9);
    expect(heldDaysSince(null, 5)).toBeNull();
    expect(depositAgeText(28.5 / 24)).toBe("deposited 1.2 days ago");
    expect(depositAgeText(5 / 24)).toBe("deposited 5 hours ago");
    expect(depositAgeText(0.01)).toBe("deposited 1 hour ago");
    expect(depositAgeText(45.3)).toBe("deposited 45 days ago");
  });
});

describe("24h rates for young positions", () => {
  it("picks 24h analytics under 2 days held, 7d otherwise (and when the age is unknown)", async () => {
    const { ratePlan, YOUNG_POSITION_DAYS } = await import("@/lib/portfolio/model");
    expect(YOUNG_POSITION_DAYS).toBe(2);
    expect(ratePlan(28.5 / 24, 7)).toEqual({ period: "24h", capDays: 2 });
    expect(ratePlan(0.1, 7)).toEqual({ period: "24h", capDays: 2 });
    expect(ratePlan(2, 7)).toEqual({ period: "7d", capDays: 7 });
    expect(ratePlan(30, 6.5)).toEqual({ period: "7d", capDays: 6.5 }); // young pool: 7d window shorter than 7
    expect(ratePlan(null, 7)).toEqual({ period: "7d", capDays: 7 });
  });

  it("applies the 24h rate over the whole holding time (1.5 days isn't cut to the 1-day window)", async () => {
    const { ratePlan } = await import("@/lib/portfolio/model");
    const held = 1.5;
    const bin = (aprBps: number): BinInput => ({
      idx: 0,
      userShares: 1n,
      totalShares: 4n,
      balance0Scaled: 0n,
      balance1Scaled: 0n,
      reserve0Fiat: 200,
      reserve1Fiat: 200,
      lpFeesFiat: 0,
      aprBps,
      pnlAprBps: aprBps - 10_000,
    });
    const { capDays } = ratePlan(held, 7);
    const v = valueBins([bin(73_000)], capDays, held); // 730% on the last 24h
    expect(v[0].valueUsd).toBe(100);
    expect(v[0].feesUsd).toBeCloseTo((100 * 7.3 * 1.5) / 365, 12); // = $3.00
    expect(v[0].netUsd).toBeCloseTo((100 * 6.3 * 1.5) / 365, 12);
    // A higher 24h rate than 7d raises the estimate for a fresh position, as on a high-volume last day
    const v7 = valueBins([bin(36_500)], ratePlan(10, 7).capDays, held);
    expect(v[0].feesUsd).toBeGreaterThan(v7[0].feesUsd);
  });

  it("insight text names the rate window", () => {
    const b = { idx: 4, share: 0.1, valueUsd: 10, feesUsd: 0, dailyFeesUsd: 0, netUsd: null, aprBps: 50, pnlAprBps: 10 };
    const text = insights({ bins: [b], curBinIdx: 4, status: "in", pnlUsd: 1, pnlApprox: false, period: "24h" }).map((i) => i.text);
    expect(text).toContain("Bin #4 had ~0.5% APR in 24h: liquidity there is idle.");
    expect(insights({ bins: [b], curBinIdx: 4, status: "in", pnlUsd: 1, pnlApprox: false })[0].text).toMatch(/in 7d/);
  });
});
