"use client";
import { useState } from "react";
import { projectFees } from "@/lib/calc";
import { formatSnapshot, freezeSnapshot, makeShareId, ogImageQuery, shareText, snapshotParams, today, type Snapshot } from "@/lib/share";
import type { PlannerModel } from "@/lib/usePlanner";
import { Popover } from "./ui";

interface ShareLinks {
  /** Page link with the frozen numbers and a unique share id. */
  link: string;
  /** Canonical og:image URL — the same one the shared page's metadata points to. */
  image: string;
  text: string;
  snap: Snapshot | null;
}

/** Freezes what the user sees right now into a unique, self-describing share link. */
function buildShare(m: PlannerModel): ShareLinks {
  const origin = window.location.origin;
  const e = m.estimate;
  let snap: Snapshot | null = null;
  if (e && m.pool) {
    const widths = new Set(e.positions.map((p) => p.bin.lengthE6));
    snap = freezeSnapshot({
      fees: projectFees(e.dailyFees, e.deposit, m.s.days).simple,
      feeApr: e.apr * 100,
      netApr: e.netApr === null ? null : e.netApr * 100,
      date: today(),
      pair: m.pool.pair,
      binWidthE6: widths.size === 1 ? [...widths][0] : null,
    });
  }
  const link = `${origin}/?${m.qs}${snap ? `&${snapshotParams(snap)}` : ""}&s=${makeShareId()}`;
  const image = `${origin}/api/og?${ogImageQuery(m.s, m.range, snap)}`;
  const text = snap ? shareText(snap, m.s.days) : `My LP plan for ${m.pool?.pair ?? "a Metric pool"} on Binwise`;
  return { link, image, text, snap };
}

/**
 * "Share result": each open freezes the current numbers into a new link (unique `s` id so X never
 * reuses an old card), pre-warms the og image at the edge, and offers copy / download / post on X.
 * The card, preview and tweet text all come from the same snapshot, so they always match.
 */
export default function ShareMenu({ m }: { m: PlannerModel }) {
  const [share, setShare] = useState<ShareLinks | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const flash = (msg: string) => {
    setStatus(msg);
    setTimeout(() => setStatus(null), 1600);
  };

  const open = () => {
    const s = buildShare(m);
    setShare(s);
    setStatus(null);
    // Pre-warm: render + cache the card at Vercel's edge before X asks for it.
    fetch(s.image, { priority: "low" } as RequestInit).catch(() => {});
  };

  const copyLink = async () => {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(share.link);
      flash("Link copied ✓");
    } catch {
      flash("Couldn't copy");
    }
  };

  const download = async () => {
    if (!share) return;
    setStatus("Rendering…");
    try {
      const res = await fetch(share.image);
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
    if (!share) return;
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(share.text)}&url=${encodeURIComponent(share.link)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const item = "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-text transition hover:bg-surface-2";
  return (
    <Popover label="Share result" trigger={<span className="text-accent">Share result</span>} onOpen={open}>
      <div className="w-64 space-y-1">
        {share && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={share.image} alt="Share card preview" className="mb-1 aspect-[1200/630] w-full rounded-lg bg-surface-2 object-cover" />
        )}
        {share?.snap && <p className="px-3 pb-1 text-[11px] text-faint">Snapshot of these numbers as of {formatSnapshot(share.snap).asOf}</p>}
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
