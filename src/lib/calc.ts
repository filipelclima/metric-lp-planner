/**
 * Pure calculation module for Binwise. No React, no fetch — everything here is unit-tested.
 *
 * Units: percentages are "percent units" (0.01 means 0.01%), USD amounts are plain numbers.
 */
import type { Pool, RawBin, RawBinsResponse, Strategy } from "./types";

export interface Bin {
  idx: number;
  lengthE6: number;
  /** Lower / upper edge and midpoint, in percent relative to the oracle price. */
  lowPct: number;
  highPct: number;
  midPct: number;
  volumeFiat: number;
  feesFiat: number;
  /** Fees per day over the analytics window. */
  dailyFees: number;
  /** Average liquidity (falls back to current reserves when the average is 0). */
  liquidity: number;
  reserve0Fiat: number;
  reserve1Fiat: number;
  swapCount: number;
  aprBps: number | null;
  pnlAprBps: number | null;
  /** False for bins the API didn't return (filled in as empty). */
  hasData: boolean;
}

export interface BinData {
  windowDays: number;
  curBinIdx: number;
  defaultLengthE6: number;
  /** Dense, sorted by idx, always spanning bin -1, bin 0, the current bin and every bin returned. */
  bins: Bin[];
  minIdx: number;
  maxIdx: number;
}

const SECONDS_PER_DAY = 86400;

/** Window timestamps are unix seconds. The window can be shorter than the period (capped at pool age). */
export function windowDays(window: { fromTs: number; toTs: number }): number {
  const d = (window.toTs - window.fromTs) / SECONDS_PER_DAY;
  return d > 0 ? d : 0;
}

export function binFees(b: RawBin): number {
  return b.token0.lpFeesFiat + b.token1.lpFeesFiat;
}

export function binLiquidity(b: RawBin): number {
  const avg = b.token0.avgLiquidityFiat + b.token1.avgLiquidityFiat;
  if (avg > 0) return avg;
  return b.token0.reserveFiat + b.token1.reserveFiat;
}

function mode(values: number[], fallback: number): number {
  const counts = new Map<number, number>();
  let best = fallback;
  let bestCount = 0;
  for (const v of values) {
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (c > bestCount) [best, bestCount] = [v, c];
  }
  return best;
}

/** Bin i spans [i·w, (i+1)·w] with w = lengthE6 / 1e6, i.e. lengthE6 / 1e4 in percent units. */
function binEdges(idx: number, lengthE6: number) {
  const w = lengthE6 / 1e4;
  return { lowPct: idx * w, highPct: (idx + 1) * w, midPct: (idx + 0.5) * w };
}

/** Empty bin for indices the API didn't return; uses the pool's most common width. */
function emptyBin(idx: number, lengthE6: number): Bin {
  return {
    idx,
    lengthE6,
    ...binEdges(idx, lengthE6),
    volumeFiat: 0,
    feesFiat: 0,
    dailyFees: 0,
    liquidity: 0,
    reserve0Fiat: 0,
    reserve1Fiat: 0,
    swapCount: 0,
    aprBps: null,
    pnlAprBps: null,
    hasData: false,
  };
}

