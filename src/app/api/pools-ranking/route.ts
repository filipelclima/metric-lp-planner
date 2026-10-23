import { NextResponse } from "next/server";
import { remainingOffsets, withRetry } from "@/lib/fetchPolicy";
import { METRIC_API } from "@/lib/metric";
import { normalizePool, parsePoolPage } from "@/lib/normalize";
import { toRow, type RankRow } from "@/lib/ranking";
import { SUPPORTED_CHAINS, type RawPoolPage } from "@/lib/types";

export const maxDuration = 60;

const PAGE = 500;
/** Generous per-request timeout: big chains (BNB) return large pages and cold starts are slow. */
const PAGE_TIMEOUT_MS = 20_000;
const CACHE_OK = "public, s-maxage=300, stale-while-revalidate=86400";

/** Last complete rows per chain on this server instance, served when a fresh fetch fails. */
const lastGood = new Map<number, { rows: RankRow[]; at: number }>();

async function fetchPage(chainId: number, offset: number): Promise<RawPoolPage | null> {
  const res = await fetch(`${METRIC_API}/evm/metadata?include24h=true&count=${PAGE}&sortBy=tvl&minTvlFiat=0&chainIds=${chainId}&offset=${offset}`, {
    headers: { accept: "application/json" },
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as RawPoolPage;
  return Array.isArray(body?.data) ? body : null;
}

const page = (chainId: number, offset: number) => withRetry(() => fetchPage(chainId, offset), { retries: 2 });

/** All pools on a chain: first page, then the remaining pages in parallel. Null if any page fails. */
async function chainRows(chainId: number): Promise<RankRow[] | null> {
  const first = await page(chainId, 0);
  if (!first) return null;
  const pages: RawPoolPage[] = [first];
  const offsets = remainingOffsets(first.data.length, first.nextOffset, first.total);
  if (offsets) {
    const rest = await Promise.all(offsets.map((o) => page(chainId, o)));
    if (rest.some((p) => p === null)) return null;
    pages.push(...(rest as RawPoolPage[]));
  } else {
    // No usable total: follow nextOffset sequentially.
    let next = first.nextOffset;
    for (let i = 0; i < 20 && next !== null; i++) {
      const p = await page(chainId, next);
      if (!p) return null;
      pages.push(p);
      next = p.nextOffset;
    }
  }
  return pages.flatMap((p) => parsePoolPage(p).items.map((it) => toRow(normalizePool(it, chainId))));
}

/**
 * GET /api/pools-ranking — all pools with ranking fields.
 * A chain that fails after retries falls back to its last good rows (reported in `staleChains`); only a
 * chain with no fallback is reported in `failedChains`. Incomplete responses are never cached at the edge.
 */
export async function GET() {
  const results = await Promise.all(SUPPORTED_CHAINS.map((id) => chainRows(id).catch(() => null)));
  const rows: RankRow[] = [];
  const failedChains: number[] = [];
  const staleChains: number[] = [];
  results.forEach((r, i) => {
    const id = SUPPORTED_CHAINS[i];
    if (r) {
      lastGood.set(id, { rows: r, at: Date.now() });
      rows.push(...r);
    } else if (lastGood.has(id)) {
      rows.push(...lastGood.get(id)!.rows);
      staleChains.push(id);
    } else failedChains.push(id);
  });
  if (failedChains.length === SUPPORTED_CHAINS.length)
    return NextResponse.json(
      { error: "Couldn't reach Metric's API. Please retry in a moment." },
      { status: 502, headers: { "cache-control": "no-store", "retry-after": "5" } },
    );
  return NextResponse.json(
    { rows, failedChains, staleChains, generatedAt: Date.now() },
    { headers: { "cache-control": failedChains.length ? "no-store" : CACHE_OK } },
  );
}
