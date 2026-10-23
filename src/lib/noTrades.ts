/**
 * Empty state for a data window with no trades: no fees were earned, so there's nothing to estimate.
 * Pure: the caller fetches the longer windows and passes them in.
 */
import type { BinData } from "./calc";
import { hasVolume } from "./rangeInputs";
import type { Period } from "./types";

export const PERIOD_ORDER: Period[] = ["24h", "7d", "30d"];

/** Data periods longer than `p` (24h → 7d, 30d; 7d → 30d; 30d → none). */
export const longerPeriods = (p: Period): Period[] => PERIOD_ORDER.slice(PERIOD_ORDER.indexOf(p) + 1);

export const noTradesMessage = (p: Period) => `No trades in the last ${p}: this pool earned no fees, so there's nothing to estimate.`;

export interface NoTradesState {
  message: string;
  /** Longer periods that do have volume, shortest first: offered as "Use 7d data" etc. */
  switchTo: Period[];
}

/**
 * null when the window has volume (normal results). Otherwise the message plus the longer periods worth
 * offering: only those whose data is loaded and has volume (unloaded or empty ones aren't offered).
 */
export function noTradesState(data: BinData, period: Period, longer: Partial<Record<Period, BinData | null>>): NoTradesState | null {
  if (hasVolume(data)) return null;
  return {
    message: noTradesMessage(period),
    switchTo: longerPeriods(period).filter((p) => {
      const d = longer[p];
      return !!d && hasVolume(d);
    }),
  };
}
