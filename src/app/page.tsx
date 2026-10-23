import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";
import Planner from "@/components/Planner";
import { fetchJsonWithTimeout } from "@/lib/fetchTimeout";
import type { RawPool } from "@/lib/types";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const KEYS = ["chain", "pool", "amount", "days", "from", "to", "preset", "strategy", "period"];
/** Bump to make X / Slack refetch share images they cached (including cached failures). */
const OG_VERSION = "2";

/** Shared links preview the result: the OG/Twitter image is /api/og with the same params. */
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const k of KEYS) {
    const v = sp[k];
    if (typeof v === "string") q.set(k, v);
  }

  // Best-effort pair name (cached, short deadline) so titles and the fallback card can name the pool.
  const chain = q.get("chain");
  const pool = q.get("pool");
  let pair: string | null = null;
  if (chain && /^\d+$/.test(chain) && pool && /^0x[0-9a-fA-F]{40}$/.test(pool)) {
    const meta = await fetchJsonWithTimeout<RawPool>(
      `https://api.metric.xyz/public/v1/evm/${chain}/${pool}/metadata?contract_version=v1&include24h=true`,
      800,
      { next: { revalidate: 300 } },
    );
    pair = typeof meta?.pair === "string" ? meta.pair : null;
  }
  if (pair) q.set("pair", pair);
  q.set("v", OG_VERSION);

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto")?.split(",")[0] ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;
  const image = `${origin}/api/og?${q.toString()}`;
  const alt = pair ? `Binwise LP plan for ${pair}: estimated fees, fee APR and net APR` : "Binwise LP plan: estimated fees, fee APR and net APR";

  const title = pair ? `${pair} LP plan · Binwise` : "Binwise — LP planner for Metric pools";
  const description = "Estimated fees, net APR and an exact bin plan for a Metric LP position.";
  const img = { url: image, width: 1200, height: 630, type: "image/png", alt };
  return {
    metadataBase: new URL(origin),
    title,
    description,
    openGraph: { title, description, type: "website", siteName: "Binwise", images: [img] },
    twitter: { card: "summary_large_image", title, description, images: [img] },
  };
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Planner />
    </Suspense>
  );
}
