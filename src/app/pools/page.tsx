import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";
import TopPools from "@/components/pools/TopPools";
import { parseTopSnapshot, topOgQuery } from "@/lib/share";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const X_HANDLE = "@ManelA85";

/** Shared /pools links preview the frozen top 5 (validated snapshot params), else a generic card. */
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") q.set(k, v);
  const snap = parseTopSnapshot(q);

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto")?.split(",")[0] ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;
  const image = `${origin}/api/og?${topOgQuery(snap)}`;

  const title = "Top Metric pools by net APR · Binwise";
  const description = snap
    ? `Top ${snap.rows.length} by net APR (7d, fees + price moves): ${snap.rows.map((r, i) => `${i + 1}. ${r.pair} ${r.netApr.toFixed(1)}%`).join(" · ")}`
    : "Metric pools ranked by net APR (7d, fees + price moves), with fee APR, price drag and volume/TVL.";
  const img = { url: image, width: 1200, height: 630, type: "image/png", alt: "Top Metric pools by net APR" };
  return {
    metadataBase: new URL(origin),
    title,
    description,
    openGraph: { title, description, type: "website", siteName: "Binwise", images: [img] },
    twitter: { card: "summary_large_image", site: X_HANDLE, creator: X_HANDLE, title, description, images: [img] },
  };
}

export default function PoolsPage() {
  return (
    <Suspense fallback={null}>
      <TopPools />
    </Suspense>
  );
}
