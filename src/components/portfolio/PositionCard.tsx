"use client";
import { motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { fmtApr, fmtBinPct, fmtUsd, tickStep } from "@/lib/calc";
import { NO_TRADES_LABEL, STATUS_LABEL, depositAgeText, metricPoolUrl, replanUrl, type RangeStatus } from "@/lib/portfolio/model";
import type { PositionBinView, PositionView } from "@/lib/portfolio/types";
import { Callout, Card, ChainBadge, InfoTip, TierBadge, TokenLogo } from "../ui";

const STATUS_STYLE: Record<RangeStatus, string> = {
  in: "bg-good/10 text-good",
  edge: "bg-warn/10 text-warn",
  out: "bg-bad/10 text-bad",
};

export const signedUsd = (v: number) => `${v < 0 ? "−" : "+"}${fmtUsd(Math.abs(v))}`;

export default function PositionCard({ p }: { p: PositionView }) {
  const held = p.bins.filter((b) => b.share > 0).length;
  // Glow follows the user's own result, not the pool's history.
  const glow = p.pnlUsd === null ? "none" : p.pnlUsd >= 0 ? "good" : "bad";
  const age = depositAgeText(p.heldDays);
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
            {age && <span className="font-sans">{` · ${age}`}</span>}
          </div>
        </div>
        {p.noTrades ? (
          <span className="rounded-full bg-warn/10 px-2.5 py-1 text-xs font-medium text-warn" title="No swaps in this pool during the analytics window.">
            {NO_TRADES_LABEL}
          </span>
        ) : (
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[p.status]}`}>{STATUS_LABEL[p.status]}</span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Value" value={fmtUsd(p.valueUsd)} big />
        <Stat
          label={p.heldDays !== null && p.heldDays > p.windowDays ? "Est. fees (last 7d)" : "Est. fees since deposit"}
          sub="from 7d rates"
          value={fmtUsd(p.feesUsd)}
          tip={FEES_TIP}
        />
        <Stat
          label="Your fee APR"
          sub="7d"
          value={fmtApr(p.yourFeeApr)}
          tone="text-accent"
          tip={APR_TIP}
        />
      </div>

      <ResultRow pnlUsd={p.pnlUsd} pnlApprox={p.pnlApprox} annualized={p.pnlAnnualized} tip={scaleTip(p)} />

      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-faint">
        <PoolStat label="Bins' 7d net APR (pool)" value={p.binsNetApr} estUsd={p.estNetUsd} signed tip={NET_TIP} />
      </div>

      <PositionStrip p={p} />

      <ul className="mt-4 space-y-2">
        {p.insights.map((i) => (
          <li key={i.text}>
            <Callout tone={i.tone}>{i.text}</Callout>
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

function Stat({
  label,
  sub,
  value,
  tone = "text-text",
  big,
  tip,
  badge,
}: {
  label: string;
  sub?: string;
  value: string;
  tone?: string;
  big?: boolean;
  tip?: string;
  badge?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-start gap-1.5 text-xs font-medium uppercase leading-snug tracking-[0.08em] text-faint">
        <span>
          {label}
          {sub && <span className="ml-1 normal-case tracking-normal">({sub})</span>}
        </span>
        {tip && <InfoTip>{tip}</InfoTip>}
      </div>
      <div className={`num mt-1 truncate ${big ? "text-2xl font-semibold" : "text-lg"} ${tone}`}>
        {value}
        {badge && <span className="ml-1.5 align-middle font-sans text-xs text-faint">{badge}</span>}
      </div>
    </div>
  );
}

/** "Your result": PnL vs HODL in $ and annualized — the user's outcome, as opposed to the pool's history. */
export function ResultRow({ pnlUsd, pnlApprox, annualized, tip }: { pnlUsd: number | null; pnlApprox: boolean; annualized: number | null; tip: string }) {
  const tone = pnlUsd === null ? "text-faint" : pnlUsd < 0 ? "text-bad" : "text-good";
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl bg-surface-2/70 px-4 py-3">
      <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.08em] text-faint">
        Your result
        <InfoTip>{tip}</InfoTip>
      </span>
      <span className="flex items-baseline gap-2">
        <span className="text-[12px] text-muted">PnL vs HODL</span>
        <span className={`num text-lg ${tone}`}>{pnlUsd === null ? "—" : signedUsd(pnlUsd)}</span>
        {pnlApprox && pnlUsd !== null && <span className="text-xs text-faint">approx.</span>}
      </span>
      <span className="flex items-baseline gap-2" title={annualized === null ? "Shown after 1 day held" : undefined}>
        <span className="text-[12px] text-muted">annualized</span>
        <span className={`num text-lg ${annualized === null ? "text-faint" : annualized < 0 ? "text-bad" : "text-good"}`}>{fmtApr(annualized)}</span>
      </span>
    </div>
  );
}

export const FEES_TIP =
  "Based on each bin's 7d APR: Σ your value in the bin × its 7d fee APR × days held (capped at 7d) / 365. Uses Metric's own rate (fees ÷ the bin's 7d average liquidity), so it doesn't undercount when bin liquidity grew during the window. If the growth was mostly your own fresh deposit, it can overstate.";
export const APR_TIP = "Each bin's 7d fee APR, weighted by your value in it. Consistent with the fee estimate: fees = APR × value × days held / 365.";
export const NET_TIP =
  "Metric's 7d trading-PnL APR (fees + price moves) of the bins you hold, weighted by your value; the $ figure applies it to your value over the time held (capped at 7d). Pool history, not your result: see “Your result” for your PnL vs HODL.";

export function PoolStat({ label, value, tip, signed, estUsd }: { label: string; value: number | null; tip: string; signed?: boolean; estUsd?: number | null }) {
  const tone = value === null ? "" : signed ? (value < 0 ? "text-bad/80" : "text-good/80") : "text-muted";
  return (
    <span className="flex items-center gap-1.5">
      {label}
      <span className={`num ${tone}`}>{fmtApr(value)}</span>
      {estUsd !== undefined && estUsd !== null && (
        <span className="text-faint">
          (≈ <span className="num">{signedUsd(estUsd)}</span> over your time held)
        </span>
      )}
      <InfoTip>{tip}</InfoTip>
    </span>
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
      <div className="mb-1.5 flex items-center justify-between text-xs uppercase tracking-[0.08em] text-faint">
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
        <div className="num mt-1 flex h-3.5 gap-[2px] text-xs leading-none">
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
    <div className="num pointer-events-none absolute -top-2 right-0 z-10 -translate-y-full rounded-lg bg-surface-3 px-3 py-2 text-xs shadow-xl shadow-black/40">
      <div className="mb-1 flex items-center gap-2 font-sans">
        <span className="num font-medium text-text">#{idx}</span>
        {active && <span className="rounded bg-text/10 px-1 text-xs">active</span>}
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
