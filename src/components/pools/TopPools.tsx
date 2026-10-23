"use client";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "framer-motion";
import Link from "next/link";
import { tradeBadge } from "@/lib/activity";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { fmtApr, fmtUsd } from "@/lib/calc";
import { chainName } from "@/lib/normalize";
import {
  MIN_TVL_OPTIONS,
  filterRows,
  highlights,
  isActive,
  isPriceDriven,
  metricPoolUrl,
  planUrl,
  readRankingState,
  sortRows,
  topByNet,
  weeklyPost,
  writeRankingState,
  type Filters,
  type RankRow,
  type SortDir,
  type SortKey,
  type TierFilter,
} from "@/lib/ranking";
import { freezeTopSnapshot, makeShareId, today, topOgQuery, topSnapshotParams } from "@/lib/share";
import { CHAINS } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { ShareMenu, type ShareLinks } from "../ShareMenu";
import { Card, ChainBadge, ErrorNote, InfoTip, NoTradesBadge, Segmented, Skeleton, TierBadge, TokenLogo } from "../ui";

interface RankingResponse {
  rows: RankRow[];
  failedChains: number[];
  /** Chains served from the last good result because a fresh fetch failed. */
  staleChains?: number[];
  generatedAt: number;
}

const PRICE_DRIVEN_TIP = "Most of this return came from price moves in the last 7 days, not fees, and may not repeat.";

const PAGE = 100;
const NET_TIP = "Net APR = what LPs made over the last 7 days after price moves. It already includes fees (fees + price moves). Historical, not a forecast.";
const DRAG_TIP = "Fee APR − net APR: how much price moves ate from the fees over the last 7 days.";
const EFF_TIP = "24h volume ÷ TVL: how hard the liquidity worked in the last day.";

const stagger: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const rise: Variants = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" } } };

const pct = (v: number | null) => fmtApr(v);
const ratio = (v: number | null) => (v === null ? "—" : `${v >= 10 ? v.toFixed(0) : v.toFixed(2)}×`);

