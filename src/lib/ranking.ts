/**
 * Pure ranking / filtering for the Top pools page. No network access — unit-tested.
 *
 * APRs are fractions (0.6 = 60%). Net APR is Metric's tradingPnlAprBps7d, which already INCLUDES fees
 * (fees + price moves), so the two are never added: price drag = fee APR − net APR.
 */
import { tradeBadge } from "./activity";
import type { Pool, Tier } from "./types";

export interface RankRow {
  chainId: number;
  pool: string;
  pair: string;
  token0: { symbol: string; logoUrl?: string };
  token1: { symbol: string; logoUrl?: string };
  tier: Tier;
  isPrivate: boolean;
  verified: boolean;
  healthy: boolean;
  paused: boolean;
  tvl: number;
  vol24h: number | null;
  fees24h: number | null;
  feeApr: number | null;
  netApr: number | null;
  /** Fee APR − net APR: how much price moves ate. */
  priceDrag: number | null;
  /** 24h volume / TVL. */
  efficiency: number | null;
}

export function toRow(p: Pool): RankRow {
  const feeApr = p.aprBps7d === null ? null : p.aprBps7d / 1e4;
  const netApr = p.tradingPnlAprBps7d === null ? null : p.tradingPnlAprBps7d / 1e4;
  const vol24h = p.analytics24h?.volumeFiat ?? null;
  return {
    chainId: p.chainId,
    pool: p.poolAddress,
    pair: p.pair,
    token0: { symbol: p.token0.symbol, logoUrl: p.token0.logoUrl },
    token1: { symbol: p.token1.symbol, logoUrl: p.token1.logoUrl },
    tier: p.tier,
    isPrivate: p.isPrivate,
    verified: p.verifiedAdmin,
    healthy: p.priceProviderStatus === "healthy",
    paused: p.pauseLevel > 0,
    tvl: p.tvlFiat,
    vol24h,
    fees24h: p.analytics24h?.feesFiat ?? null,
    feeApr,
    netApr,
    priceDrag: feeApr !== null && netApr !== null ? feeApr - netApr : null,
    efficiency: vol24h !== null && p.tvlFiat > 0 ? vol24h / p.tvlFiat : null,
  };
}

// ---------- filters ----------

export type TierFilter = "all" | "no-high-risk" | "best-practices";

export interface Filters {
  chain: number | null;
  tier: TierFilter;
  /** Excludes tiny pools whose APRs are absurd on a few dollars of liquidity. */
  minTvl: number;
  verifiedOnly: boolean;
  /** Also show paused, unhealthy-oracle and private (deposit-whitelisted) pools. */
  showAll: boolean;
}

export const DEFAULT_FILTERS: Filters = { chain: null, tier: "no-high-risk", minTvl: 25_000, verifiedOnly: false, showAll: false };
export const MIN_TVL_OPTIONS = [0, 10_000, 25_000, 100_000, 1_000_000];

const HIGH_RISK: Tier[] = ["red", "black"];

/** Pools a user can actually deposit into right now. */
export const isActive = (r: RankRow) => !r.paused && r.healthy && !r.isPrivate;

export function filterRows(rows: RankRow[], f: Filters): RankRow[] {
  return rows.filter(
    (r) =>
      (f.chain === null || r.chainId === f.chain) &&
      (f.tier === "all" || (f.tier === "no-high-risk" ? !HIGH_RISK.includes(r.tier) : r.tier === "green")) &&
      r.tvl >= f.minTvl &&
      (!f.verifiedOnly || r.verified) &&
      (f.showAll || isActive(r)),
  );
}

// ---------- sorting ----------

export type SortKey = "pair" | "tier" | "tvl" | "vol24h" | "feeApr" | "netApr" | "priceDrag" | "efficiency";
export type SortDir = "asc" | "desc";
export const DEFAULT_SORT: { key: SortKey; dir: SortDir } = { key: "netApr", dir: "desc" };

/** Tier rank for sorting: best first when descending. */
const TIER_RANK: Record<Tier, number> = { green: 4, yellow: 3, unclassified: 2, red: 1, black: 0 };

function sortValue(r: RankRow, key: SortKey): number | string | null {
  if (key === "pair") return r.pair.toLowerCase();
  if (key === "tier") return TIER_RANK[r.tier];
  return r[key];
}

/** Stable sort; rows with no value for the key always go last, whatever the direction. Ties break by TVL. */
export function sortRows(rows: RankRow[], key: SortKey, dir: SortDir): RankRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i, v: sortValue(r, key) }))
    .sort((a, b) => {
      if (a.v === null && b.v === null) return a.i - b.i;
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      const c = typeof a.v === "string" ? a.v.localeCompare(b.v as string) : (a.v as number) - (b.v as number);
      return c !== 0 ? sign * c : b.r.tvl - a.r.tvl || a.i - b.i;
    })
    .map((x) => x.r);
}

// ---------- price-driven vs fee-driven ----------

/** Net above 1.5× fee APR means most of the return came from price moves, not fees. */
export const PRICE_DRIVEN_RATIO = 1.5;

/** Net APR > fee APR × 1.5: the 7d return was mostly price luck and may not repeat. */
export function isPriceDriven(r: Pick<RankRow, "feeApr" | "netApr">): boolean {
  return r.netApr !== null && r.feeApr !== null && r.netApr > r.feeApr * PRICE_DRIVEN_RATIO;
}

