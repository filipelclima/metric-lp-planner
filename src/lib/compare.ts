/**
 * Compare ranges: up to 3 scenarios (A/B/C) for the same deposit, duration and data period.
 * Pure functions only — they reuse calc.ts (presetRange, estimateFromBins, projectFees, getBin)
 * and add range-level metrics, best-per-row highlighting, verdicts and URL encoding.
 */
import { binsInRange, estimateFromBins, getBin, presetRange, projectFees, type BinData, type Prices } from "./calc";
import type { Strategy } from "./types";
import { readState, type PlannerState } from "./urlState";

export const MAX_SCENARIOS = 3;
export const SCENARIO_LABELS = ["A", "B", "C"] as const;
export const SCENARIO_NAMES: Record<number, string> = { 80: "Narrow", 90: "Medium", 95: "Wide" };

export type PresetShare = 80 | 90 | 95;

export interface Scenario {
  range: { kind: "preset"; share: PresetShare } | { kind: "manual"; from: number; to: number };
  strategy: Strategy;
  /** Optional different pool (pool vs pool), same deposit. */
  pool?: { chainId: number; address: string };
}

export const DEFAULT_SCENARIOS: Scenario[] = [
  { range: { kind: "preset", share: 80 }, strategy: "uniform" },
  { range: { kind: "preset", share: 90 }, strategy: "uniform" },
  { range: { kind: "preset", share: 95 }, strategy: "uniform" },
];

// ---------- URL encoding ----------
// cmp = entries joined by ",". Entry = "<from>:<to>:<s>" or "p<share>:<s>", optionally followed by
// ":<chainId>:<0xpool>" for a different pool. s = u (uniform) | c (curve) | f (fee-weighted).

const S_CODE: Record<Strategy, string> = { uniform: "u", curve: "c", fee: "f" };
const S_FROM: Record<string, Strategy> = { u: "uniform", c: "curve", f: "fee" };
const INT = /^-?\d{1,6}$/;
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const CHAINS = [1, 56, 4663];

export function encodeScenarios(list: Scenario[]): string {
  return list
    .slice(0, MAX_SCENARIOS)
    .map((s) => {
      const r = s.range.kind === "preset" ? `p${s.range.share}` : `${s.range.from}:${s.range.to}`;
      const p = s.pool ? `:${s.pool.chainId}:${s.pool.address}` : "";
      return `${r}:${S_CODE[s.strategy]}${p}`;
    })
    .join(",");
}

function decodeOne(entry: string): Scenario | null {
  const parts = entry.split(":");
  let range: Scenario["range"];
  let rest: string[];
  if (/^p(80|90|95)$/.test(parts[0])) {
    range = { kind: "preset", share: Number(parts[0].slice(1)) as PresetShare };
    rest = parts.slice(1);
  } else {
    if (parts.length < 3 || !INT.test(parts[0]) || !INT.test(parts[1])) return null;
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    range = { kind: "manual", from: Math.min(a, b), to: Math.max(a, b) };
    rest = parts.slice(2);
  }
  const strategy = S_FROM[rest[0]];
  if (!strategy) return null;
  if (rest.length === 1) return { range, strategy };
  if (rest.length !== 3 || !/^\d+$/.test(rest[1]) || !CHAINS.includes(Number(rest[1])) || !ADDR.test(rest[2])) return null;
  return { range, strategy, pool: { chainId: Number(rest[1]), address: rest[2] } };
}

/** Decodes `cmp`; invalid entries are dropped, at most 3 kept. Empty/absent → null (use defaults). */
export function decodeScenarios(raw: string | null): Scenario[] | null {
  if (!raw) return null;
  const list = raw
    .split(",")
    .slice(0, MAX_SCENARIOS)
    .map(decodeOne)
    .filter((s): s is Scenario => s !== null);
  return list.length ? list : null;
}

// ---------- metrics ----------

/** A bin counts as idle when it traded less than 0.1% of the window's total volume. */
export const IDLE_VOLUME_SHARE = 0.001;

export function resolveRange(s: Scenario, data: BinData): { from: number; to: number } {
  if (s.range.kind === "manual") return { from: s.range.from, to: s.range.to };
  return presetRange(data, s.range.share / 100) ?? { from: data.curBinIdx - 5, to: data.curBinIdx + 5 };
}