export default function TopPools() {
  const router = useRouter();
  const params = useSearchParams();
  const init = useMemo(() => readRankingState(new URLSearchParams(params.toString())), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [filters, setFilters] = useState<Filters>(init.filters);
  const [sort, setSort] = useState(init.sort);
  const [limit, setLimit] = useState(PAGE);
  const res = useApi<RankingResponse>("/api/pools-ranking");
  const reduced = useReducedMotion();

  // Cold starts can drop a big chain: retry once silently before showing any error banner.
  const [silentRetry, setSilentRetry] = useState<"idle" | "done">("idle");
  const incomplete = !!res.error || (res.data?.failedChains.length ?? 0) > 0;
  const { retry } = res;
  useEffect(() => {
    if (silentRetry !== "idle" || !incomplete || res.loading) return;
    const t = setTimeout(() => {
      setSilentRetry("done");
      retry();
    }, 1500);
    return () => clearTimeout(t);
  }, [incomplete, res.loading, silentRetry, retry]);
  const showErrors = silentRetry === "done" && !res.loading;

  // URL keeps the filters/sort shareable; snapshot params from a shared link are dropped once open.
  const qs = writeRankingState(filters, sort);
  useEffect(() => {
    if (qs !== params.toString()) router.replace(`/pools${qs ? `?${qs}` : ""}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);

  const all = useMemo(() => res.data?.rows ?? [], [res.data]);
  const filtered = useMemo(() => filterRows(all, filters), [all, filters]);
  const sorted = useMemo(() => sortRows(filtered, sort.key, sort.dir), [filtered, sort]);
  const hl = useMemo(() => highlights(filtered), [filtered]);
  const hidden = useMemo(() => (filters.showAll ? 0 : filterRows(all, { ...filters, showAll: true }).filter((r) => !isActive(r)).length), [all, filters]);
  const set = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setLimit(PAGE);
  };
  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: key === "pair" ? "asc" : "desc" }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Top pools</h1>
          <p className="mt-1 text-sm text-muted">
            Ranked by net APR over 7 days: fees minus what price moves took.{" "}
            <InfoTip side="bottom">{NET_TIP}</InfoTip>
          </p>
        </div>
        {res.data && <WeeklyActions rows={filtered} filters={filters} qs={qs} />}
      </div>

      <FilterBar filters={filters} set={set} />

      {showErrors && res.error && !res.data && <ErrorNote message={res.error} retryAfter={res.retryAfter} onRetry={res.retry} />}
      {showErrors && res.data && res.data.failedChains.length > 0 && (
        <ErrorNote message={`Couldn't load ${res.data.failedChains.map(chainName).join(", ")} — the ranking may be incomplete.`} onRetry={res.retry} />
      )}
      {res.data && (res.data.staleChains?.length ?? 0) > 0 && (
        <p className="text-xs text-faint">Showing the last cached data for {res.data.staleChains!.map(chainName).join(", ")} (a fresh fetch failed).</p>
      )}
      {((res.loading && !res.data) || (!res.data && res.error && !showErrors)) && <RankingSkeleton />}

      {res.data && (
        <motion.div className="space-y-5" variants={stagger} initial={reduced ? false : "hidden"} animate="show">
          <div className="grid gap-3 md:grid-cols-3">
            <motion.div variants={rise}>
              <HighlightCard
                title="Best net APR (fee-driven)"
                row={hl.bestNet}
                primary="net"
                tone="good"
                tip="Highest net APR among pools whose net APR is at most their fee APR, so the return came from fees rather than price luck."
              />
            </motion.div>
            <motion.div variants={rise}>
              <HighlightCard
                title="Highest fees but negative net"
                subtitle="The trap"
                row={hl.trap}
                primary="fee"
                tone="bad"
                tip="The highest fee APR among pools whose net APR is negative: fees look great, but price moves took more."
              />
            </motion.div>
            <motion.div variants={rise}>
              <HighlightCard title="Most efficient" subtitle="24h volume / TVL" row={hl.mostEfficient} primary="eff" tone="accent" />
            </motion.div>
          </div>

          <motion.div variants={rise}>
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-xs text-faint">
                <span>
                  Showing {Math.min(limit, sorted.length)} of {sorted.length} pools
                  {hidden > 0 && ` · ${hidden} paused, private or with an unhealthy price feed hidden`}
                </span>
                <span>Updated {new Date(res.data.generatedAt).toLocaleTimeString()}</span>
              </div>
              {sorted.length === 0 ? (
                <p className="px-5 pb-10 pt-6 text-center text-sm text-muted">No pools match these filters. Try a lower minimum TVL or all tiers.</p>
              ) : (
                <>
                  <RankTable rows={sorted.slice(0, limit)} sort={sort} onSort={onSort} />
                  <RankCards rows={sorted.slice(0, limit)} />
                  {sorted.length > limit && (
                    <div className="p-4 text-center">
                      <button onClick={() => setLimit((l) => l + PAGE)} className="rounded-lg bg-surface-2 px-4 py-2 text-sm text-muted hover:bg-surface-3 hover:text-text">
                        Show {Math.min(PAGE, sorted.length - limit)} more
                      </button>
                    </div>
                  )}
                </>
              )}
            </Card>
          </motion.div>
          <p className="text-center text-[11px] text-faint">Historical data from Metric&apos;s public API, not financial advice. Fees ≠ profit.</p>
        </motion.div>
      )}
    </div>
  );
}

function FilterBar({ filters, set }: { filters: Filters; set: (p: Partial<Filters>) => void }) {
  return (
    <Card className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
      <Segmented<number | "all">
        size="sm"
        value={filters.chain ?? "all"}
        onChange={(v) => set({ chain: v === "all" ? null : v })}
        options={[{ value: "all" as const, label: "All chains" }, ...Object.entries(CHAINS).map(([id, c]) => ({ value: Number(id), label: c.short, title: c.name }))]}
      />
      <Segmented<TierFilter>
        size="sm"
        value={filters.tier}
        onChange={(tier) => set({ tier })}
        options={[
          { value: "no-high-risk", label: "Hide High Risk" },
          { value: "best-practices", label: "Best Practices" },
          { value: "all", label: "All tiers" },
        ]}
      />
      <label className="flex items-center gap-2 text-xs text-muted">
        Min TVL
        <select
          value={filters.minTvl}
          onChange={(e) => set({ minTvl: Number(e.target.value) })}
          className="num rounded-md bg-surface-2 px-2 py-1 text-xs text-text outline-none focus:ring-1 focus:ring-accent/50"
        >
          {MIN_TVL_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v === 0 ? "Any" : fmtUsd(v, { compact: true }).replace(".00", "")}
            </option>
          ))}
        </select>
        <InfoTip side="bottom">Tiny pools can show absurd APRs on a few dollars of liquidity, so pools under $25k are hidden by default.</InfoTip>
      </label>
      <Toggle checked={filters.verifiedOnly} onChange={(verifiedOnly) => set({ verifiedOnly })} label="Only verified curators" />
      <Toggle
        checked={filters.showAll}
        onChange={(showAll) => set({ showAll })}
        label="Show all"
        tip="Also show paused pools, private (deposit-whitelisted) pools and pools whose price feed isn't healthy."
      />
    </Card>
  );
}

