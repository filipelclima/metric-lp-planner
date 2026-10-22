import type { Tier } from "./types";

/** Plain-English labels for known classification reason codes. Unknown codes are humanized. */
const REASONS: Record<string, string> = {
  LOW_TVL: "Low total value locked — small pools move more on each trade.",
  LOW_LIQUIDITY: "Thin liquidity — trades and withdrawals can move the price.",
  LOW_VOLUME: "Little trading volume — fee estimates are noisy.",
  NEGATIVE_PNL: "LPs in this pool have recently lost money on price moves.",
  NEGATIVE_TRADING_PNL: "LPs in this pool have recently lost money on price moves.",
  HIGH_VOLATILITY: "The price is volatile — your position can drift out of range or lose value.",
  PRICE_PROVIDER_STALE: "The oracle price feed has been stale.",
  PRICE_PROVIDER_UNHEALTHY: "The oracle price feed is not healthy.",
  UNVERIFIED_ADMIN: "The pool curator is not verified.",
  UNVERIFIED_CURATOR: "The pool curator is not verified.",
  PAUSED: "The pool is (partly) paused.",
  NEW_POOL: "The pool is new, so there is little history to estimate from.",
  YOUNG_POOL: "The pool is new, so there is little history to estimate from.",
  HIGH_FEES: "Pool admin/protocol fees are high.",
};

export function reasonText(code: string): string {
  const key = code.toUpperCase().replace(/[\s-]+/g, "_");
  if (REASONS[key]) return REASONS[key];
  const words = code.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase().trim();
  return words ? words[0].toUpperCase() + words.slice(1) + "." : code;
}

export const TIER_LABEL: Record<Tier, string> = {
  green: "Green tier",
  yellow: "Yellow tier",
  red: "Red tier",
  unknown: "Unclassified",
};

/** Heuristic health for the price provider status string. */
export function providerHealth(status: string | null): "ok" | "warn" | "bad" | "unknown" {
  if (!status) return "unknown";
  const s = status.toLowerCase();
  // Order matters: "unhealthy" / "inactive" contain the "ok" words.
  if (/(down|error|fail|paused|halt|inactive|unhealthy|invalid)/.test(s)) return "bad";
  if (/(stale|delay|degraded|cooldown|warn)/.test(s)) return "warn";
  if (/(^ok$|healthy|active|live|normal|fresh|valid)/.test(s)) return "ok";
  return "unknown";
}
