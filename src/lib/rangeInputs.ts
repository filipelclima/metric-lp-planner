/**
 * Range input helpers shared by the planner and Compare: bin-number parsing and clamping, preset summaries
 * (range + real coverage, concentration note, "Wider"), bin edge labels and the "You'll need" line.
 * Pure; reuses calc.ts without changing it.
 */
import { binsInRange, fmtAmount, fmtPlanPct, fmtUsd, getBin, presetRange, type BinData } from "./calc";

// ---------- bin number input ----------

export type BinParse = { ok: true; value: number } | { ok: false; error: "empty" | "invalid" };

/** Characters allowed while typing: an optional sign (+, -, or the unicode minus "−") then digits. */
export const BIN_TYPING = /^[+\-−]?\d{0,6}$/;

/** "+1", "1", "-2" and "−2" (unicode minus) are valid; "" and anything else aren't. */
export function parseBinInput(text: string): BinParse {
  const t = text.trim();
  if (t === "" || t === "+" || t === "-" || t === "−") return { ok: false, error: "empty" };
  const m = /^([+\-−]?)(\d{1,6})$/.exec(t);
  if (!m) return { ok: false, error: "invalid" };
  const v = Number(m[2]);
  return { ok: true, value: m[1] === "-" || m[1] === "−" ? -v || 0 : v };
}

export interface BinBounds {
  min: number;
  max: number;
}

/** The bins the pool's analytics actually cover. */
export const binBounds = (data: BinData): BinBounds => ({ min: data.minIdx, max: data.maxIdx });

export function clampBin(v: number, b: BinBounds | null): { value: number; clamped: "min" | "max" | null } {
  if (!b) return { value: v, clamped: null };
  if (v < b.min) return { value: b.min, clamped: "min" };
  if (v > b.max) return { value: b.max, clamped: "max" };
  return { value: v, clamped: null };
}

/**
 * Input hint with the range's outer edge: "#-2 · from -0.08%" (lower edge of the start bin) or
 * "#1 · to +0.08%" (upper edge of the end bin). Bin labels elsewhere show midpoints, hence "from"/"to".
 */
export function edgeLabel(data: BinData, idx: number, side: "start" | "end"): string {
  const b = getBin(data, idx);
  return side === "start" ? `#${idx} · from ${fmtPlanPct(b.lowPct)}` : `#${idx} · to ${fmtPlanPct(b.highPct)}`;
}

/** Note under the Bin Plan line, reconciling its midpoint labels with the inputs' edges. */
export function rangeEdgesNote(data: BinData, from: number, to: number): string {
  return `Range covers ${fmtPlanPct(getBin(data, from).lowPct)} to ${fmtPlanPct(getBin(data, to).highPct)} around the oracle price (bin labels show each bin's midpoint, as in app.metric.xyz).`;
}

// ---------- presets ----------

export type PresetKey = 80 | 90 | 95 | "wider";
export const PRESET_KEYS: PresetKey[] = [80, 90, 95, "wider"];
/** Bins added on each side of the 95% range for "Wider". */
export const WIDER_EXTRA = 2;

const totalVolume = (d: BinData) => d.bins.reduce((a, b) => a + b.volumeFiat, 0);

/** Whether anything traded in the data window (presets, coverage and fee estimates all need volume). */
export const hasVolume = (d: BinData) => totalVolume(d) > 0;

export const NO_VOLUME_PRESETS = "Presets need trading volume";

/** Share of the window's volume inside [from, to]; null without volume. */
export function coverage(data: BinData, from: number, to: number): number | null {
  const total = totalVolume(data);
  return total > 0 ? binsInRange(data, from, to).reduce((a, b) => a + b.volumeFiat, 0) / total : null;
}

/** Same fallback as the planner: ±5 bins around the active bin when the window has no volume. */
export function sharePreset(data: BinData, share: 80 | 90 | 95): { from: number; to: number } {
  return presetRange(data, share / 100) ?? { from: data.curBinIdx - 5, to: data.curBinIdx + 5 };
}

/** The 95% range plus 2 bins on each side, kept within the pool's bins. */
export function widerRange(data: BinData): { from: number; to: number } {
  const r = sharePreset(data, 95);
  const b = binBounds(data);
  return { from: Math.max(b.min, r.from - WIDER_EXTRA), to: Math.min(b.max, r.to + WIDER_EXTRA) };
}