export interface ResolvedRange {
  from: number;
  to: number;
  /** Bins added on each side because the preset collapsed onto an earlier scenario (0 = as computed). */
  widened: number;
  /** Index of the earlier scenario this range was widened from. */
  widenedFrom: number | null;
  /** Index of an earlier scenario with the exact same range (and pool), for manual picks. */
  sameAs: number | null;
}

/** Bins added on each side when a preset doesn't come out strictly wider than the previous preset. */
const PRESET_STEP: Record<PresetShare, number> = { 80: 1, 90: 1, 95: 2 };

const widen = (r: { from: number; to: number }, n: number) => ({ from: r.from - n, to: r.to + n });
const sameRange = (a: { from: number; to: number }, b: { from: number; to: number }) => a.from === b.from && a.to === b.to;
const strictlyWider = (r: { from: number; to: number }, a: { from: number; to: number }) => r.from <= a.from && r.to >= a.to && !sameRange(r, a);

/**
 * Resolves every scenario's range so presets never collapse in concentrated pools (where e.g. the 90% preset
 * already covers 95% of volume):
 * - a 90/95% preset must come out strictly wider than the closest earlier smaller preset on the same pool;
 *   otherwise it's that range widened by 1 bin (90%) or 2 bins (95%) on each side. Defaults: A = 80%,
 *   B = A ± 1, C = B ± 2 unless the real presets are already wider.
 * - a preset still equal to an earlier range is widened by 1 bin per side until it's distinct.
 *   Widening is symmetric, so the active bin stays inside.
 * - manual ranges are kept as picked; an exact duplicate gets `sameAs` instead.
 * `items[i]` is null when that scenario's data isn't loaded; `key` identifies its pool.
 */
export function resolveRanges(items: ({ scenario: Scenario; data: BinData; key: string } | null)[]): (ResolvedRange | null)[] {
  const out: (ResolvedRange | null)[] = [];
  items.forEach((it) => {
    if (!it) {
      out.push(null);
      return;
    }
    const earlier = out.flatMap((r, j) => (r && items[j]!.key === it.key ? [{ r, j, sc: items[j]!.scenario }] : []));
    const sc = it.scenario;
    if (sc.range.kind === "manual") {
      const dup = earlier.find((e) => sameRange(e.r, sc.range as { from: number; to: number }));
      out.push({ from: sc.range.from, to: sc.range.to, widened: 0, widenedFrom: null, sameAs: dup ? dup.j : null });
      return;
    }
    const share = sc.range.share;
    let r = resolveRange(sc, it.data);
    let widened = 0;
    let widenedFrom: number | null = null;
    const anchor = earlier
      .filter((e) => e.sc.range.kind === "preset" && e.sc.range.share < share)
      .sort((a, b) => (b.sc.range as { share: number }).share - (a.sc.range as { share: number }).share || b.j - a.j)[0];
    if (anchor && !strictlyWider(r, anchor.r)) {
      widened = PRESET_STEP[share];
      widenedFrom = anchor.j;
      r = widen(anchor.r, widened);
    }
    for (let dup = earlier.find((e) => sameRange(e.r, r)); dup; dup = earlier.find((e) => sameRange(e.r, r))) {
      if (widenedFrom === null) widenedFrom = dup.j;
      widened++;
      r = widen(r, 1);
    }
    out.push({ from: r.from, to: r.to, widened, widenedFrom, sameAs: null });
  });
  return out;
}

/** Column title: preset name, plus the widening when a preset collapsed, e.g. "Wide (+1 bin each side)". */
export function scenarioTitle(s: Scenario, r: ResolvedRange | null): string {
  const name = scenarioName(s);
  return r && r.widened > 0 ? `${name} (+${r.widened} bin${r.widened === 1 ? "" : "s"} each side)` : name;
}

/** Verdicts with duplicate ranges collapsed: a column repeating an earlier range gets "Same range as X". */
export function verdictsWithDuplicates(list: (ScenarioMetrics | null)[], ranges: (ResolvedRange | null)[]): (string | null)[] {
  const dupOf = (i: number) => ranges[i]?.sameAs ?? null;
  const base = verdicts(list.map((m, i) => (dupOf(i) === null ? m : null)));
  return list.map((m, i) => {
    const d = dupOf(i);
    return d !== null && m ? `Same range as ${SCENARIO_LABELS[d]}` : base[i];
  });
}

