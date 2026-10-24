/**
 * Interactive bin ruler (Bin plan) and histogram zoom: which bins to show, how strongly to tint them, and
 * how clicks, drags, edge handles and keys change the range. Pure.
 */
import type { BinData } from "./calc";

export interface Range {
  from: number;
  to: number;
}

/** Bins the ruler shows: the range and the active bin plus context, at least `minCells` wide. */
export function rulerWindow(data: BinData, r: Range, minCells = 24): { lo: number; hi: number } {
  const cur = data.curBinIdx;
  let lo = Math.min(r.from, cur);
  let hi = Math.max(r.to, cur);
  const span = hi - lo + 1;
  const pad = span > 60 ? 1 : span > 30 ? 2 : 4;
  lo -= pad;
  hi += pad;
  const missing = minCells - (hi - lo + 1);
  if (missing > 0) {
    lo -= Math.floor(missing / 2);
    hi += Math.ceil(missing / 2);
  }
  return { lo, hi };
}

/** Each bin's share of the window's volume, scaled so the busiest bin is 1 (0 for no volume). */
export function volumeIntensity(data: BinData, lo: number, hi: number): Map<number, number> {
  const out = new Map<number, number>();
  let max = 0;
  for (const b of data.bins) if (b.idx >= lo && b.idx <= hi) max = Math.max(max, b.volumeFiat);
  for (let i = lo; i <= hi; i++) {
    const b = i >= data.minIdx && i <= data.maxIdx ? data.bins[i - data.minIdx] : null;
    out.set(i, max > 0 && b ? b.volumeFiat / max : 0);
  }
  return out;
}

/** The bin under x (px) in a strip `width` px wide showing bins lo..hi; clamped to the strip. */
export function idxFromX(x: number, width: number, lo: number, hi: number): number {
  const n = hi - lo + 1;
  if (width <= 0) return lo;
  const i = lo + Math.floor((x / width) * n);
  return Math.max(lo, Math.min(hi, i));
}

/** Click-and-drag from `anchor` to `idx` (either direction); a click is a 1-bin range. */
export const dragRange = (anchor: number, idx: number): Range => ({ from: Math.min(anchor, idx), to: Math.max(anchor, idx) });

/** Dragging one edge handle: it can't cross the other edge (stops at a 1-bin range). */
export function resizeRange(r: Range, edge: "from" | "to", idx: number): Range {
  return edge === "from" ? { from: Math.min(idx, r.to), to: r.to } : { from: r.from, to: Math.max(idx, r.from) };
}

/**
 * Keyboard: ←/→ move the whole selection one bin; Shift+→ grows it to the right, Shift+← shrinks it from the
 * right (never below 1 bin). Optional bounds keep it inside the pool's bins. null = key not handled.
 */
export function keyRange(r: Range, key: string, shift: boolean, bounds?: { min: number; max: number }): Range | null {
  const min = bounds?.min ?? -Infinity;
  const max = bounds?.max ?? Infinity;
  if (key !== "ArrowLeft" && key !== "ArrowRight") return null;
  const d = key === "ArrowRight" ? 1 : -1;
  if (shift) return { from: r.from, to: Math.max(r.from, Math.min(max, r.to + d)) };
  if (r.from + d < min || r.to + d > max) return r;
  return { from: r.from + d, to: r.to + d };
}

/**
 * Histogram auto-zoom: bins that hold liquidity or traded, plus the range and the active bin, with `pad`
 * bins either side. Falls back to the range ± pad when nothing has liquidity or volume.
 */
export function activeWindow(data: BinData, r: Range, pad = 2): { lo: number; hi: number } {
  let lo = Math.min(r.from, data.curBinIdx);
  let hi = Math.max(r.to, data.curBinIdx);
  for (const b of data.bins) {
    if (b.liquidity > 0 || b.volumeFiat > 0) {
      lo = Math.min(lo, b.idx);
      hi = Math.max(hi, b.idx);
    }
  }
  return { lo: lo - pad, hi: hi + pad };
}
