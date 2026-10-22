import { errorResponse, json, metricFetch } from "@/lib/metric";
import { normalizePool, parsePoolPage } from "@/lib/normalize";
import { SUPPORTED_CHAINS, type Pool } from "@/lib/types";

const PAGE = 500;
const MAX_PAGES = 10;

export async function GET() {
  const pools: Pool[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await metricFetch(`/evm/metadata?include24h=true&count=${PAGE}&sortBy=tvl&offset=${offset}`, 300);
    if (!r.ok) {
      if (page === 0) return errorResponse(r);
      break; // keep what we have
    }
    const { items, nextOffset } = parsePoolPage(r.body);
    for (const it of items) {
      const p = normalizePool(it);
      if (p && SUPPORTED_CHAINS.includes(p.chainId)) pools.push(p);
    }
    if (nextOffset === null || nextOffset <= offset || items.length === 0) break;
    offset = nextOffset;
  }
  pools.sort((a, b) => b.tvlFiat - a.tvlFiat);
  return json({ pools }, 300);
}