/** Net APR ≤ fee APR: price moves didn't add to the return, so it's earned from fees. */
export function isFeeDriven(r: Pick<RankRow, "feeApr" | "netApr">): boolean {
  return r.netApr !== null && r.feeApr !== null && r.netApr <= r.feeApr;
}

// ---------- highlights ----------

export interface Highlights {
  /** Best net APR among fee-driven pools only (net ≤ fee), so price luck doesn't win. */
  bestNet: RankRow | null;
  /** Highest fee APR among pools whose net APR is negative: fees look great, price moves ate more. */
  trap: RankRow | null;
  /** Highest 24h volume / TVL among pools with traded volume and a non-negative net APR. */
  mostEfficient: RankRow | null;
}

function maxBy(rows: RankRow[], f: (r: RankRow) => number | null): RankRow | null {
  let best: RankRow | null = null;
  let bv = -Infinity;
  for (const r of rows) {
    const v = f(r);
    if (v !== null && v > bv) [best, bv] = [r, v];
  }
  return best;
}

/** Highlight cards skip pools with no trades (24h volume 0, see lib/activity.ts): nothing to recommend there. */
export function highlights(all: RankRow[]): Highlights {
  const rows = all.filter((r) => tradeBadge(r.vol24h, r.feeApr) === null);
  return {
    bestNet: maxBy(rows.filter(isFeeDriven), (r) => r.netApr),
    trap: maxBy(
      rows.filter((r) => r.netApr !== null && r.netApr < 0),
      (r) => r.feeApr,
    ),
    mostEfficient: maxBy(
      rows.filter((r) => !(r.netApr !== null && r.netApr < 0)),
      (r) => (r.vol24h && r.vol24h > 0 ? r.efficiency : null),
    ),
  };
}

// ---------- weekly post ----------

/** "60.1%" under 100%, "108%" from 100% up. */
export function fmtPostPct(fraction: number): string {
  const p = fraction * 100;
  return `${Math.abs(p) >= 100 ? Math.round(p) : p.toFixed(1)}%`;
}

/** Top N by net APR (rows without a net APR excluded). */
export function topByNet(rows: RankRow[], n = 5): RankRow[] {
  return sortRows(
    rows.filter((r) => r.netApr !== null),
    "netApr",
    "desc",
  ).slice(0, n);
}

export function weeklyPost(rows: RankRow[], opts: { url: string; chainName?: string | null; n?: number }): string {
  const top = topByNet(rows, opts.n ?? 5);
  const scope = opts.chainName ? ` on ${opts.chainName}` : "";
  const lines = [
    `Top ${top.length} @metricxyz pools${scope} by NET APR (7d, fees + price moves):`,
    ...top.map((r, i) => `${i + 1}. ${r.pair} ${fmtPostPct(r.netApr!)} (fee ${r.feeApr === null ? "n/a" : fmtPostPct(r.feeApr)})`),
    `Plan your bins → ${opts.url}`,
    "Historical data, not financial advice.",
  ];
  return lines.join("\n");
}

export function planUrl(r: Pick<RankRow, "chainId" | "pool">): string {
  return `/?chain=${r.chainId}&pool=${r.pool}&amount=1000&days=30&preset=90&strategy=uniform&period=7d`;
}

export const metricPoolUrl = (r: Pick<RankRow, "chainId" | "pool">) => `https://app.metric.xyz/pool/${r.chainId}/${r.pool}`;

// ---------- URL state ----------

const SORT_KEYS: SortKey[] = ["pair", "tier", "tvl", "vol24h", "feeApr", "netApr", "priceDrag", "efficiency"];
const TIERS: TierFilter[] = ["all", "no-high-risk", "best-practices"];

export function readRankingState(q: { get(k: string): string | null }): { filters: Filters; sort: { key: SortKey; dir: SortDir } } {
  const chain = Number(q.get("chain"));
  const minTvl = Number(q.get("minTvl"));
  const tier = q.get("tier") as TierFilter;
  const key = q.get("sort") as SortKey;
  return {
    filters: {
      chain: [1, 56, 4663].includes(chain) ? chain : null,
      tier: TIERS.includes(tier) ? tier : DEFAULT_FILTERS.tier,
      minTvl: MIN_TVL_OPTIONS.includes(minTvl) && q.get("minTvl") !== null ? minTvl : DEFAULT_FILTERS.minTvl,
      verifiedOnly: q.get("verified") === "1",
      showAll: q.get("all") === "1",
    },
    sort: { key: SORT_KEYS.includes(key) ? key : DEFAULT_SORT.key, dir: q.get("dir") === "asc" ? "asc" : "desc" },
  };
}

export function writeRankingState(f: Filters, sort: { key: SortKey; dir: SortDir }): string {
  const q = new URLSearchParams();
  if (f.chain !== null) q.set("chain", String(f.chain));
  if (f.tier !== DEFAULT_FILTERS.tier) q.set("tier", f.tier);
  if (f.minTvl !== DEFAULT_FILTERS.minTvl) q.set("minTvl", String(f.minTvl));
  if (f.verifiedOnly) q.set("verified", "1");
  if (f.showAll) q.set("all", "1");
  if (sort.key !== DEFAULT_SORT.key) q.set("sort", sort.key);
  if (sort.dir !== DEFAULT_SORT.dir) q.set("dir", sort.dir);
  return q.toString();
}
