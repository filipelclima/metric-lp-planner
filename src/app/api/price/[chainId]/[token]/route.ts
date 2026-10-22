import { NextResponse } from "next/server";
import { errorResponse, isAddress, json, metricFetch } from "@/lib/metric";
import { toNumOrNull } from "@/lib/num";

export async function GET(_req: Request, ctx: { params: Promise<{ chainId: string; token: string }> }) {
  const { chainId, token } = await ctx.params;
  if (!/^\d+$/.test(chainId) || !isAddress(token)) return NextResponse.json({ error: "Invalid chain or token." }, { status: 400 });
  const r = await metricFetch(`/evm/${chainId}/tokens/${token}/fiat-price`, 60);
  if (!r.ok) return errorResponse(r);
  const b = r.body as Record<string, unknown> | number | string;
  const price =
    typeof b === "object" && b !== null
      ? toNumOrNull(b.fiatPrice ?? b.price ?? b.priceFiat ?? b.usd ?? (b.data as Record<string, unknown> | undefined)?.fiatPrice)
      : toNumOrNull(b);
  return json({ price }, 60);
}