function Toggle({ checked, onChange, label, tip }: { checked: boolean; onChange: (v: boolean) => void; label: string; tip?: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="flex items-center gap-2 text-xs text-muted transition hover:text-text"
      >
        <span className={`relative h-4 w-7 rounded-full transition ${checked ? "bg-accent/70" : "bg-surface-3"}`}>
          <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-text transition-all ${checked ? "left-3.5" : "left-0.5"}`} />
        </span>
        {label}
      </button>
      {tip && <InfoTip side="bottom">{tip}</InfoTip>}
    </span>
  );
}

/** Copy weekly top 5 + share card (top 5 frozen into the link, rendered by /api/og). */
function WeeklyActions({ rows, filters, qs }: { rows: RankRow[]; filters: Filters; qs: string }) {
  const [copied, setCopied] = useState(false);
  const post = () => weeklyPost(rows, { url: `${window.location.host}/pools`, chainName: filters.chain !== null ? chainName(filters.chain) : null });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(post());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };
  const build = (): ShareLinks => {
    const top = topByNet(rows, 5);
    const snap = freezeTopSnapshot({
      rows: top.map((r) => ({ pair: r.pair, netApr: r.netApr! * 100, feeApr: r.feeApr === null ? null : r.feeApr * 100 })),
      chainId: filters.chain,
      date: today(),
    });
    const origin = window.location.origin;
    const base = qs ? `${qs}&` : "";
    return {
      link: `${origin}/pools?${base}${snap ? `${topSnapshotParams(snap)}&` : ""}s=${makeShareId()}`,
      image: `${origin}/api/og?${topOgQuery(snap)}`,
      text: post(),
      asOf: snap ? new Date(`${snap.date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null,
      fileName: "binwise-top-pools.png",
    };
  };
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={copy}
        className="relative h-8 w-44 overflow-hidden rounded-lg bg-accent/15 text-xs font-medium text-accent transition hover:bg-accent/25"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={copied ? "c" : "n"}
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -12, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 flex items-center justify-center"
          >
            {copied ? "Copied ✓" : "Copy weekly top 5"}
          </motion.span>
        </AnimatePresence>
      </button>
      <ShareMenu build={build} />
    </div>
  );
}

function HighlightCard({
  title,
  subtitle,
  row,
  primary,
  tone,
  tip,
}: {
  title: string;
  subtitle?: string;
  row: RankRow | null;
  primary: "net" | "fee" | "eff";
  tone: "good" | "bad" | "accent";
  tip?: string;
}) {
  const color = { good: "text-good", bad: "text-bad", accent: "text-accent" }[tone];
  return (
    <Card glow={tone === "bad" ? "bad" : tone === "good" ? "good" : "none"} className="flex h-full flex-col p-5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">
        {title}
        {subtitle && <span className="normal-case tracking-normal">· {subtitle}</span>}
        {tip && <InfoTip>{tip}</InfoTip>}
      </div>
      {row ? (
        <>
          <PairCell r={row} className="mt-3" />
          <div className={`num mt-3 text-3xl font-semibold ${color}`}>
            {primary === "net" ? pct(row.netApr) : primary === "fee" ? pct(row.feeApr) : ratio(row.efficiency)}
            <span className="ml-1.5 font-sans text-xs font-normal text-faint">{primary === "net" ? "net" : primary === "fee" ? "fee APR" : "vol / TVL"}</span>
          </div>
          <div className="num mt-1 text-xs text-muted">
            {primary === "fee" ? (
              <>
                net <span className="text-bad">{pct(row.netApr)}</span> · price drag {pct(row.priceDrag)}
              </>
            ) : primary === "net" ? (
              <>
                fee {pct(row.feeApr)} · TVL {fmtUsd(row.tvl, { compact: true })}
              </>
            ) : (
              <>
                24h vol {row.vol24h === null ? "—" : fmtUsd(row.vol24h, { compact: true })} · TVL {fmtUsd(row.tvl, { compact: true })}
              </>
            )}
          </div>
          <div className="mt-auto flex gap-2 pt-4">
            <PlanButton r={row} />
            <MetricLink r={row} />
          </div>
        </>
      ) : (
        <p className="mt-3 text-sm text-faint">{primary === "fee" ? "No pool with high fees and negative net right now." : "No pool matches."}</p>
      )}
    </Card>
  );
}

