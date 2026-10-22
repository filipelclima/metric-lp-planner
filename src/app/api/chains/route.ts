import { errorResponse, json, metricFetch } from "@/lib/metric";
import { parseChains } from "@/lib/normalize";
import type { RawChainsResponse } from "@/lib/types";

export async function GET() {
  const r = await metricFetch("/chains", 300);
  if (!r.ok) return errorResponse(r);
  const chains = [...parseChains(r.body as RawChainsResponse)].map(([chainId, name]) => ({ chainId, name }));
  return json({ chains }, 300);
}
