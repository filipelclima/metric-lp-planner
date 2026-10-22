import { errorResponse, json, metricFetch } from "@/lib/metric";

export async function GET() {
  const r = await metricFetch("/chains", 300);
  return r.ok ? json(r.body, 300) : errorResponse(r);
}
