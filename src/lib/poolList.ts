/**
 * Pool picker list: sorting, filters and the APR period, plus their URL / localStorage persistence.
 * Pure (the hook lives in usePickerPrefs.ts).
 */
import { bpsToFraction } from "./calc";
import { CHAINS, type Pool } from "./types";

export type PoolSort = "pair" | "chain" | "tvl" | "apr";
export type SortDir = "asc" | "desc";
export type AprPeriod = "24h" | "7d";

export const TVL_FLOORS = [0, 1e4, 1e5, 1e6] as const;
export type TvlFloor = (typeof TVL_FLOORS)[number];
const TVL_CODE: Record<TvlFloor, string> = { 0: "any", 1e4: "10k", 1e5: "100k", 1e6: "1m" };
export const TVL_LABEL: Record<TvlFloor, string> = { 0: "Any", 1e4: "≥$10k", 1e5: "≥$100k", 1e6: "≥$1M" };

export interface PickerPrefs {
  sort: PoolSort;
  dir: SortDir;
  period: AprPeriod;
  minTvl: TvlFloor;
  chain: number | "all";
  /** Also list inactive pools (no 7d volume and TVL < $10k). */
  showInactive: boolean;
  /** Hide private (deposit-allowlisted) pools. On by default. */
  hidePrivate: boolean;
}

export const DEFAULT_PREFS: PickerPrefs = { sort: "tvl", dir: "desc", period: "7d", minTvl: 1e4, chain: "all", showInactive: false, hidePrivate: true };

/** Pools under this TVL with no 7d trading count as inactive. */
export const INACTIVE_TVL = 1e4;

/**
 * No trading in the last 7 days and TVL < $10k. /metadata has no 7d volume, so "no 7d volume" means a 7d fee
 * APR of 0 (or missing) and no 24h volume: fees only come from swaps.
 */
export function isInactivePool(p: Pool): boolean {
  const noTrades7d = !(p.aprBps7d ?? 0) && !(p.analytics24h?.volumeFiat ?? 0);
  return noTrades7d && p.tvlFiat < INACTIVE_TVL;
}

/** Direction a column starts in when first clicked: text ascending, numbers high → low. */
export const FIRST_DIR: Record<PoolSort, SortDir> = { pair: "asc", chain: "asc", tvl: "desc", apr: "desc" };

/** Clicking the active column flips its direction; another column starts at its natural direction. */
export function toggleSort(p: PickerPrefs, sort: PoolSort): PickerPrefs {
  return p.sort === sort ? { ...p, dir: p.dir === "asc" ? "desc" : "asc" } : { ...p, sort, dir: FIRST_DIR[sort] };
}

/** APR (fraction) for the chosen period: 24h = analytics24h.aprBps, 7d = aprBps7d; null when missing. */
export function poolApr(p: Pool, period: AprPeriod): number | null {
  const bps = period === "24h" ? (p.analytics24h?.aprBps ?? null) : p.aprBps7d;
  return bps === null || !Number.isFinite(bps) ? null : bpsToFraction(bps);
}

const chainName = (id: number) => CHAINS[id]?.short ?? String(id);

function matches(p: Pool, q: string): boolean {
  return (
    !q ||
    p.pair.toLowerCase().includes(q) ||
    p.token0.symbol.toLowerCase().includes(q) ||
    p.token1.symbol.toLowerCase().includes(q) ||
    p.poolAddress.toLowerCase().includes(q)
  );
}

/**
 * Filters by search, chain, TVL floor and inactivity (all combined), then sorts. Pools without a value for the
 * sort key (APR for the period) always go last, whatever the direction. Ties: higher TVL first, then pair.
 * `total` is every pool loaded, for "Showing X of Y pools".
 */
