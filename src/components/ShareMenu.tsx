"use client";
import { useState } from "react";
import { fmtApr } from "@/lib/calc";
import type { PlannerModel } from "@/lib/usePlanner";
import { Popover } from "./ui";

/** "Share result": copy link, download the 1200×630 card from /api/og, or post on X. */
export default function ShareMenu({ m }: { m: PlannerModel }) {
  const [status, setStatus] = useState<string | null>(null);
  const flash = (msg: string) => {
    setStatus(msg);
    setTimeout(() => setStatus(null), 1600);
  };
  const pageUrl = () => `${window.location.origin}/?${m.qs}`;
  const imageUrl = `/api/og?${m.qs}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(pageUrl());
      flash("Link copied ✓");
    } catch {
      flash("Couldn't copy");
    }
  };

  const download = async () => {
    setStatus("Rendering…");
    try {
      const res = await fetch(imageUrl);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `binwise-${(m.pool?.pair ?? "plan").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
      flash("Downloaded ✓");
    } catch {
      flash("Image failed");
    }
  };

  const postOnX = () => {
    const e = m.estimate;
    const parts = [`My LP plan for ${m.pool?.pair ?? "a Metric pool"} on Binwise`];
    if (e) parts.push(`est. fee APR ${fmtApr(e.apr)}${e.netApr !== null ? ` · net APR ${fmtApr(e.netApr)} (historical)` : ""}`);
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(parts.join(": "))}&url=${encodeURIComponent(pageUrl())}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const item = "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-text transition hover:bg-surface-2";
  return (
    <Popover label="Share result" trigger={<span className="text-accent">Share result</span>}>
      <div className="w-64 space-y-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="Share card preview" className="mb-2 aspect-[1200/630] w-full rounded-lg bg-surface-2 object-cover" />
        <button className={item} onClick={copyLink}>
          Copy link <span className="text-faint">⌘C</span>
        </button>
        <button className={item} onClick={download}>
          Download image <span className="text-faint">PNG</span>
        </button>
        <button className={item} onClick={postOnX}>
          Post on X <span className="text-faint">↗</span>
        </button>
        <div aria-live="polite" className="h-4 px-3 text-xs text-accent">
          {status}
        </div>
      </div>
    </Popover>
  );
}
