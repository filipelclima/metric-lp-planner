import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";
import Compare from "@/components/compare/Compare";
import { compareOgQuery, parseCompareSnapshot } from "@/lib/share";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const X_HANDLE = "@ManelA85";

/** Shared /compare links preview the frozen columns (validated snapshot params), else a generic card. */
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") q.set(k, v);
  const snap = parseCompareSnapshot(q);

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto")?.split(",")[0] ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;
  const image = `${origin}/api/og?${compareOgQuery(snap)}`;

  const title = snap?.pair ? `Compare LP ranges on ${snap.pair} · Binwise` : "Compare LP ranges · Binwise";
  const description = snap
    ? snap.cols.map((c, i) => `${"ABC"[i]} #${c.from}→#${c.to}: fee ${c.feeApr.toFixed(1)}%${c.netApr !== null ? `, net ${c.netApr.toFixed(1)}%` : ""}`).join(" · ")
    : "Compare up to three LP ranges side by side: volume covered, fee and net APR, price drag, tokens needed.";
  const img = { url: image, width: 1200, height: 630, type: "image/png", alt: "Binwise range comparison" };
  return {
    metadataBase: new URL(origin),
    title,
    description,
    openGraph: { title, description, type: "website", siteName: "Binwise", images: [img] },
    twitter: { card: "summary_large_image", site: X_HANDLE, creator: X_HANDLE, title, description, images: [img] },
  };
}

export default function ComparePage() {
  return (
    <Suspense fallback={null}>
      <Compare />
    </Suspense>
  );
}
