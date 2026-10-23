/**
 * "No trades" badge rule, shared by the pool picker and Top pools.
 * - 24h volume is 0 (or missing) → "No trades"
 * - …and the 7d fee APR is 0 or missing too → "No trades 7d" (fees only come from swaps, so no 7d fees = no 7d trades)
 */
export type TradeBadge = "No trades" | "No trades 7d";

export function tradeBadge(vol24h: number | null | undefined, feeApr7d: number | null | undefined): TradeBadge | null {
  if ((vol24h ?? 0) > 0) return null;
  return (feeApr7d ?? 0) > 0 ? "No trades" : "No trades 7d";
}

export const TRADE_BADGE_TITLE: Record<TradeBadge, string> = {
  "No trades": "No swaps in the last 24h: the pool earned no fees today.",
  "No trades 7d": "No swaps in the last 24h or 7 days: the pool earned no fees, so there's nothing to estimate.",
};
