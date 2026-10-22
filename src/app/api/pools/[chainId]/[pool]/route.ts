import { NextResponse } from "next/server";
import { errorResponse, isAddress, json, metricFetch } from "@/lib/metric";
import { normalizePool } from "@/lib/normalize";
import type { RawPool } from "@/lib/types";

export async function GET(_req: Request, ctx: { params: Promise<{ chainId: string; pool: string }> }) {
  const { chainId, pool } = await ctx.params;
  if (!/^\d+$/.test(chainId) || !isAddress(pool)) return NextResponse.json({ error: "Invalid chain or pool." }, { status: 400 });
  const r = await metricFetch(`/evm/${chainId}/${pool}/metadata?contract_version=v1&include24h=true`, 300);
  if (!r.ok) return errorResponse(r);
  return json({ pool: normalizePool(r.body as RawPool, Number(chainId)) }, 300);
}
