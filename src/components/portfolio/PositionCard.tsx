"use client";
import { motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { fmtApr, fmtBinPct, fmtUsd, tickStep } from "@/lib/calc";
import { STATUS_LABEL, metricPoolUrl, replanUrl, type RangeStatus } from "@/lib/portfolio/model";
import type { PositionBinView, PositionView } from "@/lib/portfolio/types";
import { Card, ChainBadge, InfoTip, TierBadge, TokenLogo } from "../ui";

const STATUS_STYLE: Record<RangeStatus, string> = {
  in: "bg-good/10 text-good",
  edge: "bg-warn/10 text-warn",
  out: "bg-bad/10 text-bad",
};
const TONE: Record<string, string> = { bad: "text-bad", warn: "text-warn", info: "text-muted", good: "text-good" };
const DOT: Record<string, string> = { bad: "bg-bad", warn: "bg-warn", info: "bg-faint", good: "bg-good" };

export const signedUsd = (v: number) => `${v < 0 ? "−" : "+"}${fmtUsd(Math.abs(v))}`;

export default function PositionCard({ p }: { p: PositionView }) {
  const held = p.bins.filter((b) => b.share > 0).length;
  const glow = p.netApr === null ? "none" : p.netApr >= 0 ? "good" : "bad";
  return (
    <Card glow={glow} className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex -space-x-1.5">
              <TokenLogo src={p.token0.logoUrl} symbol={p.token0.symbol} size={22} />
              <TokenLogo src={p.token1.logoUrl} symbol={p.token1.symbol} size={22} />
            </span>
            <span className="text-lg font-semibold tracking-tight">{p.pair}</span>
            <ChainBadge chainId={p.chainId} />
            <TierBadge tier={p.tier} isPrivate={p.isPrivate} />
          </div>
          <div className="num mt-1 text-[13px] text-muted">
            {p.range ? `#${p.range.from} → #${p.range.to} (${held} bin${held === 1 ? "" : "s"})` : "no bins held"} · active #{p.curBinIdx}
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[p.status]}`}>{STATUS_LABEL[p.status]}</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Stat label="Value" value={fmtUsd(p.valueUsd)} big />
        <Stat label="Est. fees (last 7d)" value={fmtUsd(p.feesUsd)} tip="Your share of each bin's LP fees over the 7d window, prorated if the position is younger than that." />
        <Stat
          label="PnL vs HODL"
          value={p.pnlUsd === null ? "—" : signedUsd(p.pnlUsd)}
          tone={p.pnlUsd === null ? "text-faint" : p.pnlUsd < 0 ? "text-bad" : "text-good"}
          badge={p.pnlApprox ? "approx." : undefined}
          tip={scaleTip(p)}
        />
        <Stat label="Fee APR" value={fmtApr(p.feeApr)} tone="text-accent" tip="Value-weighted 7d fee APR of the bins you hold." />
        <Stat
          label="Net APR"
          value={fmtApr(p.netApr)}
          tone={p.netApr === null ? "text-faint" : p.netApr < 0 ? "text-bad" : "text-good"}
          tip="Value-weighted 7d net APR (trading PnL: fees + price moves) of the bins you hold. Historical and volatile."
        />
      </div>

      <PositionStrip p={p} />

      <ul className="mt-4 space-y-1.5">
        {p.insights.map((i) => (
          <li key={i.text} className={`flex gap-2.5 text-[13px] leading-snug ${TONE[i.tone]}`}>
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[i.tone]}`} />
            {i.text}
          </li>
        ))}
      </ul>

      <div className="mt-5 flex flex-wrap gap-2">
        <Link
          href={replanUrl(p.chainId, p.pool, p.valueUsd)}
          className="rounded-lg bg-accent/15 px-3 py-1.5 text-[13px] font-medium text-accent transition hover:bg-accent/25"
        >
          Re-plan in Binwise
        </Link>
        <a
          href={metricPoolUrl(p.chainId, p.pool)}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg bg-surface-2 px-3 py-1.5 text-[13px] text-muted transition hover:bg-surface-3 hover:text-text"
        >
          Open on Metric ↗
        </a>
      </div>
    </Card>
  );
}

function scaleTip(p: PositionView): string {
  const base = "Current value minus what your net deposited tokens would be worth today (HODL).";
  if (!p.pnlApprox) return `${base} Token amounts calibrated from onchain bin balances vs Metric's reserve values.`;
  const exp = [p.scale.impliedExp0, p.scale.impliedExp1].filter((e) => e !== null);
  return `${base} Approximate: the deposit units couldn't be fully calibrated against bin reserves${
    exp.length ? ` (implied scale 10^${exp.join(" / 10^")})` : ", so 18-decimal fixed point is assumed"
  }.`;
}

