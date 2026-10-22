import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";
import Planner from "@/components/Planner";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const KEYS = ["chain", "pool", "amount", "days", "from", "to", "preset", "strategy", "period"];

/** Shared links preview the result: OG/Twitter image is /api/og with the same params. */
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const k of KEYS) {
    const v = sp[k];
    if (typeof v === "string") q.set(k, v);
  }
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const qs = q.toString();
  const image = `${proto}://${host}/api/og${qs ? `?${qs}` : ""}`;
  const title = "Binwise — LP planner for Metric pools";
  const description = "Estimated fees, net APR and an exact bin plan for a Metric LP position.";
  return {
    title,
    description,
    openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Planner />
    </Suspense>
  );
}