const totalVolume = (data: BinData) => data.bins.reduce((a, b) => a + b.volumeFiat, 0);

/** Share of the window's volume that traded inside [from, to]; null when the window has no volume. */
export function volumeCovered(data: BinData, from: number, to: number): number | null {
  const total = totalVolume(data);
  if (total <= 0) return null;
  return binsInRange(data, from, to).reduce((a, b) => a + b.volumeFiat, 0) / total;
}

/** Bins in [from, to] whose window volume is ~0 (below IDLE_VOLUME_SHARE of the window's total). */
export function idleBins(data: BinData, from: number, to: number): number[] {
  const threshold = totalVolume(data) * IDLE_VOLUME_SHARE;
  return binsInRange(data, from, to)
    .filter((b) => b.volumeFiat <= threshold)
    .map((b) => b.idx);
}

/** Your share of the liquidity in the range after depositing: deposit / (Σ liquidity + deposit). */
export function liquidityShare(data: BinData, from: number, to: number, deposit: number): number {
  const liq = binsInRange(data, from, to).reduce((a, b) => a + b.liquidity, 0);
  return deposit > 0 ? deposit / (liq + deposit) : 0;
}

export interface ScenarioMetrics {
  from: number;
  to: number;
  bins: number;
  /** Range width in percent units (0.05 = 0.05%). */
  widthPct: number;
  volumeCovered: number | null;
  share: number;
  feeApr: number;
  feesSimple: number;
  feesCompounded: number;
  netApr: number | null;
  netUsd: number | null;
  /** Fee APR − net APR; null without net data. */
  priceDrag: number | null;
  token0Amount: number;
  token1Amount: number;
  token0Usd: number;
  token1Usd: number;
  idle: number[];
}

export function computeScenario(
  data: BinData,
  range: { from: number; to: number },
  strategy: Strategy,
  deposit: number,
  days: number,
  prices: Prices,
): ScenarioMetrics {
  const { from, to } = range;
  const e = estimateFromBins(data, from, to, strategy, deposit, prices);
  const p = projectFees(e.dailyFees, deposit, days);
  return {
    from,
    to,
    bins: to - from + 1,
    widthPct: getBin(data, to).highPct - getBin(data, from).lowPct,
    volumeCovered: volumeCovered(data, from, to),
    share: liquidityShare(data, from, to, deposit),
    feeApr: e.apr,
    feesSimple: p.simple,
    feesCompounded: p.compounded,
    netApr: e.netApr,
    netUsd: e.netDaily === null ? null : e.netDaily * days,
    priceDrag: e.netApr === null ? null : e.apr - e.netApr,
    token0Amount: e.token0Amount,
    token1Amount: e.token1Amount,
    token0Usd: e.token0Usd,
    token1Usd: e.token1Usd,
    idle: idleBins(data, from, to),
  };
}

// ---------- best per row ----------

export type MetricKey = "volumeCovered" | "share" | "feeApr" | "feesSimple" | "feesCompounded" | "netApr" | "netUsd" | "priceDrag" | "idle";

/** Which direction is better per row. Range width and tokens are informational (no "best"). */
export const BETTER: Record<MetricKey, "high" | "low"> = {
  volumeCovered: "high",
  share: "high",
  feeApr: "high",
  feesSimple: "high",
  feesCompounded: "high",
  netApr: "high",
  netUsd: "high",
  priceDrag: "low",
  idle: "low",
};

const valueOf = (m: ScenarioMetrics, k: MetricKey): number | null => (k === "idle" ? m.idle.length : m[k]);

/**
 * Indexes of the best scenario(s) per row. A row is highlighted only when at least two scenarios have a
 * value and they're not all equal; ties are all highlighted. Missing scenarios (null) are skipped.
 */
export function bestPerRow(list: (ScenarioMetrics | null)[]): Record<MetricKey, number[]> {
  const out = {} as Record<MetricKey, number[]>;
  for (const k of Object.keys(BETTER) as MetricKey[]) {
    const vals = list.map((m) => (m ? valueOf(m, k) : null));
    const present = vals.filter((v): v is number => v !== null);
    if (present.length < 2 || present.every((v) => Math.abs(v - present[0]) < 1e-12)) {
      out[k] = [];
      continue;
    }
    const best = BETTER[k] === "high" ? Math.max(...present) : Math.min(...present);
    out[k] = vals.flatMap((v, i) => (v !== null && Math.abs(v - best) < 1e-12 ? [i] : []));
  }
  return out;
}

