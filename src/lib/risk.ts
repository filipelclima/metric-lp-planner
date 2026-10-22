import type { PriceProviderStatus, Tier } from "./types";

/** Metric classification reason codes in plain English. */
export const REASONS: Record<string, string> = {
  bin_width_exceeded: "Bins are wider than 1%",
  stop_loss_missing: "No StopLoss protection attached",
  stop_loss_uninitialized: "StopLoss attached but not initialized",
  stop_loss_mutable: "StopLoss settings can still be changed by the curator",
  stop_loss_drawdown_exceeded: "StopLoss allows drawdowns above 15%",
  stop_loss_decay_exceeded: "StopLoss decay is above 15% per day",
  app_missing: "Not priced by an Anchored Price Provider",
  app_mutable: "Price provider parameters can be changed",
  feed_staleness_exceeded: "Price feed can be more than 15s stale",
  price_provider_mutable: "The pool's price provider can be replaced",
  curator_unverified: "Curator is not verified by Metric",
  curator_not_creator: "Curator is not the pool's creator",
  remove_liquidity_extension_present: "An extension can block withdrawals",
  anchored_feed_unmatched: "Oracle feeds can't be confirmed to match the pool's tokens",
  multiplier_feed_miswired: "Tokenized-stock multiplier oracle is miswired",
  multiplier_token_unscaled: "Tokenized stock priced without its issuer multiplier",
};

/** Unknown (new) codes are shown verbatim rather than guessed at. */
export const reasonText = (code: string) => REASONS[code] ?? code;

export const TIER_LABEL: Record<Tier, string> = {
  green: "Best Practices",
  yellow: "Neutral",
  red: "High Risk",
  black: "Delisted by Metric",
  unclassified: "Unclassified",
};

export const PROVIDER_LABEL: Record<PriceProviderStatus, string> = {
  healthy: "Healthy",
  feed_down: "Feed down",
  pool_refused: "Pool refused",
  pool_paused: "Pool paused",
  unknown: "Unknown",
};

export function providerHealth(status: PriceProviderStatus): "ok" | "bad" | "unknown" {
  if (status === "healthy") return "ok";
  if (status === "unknown") return "unknown";
  return "bad";
}
