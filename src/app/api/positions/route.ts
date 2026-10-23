import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { loadPortfolio } from "@/lib/portfolio/server";
import { SUPPORTED_CHAINS } from "@/lib/types";

export const maxDuration = 30;

/** GET /api/positions?wallet=0x…&chain=56 — read-only, public data only. Cached 30s at the edge. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const wallet = (q.get("wallet") ?? "").trim();
  const chainRaw = q.get("chain");
  if (!isAddress(wallet, { strict: false })) return NextResponse.json({ error: "Enter a valid 0x… wallet address." }, { status: 400 });
  const chain = chainRaw ? Number(chainRaw) : null;
  if (chain !== null && !SUPPORTED_CHAINS.includes(chain)) return NextResponse.json({ error: "Unsupported chain." }, { status: 400 });

  try {
    const body = await loadPortfolio(wallet, chain);
    const allFailed = body.errors.length > 0 && body.positions.length === 0 && body.errors.length === (chain !== null ? 1 : SUPPORTED_CHAINS.length);
    if (allFailed)
      return NextResponse.json({ error: "Couldn't reach the Metric RPC. Please retry in a moment.", errors: body.errors }, { status: 502, headers: { "retry-after": "5" } });
    return NextResponse.json(body, { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=60" } });
  } catch {
    return NextResponse.json({ error: "Couldn't load positions. Please retry." }, { status: 502 });
  }
}