function PriceDrivenChip() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warn/10 px-1.5 py-0.5 text-[10px] font-medium text-warn">
      price-driven
      <InfoTip>{PRICE_DRIVEN_TIP}</InfoTip>
    </span>
  );
}

function PairCell({ r, className = "" }: { r: RankRow; className?: string }) {
  return (
    <span className={`flex min-w-0 items-center gap-2 ${className}`}>
      <span className="flex shrink-0 -space-x-1.5">
        <TokenLogo src={r.token0.logoUrl} symbol={r.token0.symbol} />
        <TokenLogo src={r.token1.logoUrl} symbol={r.token1.symbol} />
      </span>
      <span className="truncate font-medium" title={r.pair}>
        {r.pair}
      </span>
      <ChainBadge chainId={r.chainId} />
      <NoTradesBadge badge={tradeBadge(r.vol24h, r.feeApr)} />
    </span>
  );
}

const PlanButton = ({ r }: { r: RankRow }) => (
  <Link href={planUrl(r)} className="rounded-lg bg-accent/15 px-2.5 py-1 text-xs font-medium text-accent transition hover:bg-accent/25">
    Plan
  </Link>
);
const MetricLink = ({ r }: { r: RankRow }) => (
  <a
    href={metricPoolUrl(r)}
    target="_blank"
    rel="noreferrer"
    className="whitespace-nowrap rounded-lg bg-surface-2 px-2.5 py-1 text-xs text-muted transition hover:bg-surface-3 hover:text-text"
  >
    Open on Metric ↗
  </a>
);

/** Bar scale: 90th percentile of |APR| among shown rows, so one outlier doesn't flatten the rest. */
function barScale(rows: RankRow[]): number {
  const v = rows.flatMap((r) => [r.feeApr, r.netApr]).filter((x): x is number => x !== null).map(Math.abs).sort((a, b) => a - b);
  return v.length ? Math.max(v[Math.floor(0.9 * (v.length - 1))], 1e-9) : 1;
}

function AprBar({ value, scale, kind }: { value: number | null; scale: number; kind: "fee" | "net" }) {
  const w = value === null ? 0 : Math.min(100, (Math.abs(value) / scale) * 100);
  const color = kind === "fee" ? "bg-accent" : value !== null && value < 0 ? "bg-bad" : "bg-good";
  const text = kind === "fee" ? "text-text" : value === null ? "text-faint" : value < 0 ? "text-bad" : "text-good";
  return (
    <div className="min-w-[88px]">
      <div className={`num text-right text-[13px] ${text}`}>{pct(value)}</div>
      <div className="mt-1 h-1 rounded-full bg-surface-3">
        <div className={`h-full rounded-full ${color} ${kind === "net" && value !== null && value < 0 ? "ml-auto" : ""}`} style={{ width: `${w}%` }} />
      </div>
    </div>
  );
}

const COLUMNS: { key: SortKey; label: string; tip?: string; align?: "right" }[] = [
  { key: "pair", label: "Pair" },
  { key: "tier", label: "Tier" },
  { key: "tvl", label: "TVL", align: "right" },
  { key: "vol24h", label: "24h volume", align: "right" },
  { key: "feeApr", label: "Fee APR", align: "right" },
  { key: "netApr", label: "Net APR", tip: NET_TIP, align: "right" },
  { key: "priceDrag", label: "Price drag", tip: DRAG_TIP, align: "right" },
  { key: "efficiency", label: "Vol / TVL", tip: EFF_TIP, align: "right" },
];

