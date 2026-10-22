/**
 * Glue between URL state, API data and the calc module, shared by the page and the share image.
 * No fee math here — it only picks the range and the estimate function from calc.ts.
 */
import { estimateFromBins, estimateFromPool, presetRange, type BinData, type Estimate, type Prices } from "./calc";
import type { Pool } from "./types";
import type { PlannerState } from "./urlState";

export function resolveRange(s: PlannerState, binData: BinData | null, curBinIdx: number): { from: number; to: number } | null {
  if (s.range.kind === "manual") return { from: s.range.from, to: s.range.to };
  if (!binData) return null;
  return presetRange(binData, s.range.share / 100) ?? { from: curBinIdx - 5, to: curBinIdx + 5 };
}

export function computeEstimate(
  s: PlannerState,
  pool: Pool | null,
  binData: BinData | null,
  range: { from: number; to: number } | null,
  binsFailed: boolean,
): Estimate | null {
  if (!pool || !(s.amount > 0)) return null;
  const prices: Prices = { token0: pool.token0.fiatPrice, token1: pool.token1.fiatPrice };
  if (binData && range) return estimateFromBins(binData, range.from, range.to, s.strategy, s.amount, prices);
  if (binsFailed) return estimateFromPool(pool, s.amount);
  return null;
}

export const NET_NOTE = "Net is based on a short window and is very volatile per bin. Use 30d for a steadier view.";
