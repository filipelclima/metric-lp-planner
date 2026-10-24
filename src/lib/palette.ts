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

/** Score a pool for a query; higher is better, null = no match. Every query word must match something. */
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
    if (pair === q) score += 100;
    else if (syms.includes(q)) score += 60;
    else if (pair.includes(q)) score += 40;
    else if (syms.some((s) => s.startsWith(q))) score += 30;
    else if (chainWords.some((c) => c === q || c.startsWith(q))) score += 10;
    else if (q.startsWith("0x") && q.length >= 4 && addr.startsWith(q)) score += 80;
    else return null;
  }
  return score;
}

/** Top pools for a query: open pools first, then best score, then TVL. Empty query → largest pools. */
export function searchPools(pools: Pool[], query: string, limit = 8): Pool[] {
  return pools
    .map((p) => ({ p, s: poolScore(p, query) }))
    .filter((x): x is { p: Pool; s: number } => x.s !== null)
    // Private (deposit-allowlisted) pools after open ones, as in the pool picker.
    .sort((a, b) => Number(!!a.p.isPrivate) - Number(!!b.p.isPrivate) || b.s - a.s || b.p.tvlFiat - a.p.tvlFiat)
    .slice(0, limit)
    .map((x) => x.p);
}

/** Actions whose label or keywords contain every query word (all of them for an empty query). */
export function searchActions(query: string): PaletteAction[] {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return PALETTE_ACTIONS.filter((a) => words.every((w) => `${a.label} ${a.keywords}`.toLowerCase().includes(w)));
}

export const plannerHref = (p: Pick<Pool, "chainId" | "poolAddress">) => `/?chain=${p.chainId}&pool=${p.poolAddress}`;