/** Turns the raw /analytics/bins response into dense bins with edges. `bin` and `swapCount` arrive as strings. */
export function parseBins(raw: RawBinsResponse): BinData {
  const days = windowDays(raw.window);
  const cur = raw.curBinIdx;
  const rows = new Map<number, RawBin>();
  for (const b of raw.bins) rows.set(Number(b.bin), b);
  const defaultLengthE6 = mode(
    [...rows.values()].map((b) => b.lengthE6).filter((w) => w > 0),
    100,
  );

  const idxs = [...rows.keys(), cur, -1, 0];
  const minIdx = Math.min(...idxs);
  const maxIdx = Math.max(...idxs);

  const bins: Bin[] = [];
  for (let i = minIdx; i <= maxIdx; i++) {
    const r = rows.get(i);
    if (!r) {
      bins.push(emptyBin(i, defaultLengthE6));
      continue;
    }
    const feesFiat = binFees(r);
    bins.push({
      idx: i,
      lengthE6: r.lengthE6,
      ...binEdges(i, r.lengthE6),
      volumeFiat: (r.token0.volumeFiat ?? 0) + (r.token1.volumeFiat ?? 0),
      feesFiat,
      dailyFees: days > 0 ? feesFiat / days : 0,
      liquidity: binLiquidity(r),
      reserve0Fiat: r.token0.reserveFiat,
      reserve1Fiat: r.token1.reserveFiat,
      swapCount: Number(r.swapCount),
      aprBps: r.aprBps,
      pnlAprBps: r.pnlAprBps,
      hasData: true,
    });
  }
  return { windowDays: days, curBinIdx: cur, defaultLengthE6, bins, minIdx, maxIdx };
}

/** Returns the bin at idx, or an empty bin (default width) outside the returned span. */
export function getBin(data: BinData, idx: number): Bin {
  if (idx >= data.minIdx && idx <= data.maxIdx) return data.bins[idx - data.minIdx];
  return emptyBin(idx, data.defaultLengthE6);
}

export function binsInRange(data: BinData, from: number, to: number): Bin[] {
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  const out: Bin[] = [];
  for (let i = lo; i <= hi; i++) out.push(getBin(data, i));
  return out;
}

/** Pool APR implied by a bin's fees and liquidity (what Metric reports as aprBps / 10000). */
export function binPoolApr(b: Pick<Bin, "dailyFees" | "liquidity">): number {
  return b.liquidity > 0 ? (b.dailyFees * 365) / b.liquidity : 0;
}

/**
 * Smallest contiguous bin range containing the current bin whose volume is >= share of the total.
 * Ties go to the range with more volume, then the most centered one. Null when there's no volume.
 */
export function presetRange(data: BinData, share: number): { from: number; to: number } | null {
  const { bins, curBinIdx, minIdx } = data;
  const prefix = [0];
  for (const b of bins) prefix.push(prefix[prefix.length - 1] + b.volumeFiat);
  const total = prefix[prefix.length - 1];
  if (total <= 0) return null;
  const target = total * share * (1 - 1e-12);
  const c = curBinIdx - minIdx;
  const sum = (lo: number, hi: number) => prefix[hi + 1] - prefix[lo];

  let best: { lo: number; hi: number } | null = null;
  for (let lo = c; lo >= 0; lo--) {
    if (sum(lo, bins.length - 1) < target) continue;
    // Binary search the smallest hi >= c with sum(lo, hi) >= target.
    let a = c;
    let z = bins.length - 1;
    while (a < z) {
      const m = (a + z) >> 1;
      if (sum(lo, m) >= target) z = m;
      else a = m + 1;
    }
    const hi = a;
    if (!best) {
      best = { lo, hi };
      continue;
    }
    const w = hi - lo;
    const bw = best.hi - best.lo;
    const better =
      w < bw ||
      (w === bw && sum(lo, hi) > sum(best.lo, best.hi)) ||
      (w === bw &&
        sum(lo, hi) === sum(best.lo, best.hi) &&
        Math.abs(lo + hi - 2 * c) < Math.abs(best.lo + best.hi - 2 * c));
    if (better) best = { lo, hi };
  }
  return best && { from: best.lo + minIdx, to: best.hi + minIdx };
}

/** Relative weights per bin for a distribution strategy. Always sums to 1 (empty → []). */
export function strategyWeights(bins: Bin[], strategy: Strategy, curBinIdx: number): number[] {
  if (bins.length === 0) return [];
  let w: number[];
  if (strategy === "curve") {
    const maxD = Math.max(...bins.map((b) => Math.abs(b.idx - curBinIdx)));
    w = bins.map((b) => maxD + 1 - Math.abs(b.idx - curBinIdx));
  } else if (strategy === "fee") {
    w = bins.map((b) => (b.liquidity > 0 ? b.dailyFees / b.liquidity : 0));
  } else {
    w = bins.map(() => 1);
  }
  const s = w.reduce((a, b) => a + b, 0);
  if (!(s > 0)) return bins.map(() => 1 / bins.length);
  return w.map((x) => x / s);
}

