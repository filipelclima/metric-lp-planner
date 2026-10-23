/** Small, testable pieces of the ranking route's fetch policy. */

/**
 * Runs `fn` up to 1 + `retries` times until it returns a non-null value. Waits baseMs × 3^n between
 * attempts (400ms, 1.2s by default). Thrown errors count as failures. Returns null if every attempt failed.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T | null>,
  { retries = 2, baseMs = 400, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) } = {},
): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const v = await fn(attempt);
      if (v !== null) return v;
    } catch {
      // treated as a failed attempt
    }
    if (attempt < retries) await sleep(baseMs * 3 ** attempt);
  }
  return null;
}

/**
 * Offsets of the remaining pages after the first one, so they can be fetched in parallel.
 * Uses the first page's size as the page size; null when the API didn't report a usable total.
 */
export function remainingOffsets(firstCount: number, nextOffset: number | null, total: number | null | undefined, maxPages = 20): number[] | null {
  if (nextOffset === null) return [];
  if (typeof total !== "number" || !Number.isFinite(total) || firstCount <= 0) return null;
  const out: number[] = [];
  for (let o = nextOffset; o < total && out.length < maxPages - 1; o += firstCount) out.push(o);
  return out;
}