export function filterSortPools(pools: Pool[], prefs: PickerPrefs, query = ""): { pools: Pool[]; total: number } {
  const q = query.trim().toLowerCase();
  const kept = pools.filter(
    (p) => (prefs.chain === "all" || p.chainId === prefs.chain) && matches(p, q) && p.tvlFiat >= prefs.minTvl && (prefs.showInactive || !isInactivePool(p)) && !(prefs.hidePrivate && p.isPrivate),
  );
  const key = (p: Pool): number | string | null =>
    prefs.sort === "pair" ? p.pair.toLowerCase() : prefs.sort === "chain" ? chainName(p.chainId) : prefs.sort === "tvl" ? p.tvlFiat : poolApr(p, prefs.period);
  const sign = prefs.dir === "asc" ? 1 : -1;
  const sorted = [...kept].sort((a, b) => {
    // Private (deposit-allowlisted) pools go after open ones in every sort: most users can't deposit there.
    if (!!a.isPrivate !== !!b.isPrivate) return a.isPrivate ? 1 : -1;
    const ka = key(a);
    const kb = key(b);
    if (ka === null || kb === null) {
      if (ka !== kb) return ka === null ? 1 : -1;
    } else if (ka !== kb) {
      return sign * (typeof ka === "string" ? ka.localeCompare(kb as string) : (ka as number) - (kb as number));
    }
    return b.tvlFiat - a.tvlFiat || a.pair.localeCompare(b.pair);
  });
  return { pools: sorted, total: pools.length };
}

// ---------- persistence ----------
// URL params (only non-defaults are written): psort=pair|chain|tvl|apr, pdir=asc|desc, papr=24h|7d,
// ptvl=any|10k|100k|1m, pchain=<chainId>, pinactive=1, pprivate=1 (show private pools).

export const PICKER_PARAMS = ["psort", "pdir", "papr", "ptvl", "pchain", "pinactive", "pprivate"] as const;
export const PICKER_STORAGE_KEY = "binwise.poolPicker";

const SORTS: PoolSort[] = ["pair", "chain", "tvl", "apr"];

/** Reads prefs from a param-like source; invalid values fall back to defaults. */
function fromParams(get: (k: string) => string | null): PickerPrefs {
  const sort = get("psort") as PoolSort;
  const dir = get("pdir");
  const period = get("papr");
  const tvl = (Object.entries(TVL_CODE) as [string, string][]).find(([, c]) => c === get("ptvl"));
  const chain = get("pchain");
  const s = SORTS.includes(sort) ? sort : DEFAULT_PREFS.sort;
  return {
    sort: s,
    dir: dir === "asc" || dir === "desc" ? dir : SORTS.includes(sort) ? FIRST_DIR[s] : DEFAULT_PREFS.dir,
    period: period === "24h" || period === "7d" ? period : DEFAULT_PREFS.period,
    minTvl: tvl ? (Number(tvl[0]) as TvlFloor) : DEFAULT_PREFS.minTvl,
    chain: chain !== null && /^\d+$/.test(chain) && CHAINS[Number(chain)] ? Number(chain) : "all",
    showInactive: get("pinactive") === "1",
    hidePrivate: get("pprivate") !== "1",
  };
}

/** URL wins when it has any picker param; otherwise the stored prefs; otherwise defaults. */
export function readPickerPrefs(q: URLSearchParams, stored: string | null): PickerPrefs {
  if (PICKER_PARAMS.some((k) => q.has(k))) return fromParams((k) => q.get(k));
  if (stored) {
    try {
      const o = JSON.parse(stored) as Record<string, unknown>;
      return fromParams((k) => (typeof o[k] === "string" ? (o[k] as string) : null));
    } catch {
      /* corrupt storage → defaults */
    }
  }
  return { ...DEFAULT_PREFS };
}

/** Non-default prefs as URL params (empty when everything is default). */
export function pickerParams(p: PickerPrefs): URLSearchParams {
  const q = new URLSearchParams();
  if (p.sort !== DEFAULT_PREFS.sort) q.set("psort", p.sort);
  if (p.dir !== FIRST_DIR[p.sort]) q.set("pdir", p.dir);
  if (p.period !== DEFAULT_PREFS.period) q.set("papr", p.period);
  if (p.minTvl !== DEFAULT_PREFS.minTvl) q.set("ptvl", TVL_CODE[p.minTvl]);
  if (p.chain !== "all") q.set("pchain", String(p.chain));
  if (p.showInactive) q.set("pinactive", "1");
  if (!p.hidePrivate) q.set("pprivate", "1");
  return q;
}

/** JSON for localStorage, same keys as the URL. */
export const serializePrefs = (p: PickerPrefs) => JSON.stringify({ psort: p.sort, pdir: p.dir, papr: p.period, ptvl: TVL_CODE[p.minTvl], pchain: p.chain === "all" ? null : String(p.chain), pinactive: p.showInactive ? "1" : null, pprivate: p.hidePrivate ? null : "1" });

/** Appends picker params to a page query string. */
export function withPickerParams(qs: string, p: PickerPrefs): string {
  const extra = pickerParams(p).toString();
  return extra ? (qs ? `${qs}&${extra}` : extra) : qs;
}
