"use client";
import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useMemo } from "react";
import { fmtApr, fmtUsd } from "@/lib/calc";
import { landingStats, trendingPools } from "@/lib/landing";
import type { RankRow } from "@/lib/ranking";
import { CHAINS } from "@/lib/types";
import type { PlannerModel } from "@/lib/usePlanner";
import { openPalette } from "./CommandPalette";
import DescribePlan from "./DescribePlan";
import PoolPicker from "./PoolPicker";
import { CountUp, ErrorNote, Skeleton, TierBadge, TokenLogo } from "./ui";

const compact = (v: number) => fmtUsd(v, { compact: true }).replace(".00", "");
const intFmt = (v: number) => Math.round(v).toLocaleString("en-US");

/** Planner with no pool selected: "Describe your plan" as the hero, live stats, and three trending pools. */
export default function Landing({ m }: { m: PlannerModel }) {
  const pools = m.list.data?.pools ?? null;
  const stats = useMemo(() => (pools ? landingStats(pools) : null), [pools]);
  const trending = useMemo(() => (pools ? trendingPools(pools) : null), [pools]);
  const byKey = useMemo(() => new Map((pools ?? []).map((p) => [`${p.chainId}:${p.poolAddress.toLowerCase()}`, p])), [pools]);
  const plan = (r: RankRow) => {
    const p = byKey.get(`${r.chainId}:${r.pool.toLowerCase()}`);
    if (p) m.selectPool(p);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-12 py-6 sm:py-10">
      <DescribePlan m={m} variant="hero" />

      <section aria-label="Metric at a glance" className="grid grid-cols-3 gap-2 rounded-2xl bg-surface p-4 sm:gap-6 sm:p-6">
        <Stat label="Total TVL" value={stats?.tvl} format={compact} />
        <Stat label="24h volume" value={stats?.vol24h} format={compact} />
        <Stat label="Active pools" sub="traded in 24h" value={stats?.activePools} format={intFmt} />
      </section>

      {m.list.error && !pools && <ErrorNote message={m.list.error} onRetry={m.list.retry} retryAfter={m.list.retryAfter} />}

      <section aria-labelledby="trending-title" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="trending-title" className="text-lg font-semibold tracking-tight">
              Trending pools
            </h2>
            <p className="text-sm text-muted">From the Top pools ranking: open, healthy, ≥ $25k TVL, traded today.</p>
          </div>
          <Link href="/pools" className="text-sm text-accent hover:underline">
            See all top pools →
          </Link>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {trending ? (
            <>
              <TrendingCard title="Best net APR" sub="fee-driven: net ≤ fee" row={trending.bestNet} onPlan={plan} />
              <TrendingCard title="Highest 24h volume" sub="most traded today" row={trending.topVolume} onPlan={plan} />
              <TrendingCard title="Safest" sub="Best Practices, highest TVL" row={trending.safest} onPlan={plan} />
            </>
          ) : (
            [0, 1, 2].map((i) => <Skeleton key={i} className="h-[214px] rounded-2xl" />)
          )}
        </div>
      </section>

      <section aria-label="Pick a pool" className="rounded-2xl bg-surface p-4 sm:p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Or pick a pool yourself</h2>
          <button type="button" onClick={openPalette} className="rounded-lg bg-surface-2 px-2.5 py-1 text-xs text-muted transition hover:bg-surface-3 hover:text-text">
            Search everything <kbd className="num ml-1 text-faint">⌘K</kbd>
          </button>
        </div>
        <PoolPicker picker={m.picker} list={m.list} selected={null} onSelect={m.selectPool} hasSelection={false} />
      </section>
    </div>
  );
}

function Stat({ label, sub, value, format }: { label: string; sub?: string; value: number | undefined; format: (v: number) => string }) {
  return (
    <div className="min-w-0 text-center">
      <div className="text-xs font-medium uppercase tracking-[0.08em] text-faint">{label}</div>
      <div className="mt-1 h-8 text-xl font-semibold tracking-tight sm:h-10 sm:text-3xl">
        {value === undefined ? <Skeleton className="mx-auto h-7 w-20 sm:h-9 sm:w-28" /> : <CountUp value={value} from={0} format={format} />}
      </div>
      {sub && <div className="text-xs text-faint">{sub}</div>}
    </div>
  );
}

function TrendingCard({ title, sub, row, onPlan }: { title: string; sub: string; row: RankRow | null; onPlan: (r: RankRow) => void }) {
  const reduced = useReducedMotion();
  if (!row)
    return (
      <div className="flex h-[214px] flex-col justify-center rounded-2xl bg-surface p-5 text-sm text-muted">
        <div className="text-xs font-medium uppercase tracking-[0.08em] text-faint">{title}</div>
        <p className="mt-2">No pool qualifies right now.</p>
      </div>
    );
  const scale = Math.max(row.feeApr ?? 0, Math.abs(row.netApr ?? 0), 0.0001);
  return (
    <motion.article
      whileHover={reduced ? undefined : { y: -3 }}
      transition={{ duration: 0.15 }}
      className="group flex h-[214px] flex-col rounded-2xl bg-surface p-5 transition-shadow duration-200 hover:shadow-[0_0_0_1px_rgba(45,212,191,0.35),0_18px_40px_-18px_rgba(45,212,191,0.45)]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-[0.08em] text-accent">{title}</div>
          <div className="text-xs text-faint">{sub}</div>
        </div>
        <TierBadge tier={row.tier} isPrivate={row.isPrivate} />
      </div>
      <div className="mt-3 flex min-w-0 items-center gap-2">
        <span className="flex -space-x-1.5">
          <TokenLogo src={row.token0.logoUrl} symbol={row.token0.symbol} size={22} />
          <TokenLogo src={row.token1.logoUrl} symbol={row.token1.symbol} size={22} />
        </span>
        <span className="truncate text-base font-semibold">{row.pair}</span>
        <span className="text-xs text-muted">{CHAINS[row.chainId]?.short}</span>
      </div>
      <div className="mt-3 space-y-1.5">
        <MiniBar label="Fee APR" value={row.feeApr} scale={scale} className="bg-accent" />
        <MiniBar label="Net APR" value={row.netApr} scale={scale} className={row.netApr !== null && row.netApr < 0 ? "bg-bad" : "bg-good"} />
      </div>
      <div className="mt-auto flex items-center justify-between pt-3">
        <span className="num text-sm text-muted">TVL {compact(row.tvl)}</span>
        <button
          type="button"
          onClick={() => onPlan(row)}
          className="rounded-lg bg-accent/15 px-3 py-1.5 text-sm font-medium text-accent transition group-hover:bg-accent group-hover:text-bg"
        >
          Plan this pool
        </button>
      </div>
    </motion.article>
  );
}

function MiniBar({ label, value, scale, className }: { label: string; value: number | null; scale: number; className: string }) {
  const w = value === null ? 0 : Math.min(100, (Math.abs(value) / scale) * 100);
  return (
    <div className="grid grid-cols-[64px_1fr_72px] items-center gap-2 text-xs">
      <span className="text-muted">{label}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-surface-3">
        <span className={`block h-full rounded-full ${className}`} style={{ width: `${w}%` }} />
      </span>
      <span className="num text-right text-text">{fmtApr(value)}</span>
    </div>
  );
}