export interface BinPosition {
  bin: Bin;
  usd: number;
  token0Usd: number;
  token1Usd: number;
  token0Amount: number;
  token1Amount: number;
  /** User share of the bin after depositing: U / (liq + U). */
  share: number;
  dailyFees: number;
  /** APR the user earns on this bin's capital: dailyFees × 365 / (liq + U). */
  apr: number;
  /** Historical net (fees + price moves) USD/day from pnlAprBps; null when the bin has no pnlAprBps. */
  netDaily: number | null;
  /** Net APR on this bin's capital: (pnlAprBps / 10000) × liq / (liq + U). Can be negative. */
  netApr: number | null;
}

export interface Estimate {
  source: "bins" | "pool";
  deposit: number;
  dailyFees: number;
  apr: number;
  /** Historical net USD/day (trading PnL, which already includes fees). Null without per-bin pnl data. */
  netDaily: number | null;
  netApr: number | null;
  /** Bins in range skipped for the net estimate because pnlAprBps is null. */
  netSkippedBins: number;
  positions: BinPosition[];
  token0Usd: number;
  token1Usd: number;
  token0Amount: number;
  token1Amount: number;
}

/** Token fiat prices; null when Metric has no price (token amounts then show as unavailable). */
export interface Prices {
  token0: number | null;
  token1: number | null;
}

/** Splits USD across token0/token1: below the current bin → token1, above → token0, current → reserve ratio. */
export function splitTokens(bin: Bin, usd: number, curBinIdx: number): { token0Usd: number; token1Usd: number } {
  if (bin.idx < curBinIdx) return { token0Usd: 0, token1Usd: usd };
  if (bin.idx > curBinIdx) return { token0Usd: usd, token1Usd: 0 };
  const r = bin.reserve0Fiat + bin.reserve1Fiat;
  const ratio0 = r > 0 ? bin.reserve0Fiat / r : 0.5;
  return { token0Usd: usd * ratio0, token1Usd: usd * (1 - ratio0) };
}

const amount = (usd: number, price: number | null) => (price !== null && price > 0 ? usd / price : 0);

/**
 * Pool-level net USD/day of a bin from Metric's trading PnL APR, which already includes fees:
 * netDaily_b = (pnlAprBps_b / 10000) × liq_b / 365. Zero when pnlAprBps is null.
 */
export function binNetDaily(b: Pick<Bin, "pnlAprBps" | "liquidity">): number {
  return b.pnlAprBps === null ? 0 : ((b.pnlAprBps / 1e4) * b.liquidity) / 365;
}

/**
 * Per-bin model, user share s_b = U_b / (liq_b + U_b):
 *   fees: userDaily = Σ dailyFees_b × s_b
 *   net:  userNet   = Σ netDaily_b × s_b over bins with pnlAprBps (historical, can be negative)
 */