export interface PresetOption {
  key: PresetKey;
  from: number;
  to: number;
  coverage: number | null;
}

export function presetOptions(data: BinData): PresetOption[] {
  return PRESET_KEYS.map((key) => {
    const r = key === "wider" ? widerRange(data) : sharePreset(data, key);
    return { key, ...r, coverage: coverage(data, r.from, r.to) };
  });
}

/** Coverage as a whole percent, rounded down so "80%" never shows less than the target it met. */
export const fmtCoverage = (v: number | null) => (v === null ? "no volume" : `${v >= 1 ? 100 : Math.floor(v * 100)}%`);

/** "#-2…#0 (96%)" */
export const presetSubLabel = (o: PresetOption) => `#${o.from}…#${o.to} (${fmtCoverage(o.coverage)})`;

/**
 * "This pool is concentrated: 3 bins hold 96% of volume, so these presets match." when two or more of the
 * 80/90/95% presets give the same range; null otherwise.
 */
export function concentrationNote(options: PresetOption[]): string | null {
  if (options.some((o) => o.coverage === null)) return null; // no volume: nothing is "concentrated"
  const shares = options.filter((o) => o.key !== "wider");
  const groups = new Map<string, PresetOption[]>();
  for (const o of shares) groups.set(`${o.from}:${o.to}`, [...(groups.get(`${o.from}:${o.to}`) ?? []), o]);
  const g = [...groups.values()].sort((a, b) => b.length - a.length)[0];
  if (!g || g.length < 2) return null;
  const n = g[0].to - g[0].from + 1;
  const which = g.length === shares.length ? "these presets match" : `the ${g.map((o) => `${o.key}%`).join(" and ")} presets match`;
  return `This pool is concentrated: ${n} bin${n === 1 ? "" : "s"} hold${n === 1 ? "s" : ""} ${fmtCoverage(g[0].coverage)} of volume, so ${which}.`;
}

/** Which preset button a range corresponds to: the share preset, or "wider" when a manual range equals it. */
export function activePreset(range: { kind: "preset"; share: 80 | 90 | 95 } | { kind: "manual"; from: number; to: number }, data: BinData | null): PresetKey | "manual" {
  if (range.kind === "preset") return range.share;
  if (data) {
    const w = widerRange(data);
    if (w.from === range.from && w.to === range.to) return "wider";
  }
  return "manual";
}

// ---------- tokens needed ----------

export interface TokenNeed {
  /** 0 = token0, 1 = token1. */
  side: 0 | 1;
  symbol: string;
  /** Formatted token amount; null when the token has no fiat price. */
  amount: string | null;
  usd: string;
}

interface TokenLike {
  symbol: string;
  fiatPrice: number | null;
}

/**
 * Tokens for the deposit with their USD values and the total, e.g.
 * "166.67 USDG ≈ $166.67 + 0.22552 SPCX ≈ $33.33 · total $200.00". A token without a price shows "price n/a".
 */
export function tokenNeeds(
  e: { token0Usd: number; token1Usd: number; token0Amount: number; token1Amount: number },
  token0: TokenLike,
  token1: TokenLike,
): { parts: TokenNeed[]; total: string; text: string } {
  const priced = (t: TokenLike) => t.fiatPrice !== null && t.fiatPrice > 0;
  const part = (usd: number, amt: number, t: TokenLike, side: 0 | 1): TokenNeed => ({ side, symbol: t.symbol, amount: priced(t) ? fmtAmount(amt, t.fiatPrice) : null, usd: fmtUsd(usd) });
  const parts: TokenNeed[] = [];
  if (e.token1Usd > 0) parts.push(part(e.token1Usd, e.token1Amount, token1, 1));
  if (e.token0Usd > 0) parts.push(part(e.token0Usd, e.token0Amount, token0, 0));
  const total = fmtUsd(e.token0Usd + e.token1Usd);
  const text = parts.length
    ? `${parts.map((p) => (p.amount !== null ? `${p.amount} ${p.symbol} ≈ ${p.usd}` : `${p.usd} of ${p.symbol} (price n/a)`)).join(" + ")} · total ${total}`
    : "—";
  return { parts, total, text };
}
