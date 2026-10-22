import "server-only";
import { NextResponse } from "next/server";

export const METRIC_API = "https://api.metric.xyz/public/v1";

export type UpstreamResult =
  | { ok: true; body: unknown }
  | { ok: false; status: number; error: string; retryAfter: number | null };

/** Fetches a Metric public endpoint with Next's data cache. */
export async function metricFetch(path: string, revalidate: number): Promise<UpstreamResult> {
  try {
    const res = await fetch(`${METRIC_API}${path}`, {
      headers: { accept: "application/json" },
      next: { revalidate },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const ra = Number(res.headers.get("retry-after"));
      return {
        ok: false,
        status: res.status,
        error:
          res.status === 429
            ? "Metric's API is rate limiting requests. Please retry in a moment."
            : `Metric API responded ${res.status}.`,
        retryAfter: Number.isFinite(ra) && ra > 0 ? ra : res.status === 429 ? 10 : null,
      };
    }
    return { ok: true, body: await res.json() };
  } catch (e) {
    return { ok: false, status: 502, error: `Could not reach Metric's API (${(e as Error).message}).`, retryAfter: null };
  }
}

export function errorResponse(r: Extract<UpstreamResult, { ok: false }>) {
  const status = r.status === 429 ? 429 : r.status === 404 ? 404 : 502;
  return NextResponse.json(
    { error: r.error, upstreamStatus: r.status, retryAfter: r.retryAfter },
    { status, headers: r.retryAfter ? { "retry-after": String(r.retryAfter) } : {} },
  );
}

export function json(body: unknown, sMaxAge: number) {
  return NextResponse.json(body, {
    headers: { "cache-control": `public, s-maxage=${sMaxAge}, stale-while-revalidate=${sMaxAge * 5}` },
  });
}

export const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);
