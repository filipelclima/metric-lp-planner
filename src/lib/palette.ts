/**
 * ⌘K command palette search: pools by pair, token, chain or address, plus quick actions. Pure.
 */
import { CHAINS, type Pool } from "./types";

export interface PaletteAction {
  id: string;
  label: string;
  href: string;
  keywords: string;
}

export const PALETTE_ACTIONS: PaletteAction[] = [
  { id: "planner", label: "Go to Planner", href: "/", keywords: "planner plan home calculator" },
  { id: "pools", label: "Go to Top pools", href: "/pools", keywords: "top pools ranking best apr" },
  { id: "portfolio", label: "Go to Portfolio", href: "/portfolio", keywords: "portfolio wallet positions" },
  { id: "compare", label: "Compare ranges", href: "/compare", keywords: "compare ranges scenarios" },
];

/**
 * Match quality for a query (higher is better), null = no match; every query word must match something.
 * Per word: 4 = the exact pair or a pool address prefix, 3 = a token symbol starts with it (nvda → NVDA, NVDAB),
 * 2 = it appears inside a symbol or the pair, 1 = chain name. Coarse on purpose, so TVL decides within a tier.
 */
export function poolScore(p: Pool, query: string): number | null {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const chain = CHAINS[p.chainId];
  const pair = p.pair.toLowerCase();
  const syms = [p.token0.symbol.toLowerCase(), p.token1.symbol.toLowerCase()];
  const chainWords = [chain?.short.toLowerCase(), chain?.name.toLowerCase(), String(p.chainId)].filter(Boolean) as string[];
  const addr = p.poolAddress.toLowerCase();
  let score = 0;
  for (const w of words) {
    const q = w.replace(/-/g, "/");
    if (pair === q || (q.startsWith("0x") && q.length >= 4 && addr.startsWith(q))) score += 4;
    else if (syms.some((s) => s.startsWith(q))) score += 3;
    else if (pair.includes(q)) score += 2;
    else if (chainWords.some((c) => c === q || c.startsWith(q))) score += 1;
    else return null;
  }
  return score;
}

/**
 * Pools for a query, across all chains (the picker's saved filters don't apply): match quality, then TVL;
 * private pools after open ones; $0-TVL pools only when nothing with TVL matches. Empty query → largest pools.
 */
export function searchPools(pools: Pool[], query: string, limit = 10): Pool[] {
  const hits = pools.map((p) => ({ p, s: poolScore(p, query) })).filter((x): x is { p: Pool; s: number } => x.s !== null);
  const funded = hits.filter((x) => x.p.tvlFiat > 0);
  return (funded.length ? funded : hits)
    .sort((a, b) => b.s - a.s || Number(!!a.p.isPrivate) - Number(!!b.p.isPrivate) || b.p.tvlFiat - a.p.tvlFiat)
    .slice(0, limit)
    .map((x) => x.p);
}

/** Actions whose label or keywords contain every query word (all of them for an empty query). */
export function searchActions(query: string): PaletteAction[] {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return PALETTE_ACTIONS.filter((a) => words.every((w) => `${a.label} ${a.keywords}`.toLowerCase().includes(w)));
}

export const plannerHref = (p: Pick<Pool, "chainId" | "poolAddress">) => `/?chain=${p.chainId}&pool=${p.poolAddress}`;