// ---------- verdicts ----------

const pctText = (v: number) => `${Math.round(v * 100)}%`;

/**
 * One line per scenario, from the comparison:
 * - highest fee APR → "Highest fees" (+ ", but only X% of volume: earns nothing if price drifts" when it
 *   also has the lowest volume coverage)
 * - highest volume coverage (and not the highest fees) → "Safest: X% of volume, lower APR"
 * - best positive net APR → "Best net"
 * - negative net → "Net negative: price moves outweighed fees here"
 * - idle bins → "N idle bins: liquidity there earned ~nothing"
 * Up to two phrases, in that order of priority; "Balanced" when nothing stands out.
 */
export function verdicts(list: (ScenarioMetrics | null)[]): (string | null)[] {
  const present = list.filter((m): m is ScenarioMetrics => m !== null);
  if (present.length === 0) return list.map(() => null);
  const maxFee = Math.max(...present.map((m) => m.feeApr));
  const covs = present.map((m) => m.volumeCovered).filter((v): v is number => v !== null);
  const maxCov = covs.length ? Math.max(...covs) : null;
  const minCov = covs.length ? Math.min(...covs) : null;
  const nets = present.map((m) => m.netApr).filter((v): v is number => v !== null);
  const maxNet = nets.length ? Math.max(...nets) : null;
  const multi = present.length > 1;

  return list.map((m) => {
    if (!m) return null;
    const parts: string[] = [];
    const topFee = multi && m.feeApr === maxFee;
    const topCov = multi && m.volumeCovered !== null && m.volumeCovered === maxCov && maxCov !== minCov;
    const lowCov = multi && m.volumeCovered !== null && m.volumeCovered === minCov && maxCov !== minCov;
    if (topFee) parts.push(lowCov ? `Highest fees, but only ${pctText(m.volumeCovered!)} of volume: earns nothing if price drifts` : "Highest fees");
    if (topCov && !topFee) parts.push(`Safest: ${pctText(m.volumeCovered!)} of volume, lower APR`);
    if (multi && m.netApr !== null && m.netApr === maxNet && m.netApr > 0) parts.push("Best net");
    if (m.netApr !== null && m.netApr < 0) parts.push("Net negative: price moves outweighed fees here");
    if (m.idle.length > 0) parts.push(`${m.idle.length} idle bin${m.idle.length === 1 ? "" : "s"}: liquidity there earned ~nothing`);
    return parts.length ? parts.slice(0, 2).join(" · ") : "Balanced";
  });
}

export const scenarioName = (s: Scenario) => (s.range.kind === "preset" ? SCENARIO_NAMES[s.range.share] : "Custom");

// ---------- page URL state ----------

export interface CompareState {
  chain: number | null;
  pool: string | null;
  amount: number;
  days: number;
  period: PlannerState["period"];
  scenarios: Scenario[];
}

/** /compare URL: the planner's pool/deposit/duration/period params plus `cmp` (defaults: 80/90/95%). */
export function readCompareState(q: URLSearchParams): CompareState {
  const s = readState(q);
  return { chain: s.chain, pool: s.pool, amount: s.amount, days: s.days, period: s.period, scenarios: decodeScenarios(q.get("cmp")) ?? DEFAULT_SCENARIOS };
}

export function writeCompareState(s: CompareState): string {
  const q = new URLSearchParams();
  if (s.chain !== null) q.set("chain", String(s.chain));
  if (s.pool) q.set("pool", s.pool);
  q.set("amount", String(s.amount));
  q.set("days", String(s.days));
  q.set("period", s.period);
  q.set("cmp", encodeScenarios(s.scenarios));
  return q.toString();
}

// ---------- no-trade columns ----------

/** Column warning when a scenario's pool had no trades in the data period. */
export const noTradesColumnText = (period: string) => `No trades in the last ${period}: no fees to estimate`;

/**
 * Metrics that take part in best-value highlights and verdicts: a column whose pool had no trades in the
 * data period drops out (its numbers are all ~0 and would otherwise "win" rows like price drag).
 */
export function comparableMetrics(list: (ScenarioMetrics | null)[], noTrades: boolean[]): (ScenarioMetrics | null)[] {
  return list.map((m, i) => (noTrades[i] ? null : m));
}