function RankTable({ rows, sort, onSort }: { rows: RankRow[]; sort: { key: SortKey; dir: SortDir }; onSort: (k: SortKey) => void }) {
  const scale = barScale(rows);
  return (
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full min-w-[980px] text-sm">
        <thead className="text-[10px] uppercase tracking-[0.08em] text-faint">
          <tr className="border-y border-line/60">
            <th className="w-10 px-3 py-2 text-left font-medium">#</th>
            {COLUMNS.map((c) => (
              <th key={c.key} className={`px-3 py-2 font-medium ${c.align === "right" ? "text-right" : "text-left"}`} aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                <span className={`inline-flex items-center gap-1 ${c.align === "right" ? "flex-row-reverse" : ""}`}>
                  {c.tip && <InfoTip side="bottom">{c.tip}</InfoTip>}
                  <button onClick={() => onSort(c.key)} className={`uppercase tracking-[0.08em] transition hover:text-text ${sort.key === c.key ? "text-text" : ""}`}>
                    {c.label}
                    <span className="ml-1 inline-block w-2">{sort.key === c.key ? (sort.dir === "desc" ? "↓" : "↑") : ""}</span>
                  </button>
                </span>
              </th>
            ))}
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.chainId}-${r.pool}`} className="border-b border-line/40 transition-colors hover:bg-surface-2/60">
              <td className="num px-3 py-2.5 text-xs text-faint">{i + 1}</td>
              <td className="max-w-[220px] px-3 py-2.5">
                <PairCell r={r} />
              </td>
              <td className="px-3 py-2.5">
                <TierBadge tier={r.tier} isPrivate={r.isPrivate} />
              </td>
              <td className="num px-3 py-2.5 text-right">{fmtUsd(r.tvl, { compact: true })}</td>
              <td className="num px-3 py-2.5 text-right text-muted">{r.vol24h === null ? "—" : fmtUsd(r.vol24h, { compact: true })}</td>
              <td className="px-3 py-2.5">
                <AprBar value={r.feeApr} scale={scale} kind="fee" />
              </td>
              <td className="px-3 py-2.5">
                <AprBar value={r.netApr} scale={scale} kind="net" />
                {isPriceDriven(r) && (
                  <div className="mt-1 text-right">
                    <PriceDrivenChip />
                  </div>
                )}
              </td>
              <td className={`num px-3 py-2.5 text-right text-[13px] ${r.priceDrag !== null && r.priceDrag > 0 ? "text-warn" : "text-muted"}`}>{pct(r.priceDrag)}</td>
              <td className="num px-3 py-2.5 text-right text-[13px] text-muted">{ratio(r.efficiency)}</td>
              <td className="px-3 py-2.5">
                <span className="flex justify-end gap-1.5">
                  <PlanButton r={r} />
                  <MetricLink r={r} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RankCards({ rows }: { rows: RankRow[] }) {
  const scale = barScale(rows);
  return (
    <div className="space-y-2 p-3 md:hidden">
      {rows.map((r, i) => (
        <div key={`${r.chainId}-${r.pool}`} className="rounded-xl bg-surface-2/60 p-3.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="num text-xs text-faint">{i + 1}</span>
            <PairCell r={r} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.08em] text-faint">Fee APR</div>
              <AprBar value={r.feeApr} scale={scale} kind="fee" />
            </div>
            <div>
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-[0.08em] text-faint">
                Net APR <InfoTip>{NET_TIP}</InfoTip>
              </div>
              <AprBar value={r.netApr} scale={scale} kind="net" />
              {isPriceDriven(r) && (
                <div className="mt-1 text-right">
                  <PriceDrivenChip />
                </div>
              )}
            </div>
          </div>
          <div className="num mt-3 grid grid-cols-3 gap-2 text-[11px] text-muted">
            <span>
              <span className="block font-sans text-faint">TVL</span>
              {fmtUsd(r.tvl, { compact: true })}
            </span>
            <span>
              <span className="block font-sans text-faint">Price drag</span>
              {pct(r.priceDrag)}
            </span>
            <span>
              <span className="block font-sans text-faint">Vol / TVL</span>
              {ratio(r.efficiency)}
            </span>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <PlanButton r={r} />
            <MetricLink r={r} />
            <span className="ml-auto">
              <TierBadge tier={r.tier} isPrivate={r.isPrivate} />
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function RankingSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading pools">
      <div className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="space-y-3 p-5">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-8 w-24" />
          </Card>
        ))}
      </div>
      <Card className="space-y-2 p-5">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-9" />
        ))}
      </Card>
    </div>
  );
}
