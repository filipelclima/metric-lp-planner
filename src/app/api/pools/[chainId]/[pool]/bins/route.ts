import { NextResponse } from "next/server";
import { errorResponse, isAddress, json, metricFetch } from "@/lib/metric";

const PERIODS = new Set(["1h", "4h", "24h", "7d", "30d", "all"]);

/** Proxies the (undocumented) per-bin analytics used by app.metric.xyz. Returns the raw shape. */
export async function GET(req: Request, ctx: { params: Promise<{ chainId: string; pool: string }> }) {
  const { chainId, pool } = await ctx.params;
  const period = new URL(req.url).searchParams.get("period") ?? "7d";
  if (!/^\d+$/.test(chainId) || !isAddress(pool) || !PERIODS.has(period))
    return NextResponse.json({ error: "Invalid chain, pool or period." }, { status: 400 });
  const r = await metricFetch(`/evm/${chainId}/${pool}/analytics/bins?contract_version=v1&period=${period}`, 60);
  if (!r.ok) return errorResponse(r);
  const b = r.body as { bins?: unknown; window?: unknown };
  if (!b || !Array.isArray(b.bins) || !b.window)
    return NextResponse.json({ error: "Unexpected bins format from Metric." }, { status: 502 });
  return json(r.body, 60);
}