export function estimateFromBins(
  data: BinData,
  from: number,
  to: number,
  strategy: Strategy,
  deposit: number,
  prices: Prices,
): Estimate {
  const bins = binsInRange(data, from, to);
  const weights = strategyWeights(bins, strategy, data.curBinIdx);
  const positions = bins.map((bin, i): BinPosition => {
    const usd = deposit * weights[i];
    const { token0Usd, token1Usd } = splitTokens(bin, usd, data.curBinIdx);
    const denom = bin.liquidity + usd;
    const share = denom > 0 ? usd / denom : 0;
    return {
      bin,
      usd,
      token0Usd,
      token1Usd,
      token0Amount: amount(token0Usd, prices.token0),
      token1Amount: amount(token1Usd, prices.token1),
      share,
      dailyFees: bin.dailyFees * share,
      apr: denom > 0 ? (bin.dailyFees * 365) / denom : 0,
      netDaily: bin.pnlAprBps === null ? null : binNetDaily(bin) * share,
      netApr: bin.pnlAprBps === null ? null : denom > 0 ? ((bin.pnlAprBps / 1e4) * bin.liquidity) / denom : 0,
    };
  });
  const sum = (f: (p: BinPosition) => number) => positions.reduce((a, p) => a + f(p), 0);
  const dailyFees = sum((p) => p.dailyFees);
  const withNet = positions.filter((p) => p.netDaily !== null);
  const netDaily = withNet.length > 0 ? withNet.reduce((a, p) => a + p.netDaily!, 0) : null;
  return {
    source: "bins",
    deposit,
    dailyFees,
    apr: deposit > 0 ? (dailyFees * 365) / deposit : 0,
    netDaily,
    netApr: netDaily === null || !(deposit > 0) ? null : (netDaily * 365) / deposit,
    netSkippedBins: positions.length - withNet.length,
    positions,
    token0Usd: sum((p) => p.token0Usd),
    token1Usd: sum((p) => p.token1Usd),
    token0Amount: sum((p) => p.token0Amount),
    token1Amount: sum((p) => p.token1Amount),
  };
}

/** Whole pool's average LP fees per day over the bins response window. */
export function poolWindowDailyFees(data: BinData): number {
  return data.bins.reduce((a, b) => a + b.dailyFees, 0);
}

/** Pool-level daily LP fees and TVL from analytics24h (fees divided by that window's length). */
export function poolDailyFees(pool: Pick<Pool, "analytics24h">): { dailyFees: number; tvlFiat: number } | null {
  const a = pool.analytics24h;
  if (!a) return null;
  const days = windowDays(a);
  return { dailyFees: days > 0 ? a.feesFiat / days : 0, tvlFiat: a.tvlFiat };
}

/**
 * Fallback when per-bin data is unavailable: the user earns pro-rata on the whole pool,
 * using analytics24h.feesFiat / analytics24h.tvlFiat. Null when the pool has no 24h analytics.
 */
export function estimateFromPool(pool: Pick<Pool, "analytics24h">, deposit: number): Estimate | null {
  const p = poolDailyFees(pool);
  if (!p) return null;
  const denom = p.tvlFiat + deposit;
  const dailyFees = denom > 0 ? (p.dailyFees * deposit) / denom : 0;
  return {
    source: "pool",
    deposit,
    dailyFees,
    apr: deposit > 0 ? (dailyFees * 365) / deposit : 0,
    netDaily: null,
    netApr: null,
    netSkippedBins: 0,
    positions: [],
    token0Usd: 0,
    token1Usd: 0,
    token0Amount: 0,
    token1Amount: 0,
  };
}

export function projectFees(dailyFees: number, deposit: number, days: number) {
  const r = deposit > 0 ? dailyFees / deposit : 0;
  return {
    days,
    simple: dailyFees * days,
    compounded: deposit * (Math.pow(1 + r, days) - 1),
  };
}

// ---------- formatting ----------

/** "+0.07500%" style label. */
export function fmtBinPct(p: number, decimals = 5): string {
  const v = Math.abs(p) < 10 ** -(decimals + 1) ? 0 : p;
  return `${v > 0 ? "+" : v < 0 ? "-" : ""}${Math.abs(v).toFixed(decimals)}%`;
}

/** Compact label for the plan, e.g. "-0.075%" (trailing zeros trimmed, at least 2 decimals). */
export function fmtPlanPct(p: number): string {
  const s = fmtBinPct(p, 6).replace(/0+%$/, "%");
  const [int, frac = ""] = s.slice(0, -1).split(".");
  return `${int}.${frac.padEnd(2, "0")}%`;
}

