/** Numbers from the Metric API arrive as JSON numbers or decimal strings. */
export function toNum(v: unknown, fallback = 0): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

export function toNumOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = toNum(v, NaN);
  return Number.isNaN(n) ? null : n;
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Parses an integer that may exceed 2^53 (e.g. priceProviderCooldownSecs = 2^64-1).
 * Returns null for "effectively never" (>= 2^53) or unparseable values.
 */
export function safeInt(v: unknown): { value: number | null; never: boolean } {
  try {
    let b: bigint;
    if (typeof v === "bigint") b = v;
    else if (typeof v === "string" && /^-?\d+$/.test(v.trim())) b = BigInt(v.trim());
    else if (typeof v === "number" && Number.isFinite(v)) {
      if (Math.abs(v) >= 2 ** 53) return { value: null, never: true };
      b = BigInt(Math.trunc(v));
    } else return { value: null, never: false };
    if (b >= MAX_SAFE) return { value: null, never: true };
    return { value: Number(b), never: false };
  } catch {
    return { value: null, never: false };
  }
}
