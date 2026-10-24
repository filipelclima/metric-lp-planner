/**
 * Landing (planner with no pool selected): stats strip, "Trending pools" picks and the auto-typing
 * placeholder. Pure; reuses the ranking module's rows and highlights.
 */
import { tradeBadge } from "./activity";
import { highlights, toRow, type RankRow } from "./ranking";
import type { Pool } from "./types";

export interface LandingStats {
  tvl: number;
  vol24h: number;
  /** Pools that traded in the last 24h and aren't paused. */
  activePools: number;
}

export function landingStats(pools: Pool[]): LandingStats {
  let tvl = 0;
  let vol24h = 0;
  let activePools = 0;
  for (const p of pools) {
    tvl += p.tvlFiat > 0 ? p.tvlFiat : 0;
    const v = p.analytics24h?.volumeFiat ?? 0;
    vol24h += v > 0 ? v : 0;
    if (v > 0 && p.pauseLevel === 0) activePools++;
  }
  return { tvl, vol24h, activePools };
}

/** Pools the landing may recommend: open, unpaused, healthy feed, ≥ $25k TVL, not High Risk, traded today. */
export const TRENDING_MIN_TVL = 25_000;
const HIGH_RISK = new Set(["red", "black"]);

export interface Trending {
  /** Best net APR among fee-driven pools (net ≤ fee), as on Top pools. */
  bestNet: RankRow | null;
  topVolume: RankRow | null;
  /** Best Practices tier, highest TVL. */
  safest: RankRow | null;
}

function maxBy(rows: RankRow[], f: (r: RankRow) => number | null, skip: Set<string>): RankRow | null {
  let best: RankRow | null = null;
  let bv = -Infinity;
  for (const r of rows) {
    const v = f(r);
    if (v === null || skip.has(key(r))) continue;
    if (v > bv) [best, bv] = [r, v];
  }
  return best;
}
const key = (r: RankRow) => `${r.chainId}:${r.pool.toLowerCase()}`;

/** Three distinct picks when possible (a pool that already won a card is skipped by the next ones). */
export function trendingPools(pools: Pool[]): Trending {
  const rows = pools
    .map(toRow)
    .filter((r) => !r.isPrivate && !r.paused && r.healthy && r.tvl >= TRENDING_MIN_TVL && !HIGH_RISK.has(r.tier) && tradeBadge(r.vol24h, r.feeApr) === null);
  const used = new Set<string>();
  const bestNet = highlights(rows).bestNet;
  if (bestNet) used.add(key(bestNet));
  const topVolume = maxBy(rows, (r) => r.vol24h, used) ?? maxBy(rows, (r) => r.vol24h, new Set());
  if (topVolume) used.add(key(topVolume));
  const green = rows.filter((r) => r.tier === "green");
  const safest = maxBy(green, (r) => r.tvl, used) ?? maxBy(green, (r) => r.tvl, new Set());
  return { bestNet, topVolume, safest };
}

// ---------- auto-typing placeholder ----------

export interface TypeTiming {
  /** ms per typed character */
  type: number;
  /** ms per erased character */
  erase: number;
  /** ms the full sentence stays */
  hold: number;
  /** ms of empty input between sentences */
  gap: number;
}
export const TYPE_TIMING: TypeTiming = { type: 45, erase: 18, hold: 1800, gap: 350 };

/** The placeholder text `elapsed` ms into a loop that types, holds, erases each sentence in turn. */
export function typewriterText(sentences: string[], elapsed: number, t: TypeTiming = TYPE_TIMING): string {
  if (!sentences.length) return "";
  const spans = sentences.map((s) => s.length * t.type + t.hold + s.length * t.erase + t.gap);
  const total = spans.reduce((a, b) => a + b, 0);
  let ms = ((elapsed % total) + total) % total;
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    if (ms >= spans[i]) {
      ms -= spans[i];
      continue;
    }
    const typing = s.length * t.type;
    if (ms < typing) return s.slice(0, Math.floor(ms / t.type) + 1);
    ms -= typing;
    if (ms < t.hold) return s;
    ms -= t.hold;
    const erasing = s.length * t.erase;
    if (ms < erasing) return s.slice(0, s.length - Math.floor(ms / t.erase) - 1);
    return "";
  }
  return "";
}
