import { NextResponse } from "next/server";
import { errorResponse, metricFetch } from "@/lib/metric";
import { normalizePool, parsePoolPage } from "@/lib/normalize";
import { toRow, type RankRow } from "@/lib/ranking";
import { SUPPORTED_CHAINS, type RawPoolPage } from "@/lib/types";

const PAGE = 500;
const MAX_PAGES = 10;

/** Every pool on a chain (minTvlFiat=0, so filtering by TVL happens client-side), as ranking rows. */
async function chainRows(chainId: number) {
  const rows: RankRow[] = [];
  let offset: number | null = 0;
  for (let page = 0; page < MAX_PAGES && offset !== null; page++) {
    const r = await metricFetch(`/evm/metadata?include24h=true&count=${PAGE}&sortBy=tvl&minTvlFiat=0&chainIds=${chainId}&offset=${offset}`, 300);
    if (!r.ok) return page === 0 ? r : { ok: true as const, rows };
    const { items, nextOffset } = parsePoolPage(r.body as RawPoolPage);
    for (const it of items) rows.push(toRow(normalizePool(it, chainId)));
    offset = nextOffset;
  }
  return { ok: true as const, rows };
}

/** GET /api/pools-ranking — all pools with ranking fields; cached 300s at the edge. */
export async function GET() {
  const results = await Promise.all(SUPPORTED_CHAINS.map(chainRows));
  const failed = results.filter((r) => !r.ok);
  if (failed.length === results.length) return errorResponse(failed[0] as Extract<(typeof results)[number], { ok: false }>);
  return NextResponse.json(
    {
      rows: results.flatMap((r) => ("rows" in r ? r.rows : [])),
      failedChains: results.flatMap((r, i) => (r.ok ? [] : [SUPPORTED_CHAINS[i]])),
      generatedAt: Date.now(),
    },
    { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=900" } },
  );
}
