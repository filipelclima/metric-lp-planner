import { errorResponse, json, metricFetch } from "@/lib/metric";
import { normalizePool, parsePoolPage } from "@/lib/normalize";
import { SUPPORTED_CHAINS, type Pool, type RawPoolPage } from "@/lib/types";

const PAGE = 500; // API max
const MAX_PAGES = 10;

/**
 * One chain at a time (chainIds filter) so each pool's chainId comes from the request, not the `chain` field.
 * minTvlFiat=0 so tiny pools are in the list too (the picker hides them by default; "Describe your plan"
 * falls back to them when a pair has nothing bigger).
 */
async function fetchChain(chainId: number) {
  const pools: Pool[] = [];
  let offset: number | null = 0;
  for (let page = 0; page < MAX_PAGES && offset !== null; page++) {
    const r = await metricFetch(`/evm/metadata?include24h=true&count=${PAGE}&sortBy=tvl&minTvlFiat=0&chainIds=${chainId}&offset=${offset}`, 300);
    if (!r.ok) return page === 0 ? r : { ok: true as const, pools }; // keep what we have
    const { items, nextOffset } = parsePoolPage(r.body as RawPoolPage);
    for (const it of items) pools.push(normalizePool(it, chainId));
    offset = nextOffset;
  }
  return { ok: true as const, pools };
}

export async function GET() {
  const results = await Promise.all(SUPPORTED_CHAINS.map(fetchChain));
  const failed = results.filter((r) => !r.ok);
  if (failed.length === results.length) return errorResponse(failed[0] as Extract<(typeof results)[number], { ok: false }>);
  const pools = results.flatMap((r) => ("pools" in r ? r.pools : []));
  pools.sort((a, b) => b.tvlFiat - a.tvlFiat);
  return json({ pools, partial: failed.length > 0 }, 300);
}
