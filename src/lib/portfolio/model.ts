/**
 * Pure portfolio math: decode liquidity logs, group them into positions, value bins, estimate
 * HODL / PnL, fees and APRs, and derive status + insights. No network access — unit-tested.
 */
import { decodeEventLog, type Hex } from "viem";
import { LIQUIDITY_ADDED_TOPIC, LIQUIDITY_EVENTS, LIQUIDITY_REMOVED_TOPIC } from "./abi";

// ---------- logs ----------

export interface RawLog {
  address: Hex;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex | bigint | null;
}

export interface LiquidityEvent {
  kind: "add" | "remove";
  pool: string; // lowercase
  provider: string; // lowercase
  salt: bigint;
  bins: number[];
  delta0: bigint[];
  delta1: bigint[];
  shares: bigint[];
  blockNumber: bigint;
}

/** Decodes a LiquidityAdded / LiquidityRemoved log. Returns null for anything else or malformed data. */
export function decodeLiquidityLog(log: RawLog): LiquidityEvent | null {
  const t0 = log.topics[0]?.toLowerCase();
  if (t0 !== LIQUIDITY_ADDED_TOPIC && t0 !== LIQUIDITY_REMOVED_TOPIC) return null;
  try {
    const d = decodeEventLog({ abi: LIQUIDITY_EVENTS, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
    const a = d.args as {
      provider: string;
      salt: bigint;
      binIdxs: readonly bigint[];
      binBalanceDeltas: readonly { delta0Scaled: bigint; delta1Scaled: bigint }[];
      shares: readonly bigint[];
    };
    if (a.binIdxs.length !== a.binBalanceDeltas.length || a.binIdxs.length !== a.shares.length) return null;
    return {
      kind: t0 === LIQUIDITY_ADDED_TOPIC ? "add" : "remove",
      pool: log.address.toLowerCase(),
      provider: a.provider.toLowerCase(),
      salt: a.salt,
      bins: a.binIdxs.map(Number),
      delta0: a.binBalanceDeltas.map((x) => x.delta0Scaled),
      delta1: a.binBalanceDeltas.map((x) => x.delta1Scaled),
      shares: [...a.shares],
      blockNumber: typeof log.blockNumber === "bigint" ? log.blockNumber : BigInt(log.blockNumber ?? 0),
    };
  } catch {
    return null;
  }
}

// ---------- positions ----------

export interface PositionKey {
  pool: string;
  salt: bigint;
  /** Every bin the position ever touched, ascending. */
  bins: number[];
  /**
   * Net deposited amounts in "scaled" units: Σ|Δ| over LiquidityAdded − Σ|Δ| over LiquidityRemoved.
   * Absolute values make this independent of the sign convention used for removals.
   */
  net0Scaled: bigint;
  net1Scaled: bigint;
  firstBlock: bigint;
  events: number;
}

const abs = (v: bigint) => (v < 0n ? -v : v);

/** Groups decoded events by (pool, salt), keeping only pools in `knownPools` (lowercase addresses). */
export function groupPositions(events: LiquidityEvent[], knownPools?: Set<string>): PositionKey[] {
  const map = new Map<string, PositionKey & { binSet: Set<number> }>();
  for (const e of events) {
    if (knownPools && !knownPools.has(e.pool)) continue;
    const key = `${e.pool}:${e.salt}`;
    let p = map.get(key);
    if (!p) {
      p = { pool: e.pool, salt: e.salt, bins: [], binSet: new Set(), net0Scaled: 0n, net1Scaled: 0n, firstBlock: e.blockNumber, events: 0 };
      map.set(key, p);
    }
    const sign = e.kind === "add" ? 1n : -1n;
    for (let i = 0; i < e.bins.length; i++) {
      p.binSet.add(e.bins[i]);
      p.net0Scaled += sign * abs(e.delta0[i]);
      p.net1Scaled += sign * abs(e.delta1[i]);
    }
    if (e.blockNumber < p.firstBlock) p.firstBlock = e.blockNumber;
    p.events++;
  }
  return [...map.values()].map(({ binSet, ...p }) => ({ ...p, bins: [...binSet].sort((a, b) => a - b) }));
}

// ---------- bins ----------

/** Per-bin inputs: onchain shares/balances plus 7d analytics for that bin. */
export interface BinInput {
  idx: number;
  userShares: bigint;
  totalShares: bigint;
  balance0Scaled: bigint;
  balance1Scaled: bigint;
  reserve0Fiat: number;
  reserve1Fiat: number;
  lpFeesFiat: number; // over the analytics window
  aprBps: number | null;
  pnlAprBps: number | null;
}

/** user / total as a float, precise for 256-bit values. */
export function shareOf(user: bigint, total: bigint): number {
  if (total <= 0n || user <= 0n) return 0;
  if (user >= total) return 1;
  return Number((user * 10n ** 18n) / total) / 1e18;
}

export interface BinValue {
  idx: number;
  share: number;
  valueUsd: number;
  /** Est. fees over the time held (capped at the window), at the bin's own 7d fee APR. */
  feesUsd: number;
  /** Fee rate per day at the bin's 7d fee APR: value × aprBps / 1e4 / 365. */
  dailyFeesUsd: number;
  /** Est. net (fees + price moves) over the same time at the bin's 7d net APR; null without pnlAprBps. */
  netUsd: number | null;
  aprBps: number | null;
  pnlAprBps: number | null;
}

/**
 * Bin value = share × (reserve0Fiat + reserve1Fiat), share = userShares / totalShares at the current block.
 *
 * Est. fees = value × (aprBps / 1e4) × min(heldDays, windowDays) / 365, i.e. Metric's own 7d rate for the bin
 * (fees ÷ the bin's 7d *average* liquidity) applied to your current value. Unlike current share × window
 * fees, this doesn't undercount when the bin's liquidity grew during the window (current share < average
 * share). Caveat: if the growth was mostly your own fresh deposit, the bin's average-liquidity rate overstates
 * what you earned. Net uses pnlAprBps the same way. Bins without aprBps count as 0 fee APR.
 */
export function valueBins(bins: BinInput[], windowDays: number, positionAgeDays: number | null): BinValue[] {
  const days = positionAgeDays === null ? windowDays : Math.max(0, Math.min(positionAgeDays, windowDays));
  return bins.map((b) => {
    const share = shareOf(b.userShares, b.totalShares);
    const valueUsd = share * (b.reserve0Fiat + b.reserve1Fiat);
    const feeApr = (b.aprBps ?? 0) / 1e4;
    return {
      idx: b.idx,
      share,
      valueUsd,
      feesUsd: (valueUsd * feeApr * days) / 365,
      dailyFeesUsd: (valueUsd * feeApr) / 365,
      netUsd: b.pnlAprBps === null ? null : (valueUsd * (b.pnlAprBps / 1e4) * days) / 365,
      aprBps: b.aprBps,
      pnlAprBps: b.pnlAprBps,
    };
  });
}

/** Σ est. net over bins with pnlAprBps (nulls skipped); null if no bin has one. */
export function estNetUsd(bins: BinValue[]): number | null {
  const withNet = bins.filter((b) => b.netUsd !== null && b.valueUsd > 0);
  return withNet.length ? withNet.reduce((s, b) => s + b.netUsd!, 0) : null;
}

// ---------- scale calibration + HODL ----------

export interface Calibration {
  /** USD per 1 scaled unit of token0 / token1, or null if unknown. */
  usdPerScaled0: number | null;
  usdPerScaled1: number | null;
  /** True when every bin with a balance implies the same rate within 2% (per token present). */
  confirmed: boolean;
  /** Implied decimal exponent of the scaled unit (scaled = amount × 10^exp), when a price is known. */
  impliedExp0: number | null;
  impliedExp1: number | null;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function rateFor(pairs: { scaled: bigint; fiat: number }[]): { rate: number | null; consistent: boolean } {
  const rates = pairs.filter((p) => p.scaled > 0n && p.fiat > 0).map((p) => p.fiat / Number(p.scaled));
  if (rates.length === 0) return { rate: null, consistent: false };
  const r = median(rates);
  return { rate: r, consistent: rates.every((x) => Math.abs(x / r - 1) <= 0.02) };
}

/**
 * Empirical scale: onchain bin balances (scaled units) vs the same bins' reserveFiat.
 * reserveFiat / balanceScaled = USD per scaled unit — no assumption about decimals needed.
 */
export function calibrateScale(bins: BinInput[], price0: number | null, price1: number | null): Calibration {
  const r0 = rateFor(bins.map((b) => ({ scaled: b.balance0Scaled, fiat: b.reserve0Fiat })));
  const r1 = rateFor(bins.map((b) => ({ scaled: b.balance1Scaled, fiat: b.reserve1Fiat })));
  const exp = (rate: number | null, price: number | null) => (rate && price && price > 0 ? Math.round(Math.log10(price / rate)) : null);
  const present = [r0, r1].filter((r) => r.rate !== null);
  return {
    usdPerScaled0: r0.rate,
    usdPerScaled1: r1.rate,
    confirmed: present.length > 0 && present.every((r) => r.consistent),
    impliedExp0: exp(r0.rate, price0),
    impliedExp1: exp(r1.rate, price1),
  };
}

/** Fallback when no bin holds a token: assume scaled amounts are 18-decimal fixed point. */
export const ASSUMED_SCALE_EXP = 18;

export function hodlValue(
  net0Scaled: bigint,
  net1Scaled: bigint,
  cal: Calibration,
  price0: number | null,
  price1: number | null,
): { usd: number | null; approx: boolean } {
  const part = (net: bigint, rate: number | null, price: number | null) => {
    if (net === 0n) return { usd: 0, approx: false };
    if (rate !== null) return { usd: Number(net) * rate, approx: false };
    if (price !== null && price > 0) return { usd: (Number(net) / 10 ** ASSUMED_SCALE_EXP) * price, approx: true };
    return { usd: null, approx: true };
  };
  const a = part(net0Scaled, cal.usdPerScaled0, price0);
  const b = part(net1Scaled, cal.usdPerScaled1, price1);
  if (a.usd === null || b.usd === null) return { usd: null, approx: true };
  return { usd: a.usd + b.usd, approx: a.approx || b.approx || !cal.confirmed };
}

// ---------- status ----------

export type RangeStatus = "in" | "edge" | "out";

/** Position range = lowest..highest bin that still holds shares. */
export function rangeStatus(activeBins: number[], curBinIdx: number): RangeStatus {
  if (activeBins.length === 0) return "out";
  const lo = Math.min(...activeBins);
  const hi = Math.max(...activeBins);
  if (curBinIdx < lo || curBinIdx > hi) return "out";
  if (lo !== hi && (curBinIdx === lo || curBinIdx === hi)) return "edge";
  return "in";
}

export const STATUS_LABEL: Record<RangeStatus, string> = {
  in: "In range",
  edge: "Edge of range",
  out: "Out of range — earning nothing",
};

// ---------- aggregates ----------

/** Value-weighted APR (fraction) over bins with data; null if none. */
export function weightedApr(bins: BinValue[], pick: (b: BinValue) => number | null): number | null {
  let w = 0;
  let s = 0;
  for (const b of bins) {
    const v = pick(b);
    if (v === null || b.valueUsd <= 0) continue;
    w += b.valueUsd;
    s += b.valueUsd * (v / 1e4);
  }
  return w > 0 ? s / w : null;
}

/**
 * Your fee APR: Σ value_b × (aprBps_b / 1e4) / Σ value_b — each bin's 7d fee APR weighted by your value in it
 * (bins without aprBps count as 0). Consistent with the fee estimate: fees = APR × value × days / 365.
 */
export function userFeeApr(bins: BinValue[]): number | null {
  const value = bins.reduce((s, b) => s + b.valueUsd, 0);
  if (value <= 0) return null;
  return (bins.reduce((s, b) => s + b.dailyFeesUsd, 0) * 365) / value;
}

/** Days since the first deposit (seconds-precise); null if unknown. */
export function heldDaysSince(firstTs: number | null, nowSec: number): number | null {
  return firstTs === null ? null : Math.max(0, (nowSec - firstTs) / 86400);
}

/** Annualized PnL vs HODL: pnl / hodl / heldDays × 365. Null when held < 1 day (too noisy) or inputs missing. */
export function annualizedPnl(pnlUsd: number | null, hodlUsd: number | null, heldDays: number | null): number | null {
  if (pnlUsd === null || hodlUsd === null || hodlUsd <= 0 || heldDays === null || heldDays < 1) return null;
  return (pnlUsd / hodlUsd / heldDays) * 365;
}

/** Plain-English deposit age, e.g. "deposited 1.2 days ago", "deposited 5 hours ago". */
export function depositAgeText(heldDays: number | null): string | null {
  if (heldDays === null) return null;
  if (heldDays < 1) {
    const h = Math.max(1, Math.round(heldDays * 24));
    return `deposited ${h} hour${h === 1 ? "" : "s"} ago`;
  }
  const d = heldDays < 10 ? heldDays.toFixed(1) : String(Math.round(heldDays));
  return `deposited ${d} day${d === "1.0" ? "" : "s"} ago`;
}

// ---------- insights ----------

export interface Insight {
  tone: "bad" | "warn" | "info" | "good";
  text: string;
}

const pct = (bps: number) => `${(bps / 100).toFixed(Math.abs(bps) >= 1000 ? 0 : 1)}%`;

/** Contiguous runs of bin indices, e.g. [1,2,3,7] → [[1,3],[7,7]]. */
export function runs(idxs: number[]): [number, number][] {
  const s = [...idxs].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const i of s) {
    const last = out[out.length - 1];
    if (last && i === last[1] + 1) last[1] = i;
    else out.push([i, i]);
  }
  return out;
}

const binLabel = ([a, b]: [number, number]) => (a === b ? `Bin #${a}` : `Bins #${a}–#${b}`);

/** Idle threshold: < 2% fee APR over the window. */
export const IDLE_APR_BPS = 200;
/** Flag bins whose net APR is below −50%. */
export const BAD_NET_BPS = -5000;

export function insights(args: {
  bins: BinValue[];
  curBinIdx: number;
  status: RangeStatus;
  pnlUsd: number | null;
  pnlApprox: boolean;
}): Insight[] {
  const { bins, curBinIdx, status } = args;
  const held = bins.filter((b) => b.valueUsd > 0);
  const out: Insight[] = [];
  if (held.length === 0) return [{ tone: "info", text: "This position no longer holds liquidity in any bin." }];
  const lo = Math.min(...held.map((b) => b.idx));
  const hi = Math.max(...held.map((b) => b.idx));

  if (status === "out")
    out.push({
      tone: "bad",
      text: `Price is at bin #${curBinIdx}, outside your bins #${lo}–#${hi}: this position earns no fees until price comes back.`,
    });
  else if (status === "edge")
    out.push({ tone: "warn", text: `Price sits at the edge of your range (#${curBinIdx}): one more move and the position stops earning.` });

  const idle = held.filter((b) => b.aprBps !== null && b.aprBps < IDLE_APR_BPS);
  for (const r of runs(idle.map((b) => b.idx)).slice(0, 2)) {
    const inRun = idle.filter((b) => b.idx >= r[0] && b.idx <= r[1]);
    const avg = inRun.reduce((s, b) => s + (b.aprBps ?? 0), 0) / inRun.length;
    out.push({ tone: "warn", text: `${binLabel(r)} had ~${pct(avg)} APR in 7d: liquidity there is idle.` });
  }

  const worst = held.filter((b) => b.pnlAprBps !== null && b.pnlAprBps < BAD_NET_BPS).sort((a, b) => a.pnlAprBps! - b.pnlAprBps!)[0];
  if (worst) out.push({ tone: "bad", text: `Bin #${worst.idx} had ${pct(worst.pnlAprBps!)} net APR: price moves outweighed fees.` });

  if (args.pnlUsd !== null && args.pnlUsd < 0)
    out.push({ tone: "info", text: `Holding the deposited tokens would have been worth more${args.pnlApprox ? " (approx.)" : ""}.` });

  if (out.length === 0) out.push({ tone: "good", text: "All bins are earning and price is inside your range." });
  return out;
}

/** Planner link prefilled with this pool, the position's value and the suggested 90% range. */
export function replanUrl(chainId: number, pool: string, valueUsd: number): string {
  const amount = Math.max(1, Math.round(valueUsd));
  return `/?chain=${chainId}&pool=${pool}&amount=${amount}&days=30&preset=90&strategy=uniform&period=7d`;
}

export const metricPoolUrl = (chainId: number, pool: string) => `https://app.metric.xyz/pool/${chainId}/${pool}`;