function Stat({ label, value, tone = "text-text", big, tip, badge }: { label: string; value: string; tone?: string; big?: boolean; tip?: string; badge?: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-faint">
        <span className="truncate">{label}</span>
        {tip && <InfoTip>{tip}</InfoTip>}
      </div>
      <div className={`num mt-1 truncate ${big ? "text-2xl font-semibold" : "text-lg"} ${tone}`}>
        {value}
        {badge && <span className="ml-1.5 align-middle font-sans text-[10px] text-faint">{badge}</span>}
      </div>
    </div>
  );
}

/** Net APR → color: green/red with intensity by magnitude (saturates at ±100%). */
function netColor(bps: number | null): string {
  if (bps === null) return "rgba(91,101,119,0.5)";
  const a = 0.25 + 0.75 * Math.min(1, Math.abs(bps) / 10_000);
  return bps < 0 ? `rgba(248,113,113,${a})` : `rgba(74,222,128,${a})`;
}

/** Mini bin strip: held bins lit, active bin ringed; hovering recolors by 7d net APR. */
function PositionStrip({ p }: { p: PositionView }) {
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(600);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const byIdx = new Map(p.bins.map((b) => [b.idx, b]));
  const idxs = p.bins.map((b) => b.idx);
  const lo = Math.min(...idxs, p.curBinIdx) - 2;
  const hi = Math.max(...idxs, p.curBinIdx) + 2;
  const cells: number[] = [];
  for (let i = lo; i <= hi && cells.length < 160; i++) cells.push(i);
  const step = tickStep(cells.length, width / 22);
  const netMode = hover !== null;
  const hb = hover !== null ? byIdx.get(hover) : undefined;

  return (
    <div className="mt-5">
      <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-[0.08em] text-faint">
        <span>Your bins</span>
        <span className="normal-case tracking-normal">{netMode ? "colored by 7d net APR" : "hover to color by 7d net APR"}</span>
      </div>
      <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
        <div className="flex h-6 items-end gap-[2px]">
          {cells.map((i) => {
            const b = byIdx.get(i);
            const heldBin = !!b && b.share > 0;
            const bg = netMode && b ? netColor(b.pnlAprBps) : heldBin ? "var(--accent)" : b ? "var(--surface-3)" : "rgba(30,35,44,0.5)";
            return (
              <motion.div
                key={i}
                onMouseEnter={() => setHover(i)}
                animate={{ backgroundColor: bg }}
                transition={{ duration: 0.18 }}
                className={`min-w-[3px] flex-1 rounded-[3px] ${heldBin ? "h-6" : "h-4"} ${i === p.curBinIdx ? "ring-2 ring-text ring-offset-1 ring-offset-surface" : ""} ${
                  hover === i ? "outline outline-1 outline-text/60" : ""
                }`}
              />
            );
          })}
        </div>
        <div className="num mt-1 flex h-3.5 gap-[2px] text-[9px] leading-none">
          {cells.map((i) => {
            const b = byIdx.get(i);
            const show = i === p.curBinIdx || (!!b && b.share > 0 && i % step === 0 && Math.abs(i - p.curBinIdx) >= step);
            return (
              <div key={i} className="relative min-w-[3px] flex-1">
                {show && (
                  <span className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap ${i === p.curBinIdx ? "font-semibold text-text" : "text-muted"}`}>{i}</span>
                )}
              </div>
            );
          })}
        </div>
        {hover !== null && <StripTip idx={hover} b={hb} active={hover === p.curBinIdx} />}
      </div>
    </div>
  );
}

function StripTip({ idx, b, active }: { idx: number; b: PositionBinView | undefined; active: boolean }) {
  return (
    <div className="num pointer-events-none absolute -top-2 right-0 z-10 -translate-y-full rounded-lg bg-surface-3 px-3 py-2 text-[11px] shadow-xl shadow-black/40">
      <div className="mb-1 flex items-center gap-2 font-sans">
        <span className="num font-medium text-text">#{idx}</span>
        {active && <span className="rounded bg-text/10 px-1 text-[10px]">active</span>}
        {b && <span className="text-faint">{fmtBinPct(b.midPct, 4)}</span>}
      </div>
      {b ? (
        <div className="grid grid-cols-[auto_auto] gap-x-3">
          <span className="font-sans text-faint">Your value</span>
          <span className="text-right">{fmtUsd(b.valueUsd)}</span>
          <span className="font-sans text-faint">Fee APR 7d</span>
          <span className="text-right text-accent">{fmtApr(b.aprBps === null ? null : b.aprBps / 1e4)}</span>
          <span className="font-sans text-faint">Net APR 7d</span>
          <span className={`text-right ${b.pnlAprBps === null ? "text-faint" : b.pnlAprBps < 0 ? "text-bad" : "text-good"}`}>
            {fmtApr(b.pnlAprBps === null ? null : b.pnlAprBps / 1e4)}
          </span>
        </div>
      ) : (
        <div className="font-sans text-faint">Not in your position</div>
      )}
    </div>
  );
}
