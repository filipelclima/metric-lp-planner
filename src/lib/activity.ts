/**
 * "No trades" badge rule, shared by the pool picker and Top pools.
 * - 24h volume is 0 (or missing) → "No trades today" (it may still have traded earlier this week)
 * - …and the 7d fee APR is 0 or missing too → "No trades 7d" (fees only come from swaps, so no 7d fees = no 7d trades)
 */
export type TradeBadge = "No trades today" | "No trades 7d";

export function tradeBadge(vol24h: number | null | undefined, feeApr7d: number | null | undefined): TradeBadge | null {
  if ((vol24h ?? 0) > 0) return null;
  return (feeApr7d ?? 0) > 0 ? "No trades today" : "No trades 7d";
}

export const TRADE_BADGE_TITLE: Record<TradeBadge, string> = {
  "No trades today": "No swaps in the last 24h, but the pool did trade earlier this week (its 7d fee APR is above 0).",
  "No trades 7d": "No swaps in the last 24h or 7 days: the pool earned no fees, so there's nothing to estimate.",
};
