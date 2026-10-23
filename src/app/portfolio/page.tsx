import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";
import Portfolio from "@/components/portfolio/Portfolio";
import { formatPortfolioSnapshot, parsePortfolioSnapshot, portfolioOgQuery } from "@/lib/share";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const X_HANDLE = "@ManelA85";

/** The share image shows portfolio totals only — never the wallet address. */
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") q.set(k, v);
  const snap = parsePortfolioSnapshot(q);

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto")?.split(",")[0] ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;
  const image = `${origin}/api/og?${portfolioOgQuery(snap)}`;

  const f = snap ? formatPortfolioSnapshot(snap) : null;
  const title = f ? `Metric LP portfolio: ${f.value} · Binwise` : "Portfolio · Binwise";
  const description = f
    ? `${f.value} across ${f.count}${f.pnl ? ` · PnL vs HODL ${f.pnl}` : ""}${f.feeApr ? ` · fee APR ${f.feeApr}` : ""} (as of ${f.asOf})`
    : "Paste any wallet to see its Metric LP positions: value, fees, PnL vs HODL and idle or out-of-range bins.";
  const img = { url: image, width: 1200, height: 630, type: "image/png", alt: "Binwise Metric LP portfolio summary" };
  return {
    metadataBase: new URL(origin),
    title,
    description,
    openGraph: { title, description, type: "website", siteName: "Binwise", images: [img] },
    twitter: { card: "summary_large_image", site: X_HANDLE, creator: X_HANDLE, title, description, images: [img] },
  };
}

export default function PortfolioPage() {
  return (
    <Suspense fallback={null}>
      <Portfolio />
    </Suspense>
  );
}