export function fmtWidth(lengthE6: number): string {
  return fmtPlanPct(lengthE6 / 1e4).replace(/^\+/, "");
}

export function planText(data: BinData, from: number, to: number): string {
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  const bins = binsInRange(data, lo, hi);
  const widths = [...new Set(bins.map((b) => b.lengthE6))].sort((a, b) => a - b);
  const widthLabel =
    widths.length === 1 ? `${fmtWidth(widths[0])} each` : `${fmtWidth(widths[0])}–${fmtWidth(widths[widths.length - 1])} wide`;
  const s = `#${lo}`;
  const e = `#${hi}`;
  const pad = Math.max(s.length, e.length);
  return [
    `Start bin: ${s.padEnd(pad)} = ${fmtPlanPct(getBin(data, lo).midPct)}`,
    `End bin:   ${e.padEnd(pad)} = ${fmtPlanPct(getBin(data, hi).midPct)}`,
    `${bins.length} bin${bins.length === 1 ? "" : "s"} · ${widthLabel} · active bin #${data.curBinIdx}`,
  ].join("\n");
}

export function fmtUsd(v: number, opts: { compact?: boolean } = {}): string {
  if (!Number.isFinite(v)) return "—";
  if (opts.compact && Math.abs(v) >= 1e4)
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(v);
  const digits = Math.abs(v) > 0 && Math.abs(v) < 1 ? 4 : 2;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: digits }).format(v);
}

/** Token amount; with a price, shows enough decimals for ~$0.01 precision. */
export function fmtAmount(v: number, price?: number | null): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const digits =
    price && price > 0
      ? Math.min(8, Math.max(2, Math.ceil(Math.log10(price * 100))))
      : a === 0 ? 2 : a >= 1000 ? 2 : a >= 1 ? 4 : 6;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 2 }).format(v);
}

export function fmtApr(fraction: number | null): string {
  if (fraction === null || !Number.isFinite(fraction)) return "—";
  return `${(fraction * 100).toFixed(Math.abs(fraction) >= 10 ? 0 : 2)}%`;
}

export const bpsToFraction = (bps: number | null) => (bps === null ? null : bps / 1e4);

/** Bin span to draw in the histogram: the selection and active bin plus context, capped at maxBars. */
export function chartWindow(data: BinData, from: number, to: number, maxBars = 160): { lo: number; hi: number } {
  const [a, b] = from <= to ? [from, to] : [to, from];
  const lo0 = Math.min(a, data.curBinIdx);
  const hi0 = Math.max(b, data.curBinIdx);
  const pad = Math.max(10, Math.round((hi0 - lo0 + 1) * 0.75));
  let lo = Math.max(lo0 - pad, Math.min(data.minIdx, lo0));
  let hi = Math.min(hi0 + pad, Math.max(data.maxIdx, hi0));
  if (hi - lo + 1 > maxBars) {
    const extra = hi - lo + 1 - maxBars;
    // trim context evenly, never the selection/active bin
    const trimLo = Math.min(lo0 - lo, Math.ceil(extra / 2));
    lo += trimLo;
    hi -= Math.min(hi - hi0, extra - trimLo);
  }
  return { lo, hi };
}

/** Smallest "nice" step (1, 2, 5, 10, 20, 50, …) so that `count` bins get at most `maxLabels` axis labels. */
export function tickStep(count: number, maxLabels: number): number {
  const limit = Math.max(1, Math.floor(maxLabels));
  for (let mag = 1; ; mag *= 10) {
    for (const m of [1, 2, 5]) {
      if (Math.ceil(count / (m * mag)) <= limit) return m * mag;
    }
  }
}

/** APR with exactly 2 decimals and thousands separators, e.g. 10.99 → "1,099.00%". */
export function fmtAprFixed(fraction: number | null): string {
  if (fraction === null || !Number.isFinite(fraction)) return "—";
  return `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(fraction * 100)}%`;
}
