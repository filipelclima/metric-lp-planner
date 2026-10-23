"use client";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "framer-motion";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Customized, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  bpsToFraction,
  fmtApr,
  fmtPlanPct,
  fmtUsd,
  getBin,
  planText,
  poolDailyFees,
  poolWindowDailyFees,
  projectFees,
  tickStep,
  type BinData,
  type Estimate,
} from "@/lib/calc";
import { NET_NOTE } from "@/lib/plan";
import { tokenNeeds } from "@/lib/rangeInputs";
import type { Period, Pool } from "@/lib/types";
import type { PlannerModel } from "@/lib/usePlanner";
import { flashCls, useFlash } from "./RangeControls";
import { RiskAlert, RiskPills } from "./Risk";
import ShareMenu from "./ShareMenu";
import { Card, CountUp, ErrorNote, InfoTip, Popover, SectionLabel, Skeleton, TokenLogo } from "./ui";

const PRESET_DAYS = [30, 60, 90];
const NOMINAL_DAYS: Record<Period, number> = { "24h": 1, "7d": 7, "30d": 30 };

const signedUsd = (v: number) => `${v < 0 ? "−" : "+"}${fmtUsd(Math.abs(v))}`;
const aprText = (v: number) => fmtApr(v);

const stagger: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } };
const rise: Variants = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } } };

export default function Hero({ m, onOpenRisk }: { m: PlannerModel; onOpenRisk: () => void }) {
  const { pool, estimate, binData, range, s, bins, meta } = m;
  const reduced = useReducedMotion();
  const flash = useFlash(`${range?.from}:${range?.to}:${s.strategy}:${s.amount}:${s.days}:${s.period}`);

  if (!pool) {
    if (s.pool && (meta.loading || !meta.error)) return <HeroSkeleton />;
    return <EmptyHero />;
  }
  if (!estimate) {
    if (bins.loading || meta.loading) return <HeroSkeleton pool={pool} onOpenRisk={onOpenRisk} />;
    return (
      <Card className="p-5">
        <RiskPills pool={pool} onOpen={onOpenRisk} />
        <div className="mt-4 space-y-3">
          {bins.error && <ErrorNote message={`Per-bin data unavailable: ${bins.error} No 24h pool analytics to fall back on.`} onRetry={bins.retry} retryAfter={bins.retryAfter} />}
          {!bins.error && <p className="text-sm text-muted">Enter a deposit amount to see your estimate.</p>}
        </div>
      </Card>
    );
  }

  const days = s.days;
  const fees = projectFees(estimate.dailyFees, estimate.deposit, days).simple;
  const net = estimate.netDaily === null ? null : estimate.netDaily * days;
  const glow = estimate.netApr === null ? "none" : estimate.netApr >= 0 ? "good" : "bad";

  return (
    <motion.div className="space-y-3" variants={stagger} initial={reduced ? false : "hidden"} animate="show">
      <motion.div variants={rise} className="flex flex-wrap items-center justify-between gap-2">
        <RiskPills pool={pool} onOpen={onOpenRisk} />
        <div className="flex items-center gap-2">
          <Link
            href={`/compare?${new URLSearchParams({ ...(s.chain !== null ? { chain: String(s.chain) } : {}), ...(s.pool ? { pool: s.pool } : {}), amount: String(s.amount), days: String(s.days), period: s.period })}`}
            className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-muted transition hover:bg-surface-3 hover:text-text"
          >
            Compare ranges
          </Link>
          <Popover label="Fee breakdown" trigger="Breakdown">
            <Breakdown estimate={estimate} days={days} pool={pool} binData={binData} period={s.period} />
          </Popover>
          <ShareMenu m={m} />
        </div>
      </motion.div>

      <RiskAlert pool={pool} onOpen={onOpenRisk} />

      {bins.error && (
        <motion.div variants={rise}>
          <ErrorNote message={`Per-bin data unavailable: ${bins.error} Showing a pool-level estimate.`} onRetry={bins.retry} retryAfter={bins.retryAfter} />
        </motion.div>
      )}

      <div className={`grid gap-3 rounded-2xl xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] ${flashCls(flash)}`}>
        <motion.div variants={rise}>
          <Card glow={glow} className="h-full p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CountUp value={fees} format={signedUsd} className="block text-4xl font-semibold tracking-tight text-text sm:text-5xl" />
                <div className="mt-1 flex items-center gap-1.5 text-sm text-muted">
                  est. fees in {days} days
                  <span className="text-faint">· on {fmtUsd(estimate.deposit)}</span>
                  <InfoTip>
                    Assumes the {estimate.source === "bins" ? "per-bin volume and liquidity of the data window" : "pool's recent fees, shared pro-rata with TVL"}{" "}
                    continue unchanged and the pool&apos;s deviation stays in your range (bins follow the oracle price). Fees only — excludes price moves.
                  </InfoTip>
                </div>
              </div>
              {estimate.source === "pool" && (
                <span className="rounded-full bg-warn/10 px-2 py-0.5 text-[11px] text-warn">pool-level (no per-bin data)</span>
              )}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-4">
              <BigStat label="Fee APR" tip="Your estimated fee APR on this range, after your own liquidity dilutes each bin.">
                <CountUp value={estimate.apr} format={aprText} className="text-accent" />
              </BigStat>
              <BigStat label="Net APR" sub="historical" tip={`Fees + price moves, from each bin's trading PnL. Can be negative. ${NET_NOTE}`}>
                {estimate.netApr === null ? (
                  <span className="num text-faint">—</span>
                ) : (
                  <CountUp value={estimate.netApr} format={aprText} className={estimate.netApr < 0 ? "text-bad" : "text-good"} />
                )}
              </BigStat>
            </div>

            <FeeNetBar fees={fees} net={net} />
          </Card>
        </motion.div>

        <motion.div variants={rise}>
          <Card className="h-full p-5 pb-3">
            <SectionLabel
              right={
                <span className="flex items-center gap-3 text-[11px] text-muted">
                  <Legend color="var(--accent)" label="Fees" />
                  <Legend color="var(--accent)" label="Compounded" dash="dashed" />
                  {estimate.netDaily !== null && <Legend color={netLineColor(estimate.netDaily)} label="Net" dash="dotted" />}
                </span>
              }
            >
              Projection
            </SectionLabel>
            <ProjectionChart estimate={estimate} days={days} />
          </Card>
        </motion.div>
      </div>

      <motion.div variants={rise}>
        <Card className="p-5">
          {binData && range && estimate.source === "bins" ? (
            <BinPlanStrip pool={pool} data={binData} from={range.from} to={range.to} estimate={estimate} />
          ) : (
            <p className="text-sm text-muted">No per-bin data, so there is no bin plan. Retry above to load the bins.</p>
          )}
        </Card>
      </motion.div>
    </motion.div>
  );
}

function BigStat({ label, sub, tip, children }: { label: string; sub?: string; tip: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">
        {label}
        {sub && <span className="normal-case tracking-normal text-faint">({sub})</span>}
        <InfoTip>{tip}</InfoTip>
      </div>
      <div className="mt-1 text-3xl font-semibold tracking-tight">{children}</div>
    </div>
  );
}

/** Fees vs net over the selected duration: the gap is what price moves took (or added). */
function FeeNetBar({ fees, net }: { fees: number; net: number | null }) {
  const scale = Math.max(Math.abs(fees), Math.abs(net ?? 0), 1e-9);
  const pct = (v: number) => `${Math.min(100, (Math.abs(v) / scale) * 100)}%`;
  const diff = net === null ? null : net - fees;
  return (
    <div className="mt-5 space-y-1.5">
      <BarRow label="Fees" value={fmtUsd(fees)} width={pct(fees)} color="bg-accent" />
      {net === null ? (
        <div className="text-[11px] text-faint">No net (trading PnL) data for this range.</div>
      ) : (
        <BarRow label="Net" value={signedUsd(net)} width={pct(net)} color={net < 0 ? "bg-bad" : "bg-good"} />
      )}
      {diff !== null && (
        <div className={`num pt-0.5 text-right text-[11px] ${diff < 0 ? "text-bad" : "text-good"}`}>
          price moves {diff < 0 ? "took" : "added"} {fmtUsd(Math.abs(diff))}
        </div>
      )}
    </div>
  );
}

function BarRow({ label, value, width, color }: { label: string; value: string; width: string; color: string }) {
  return (
    <div className="grid grid-cols-[2.5rem_1fr_6.5rem] items-center gap-2 text-[11px]">
      <span className="text-faint">{label}</span>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
        <motion.div className={`h-full rounded-full ${color}`} initial={false} animate={{ width }} transition={{ duration: 0.6, ease: "easeOut" }} />
      </div>
      <span className="num text-right text-muted">{value}</span>
    </div>
  );
}

function Legend({ color, label, dash = "solid" }: { color: string; label: string; dash?: "solid" | "dashed" | "dotted" }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-0 w-3.5 border-t-2" style={{ borderColor: color, borderStyle: dash }} />
      {label}
    </span>
  );
}

type ProjPoint = { d: number; simple: number; compounded: number; net: number | null };

const NET_NEUTRAL = "#e8ecf2";
/** Net line style: neutral dashed, amber when negative — clearly distinct from the teal fee lines. */
export const netLineColor = (netDaily: number | null) => (netDaily !== null && netDaily < 0 ? "var(--warn)" : NET_NEUTRAL);

function projectAt(estimate: Estimate, d: number): ProjPoint {
  const p = projectFees(estimate.dailyFees, estimate.deposit, d);
  return { d, simple: p.simple, compounded: p.compounded, net: estimate.netDaily === null ? null : estimate.netDaily * d };
}

function ProjectionChart({ estimate, days }: { estimate: Estimate; days: number }) {
  const reduced = useReducedMotion();
  const [hovering, setHovering] = useState(false);
  const maxDays = Math.max(90, days);
  const data = useMemo(() => {
    const step = Math.max(1, Math.ceil(maxDays / 120));
    const out: ProjPoint[] = [];
    for (let d = 0; d <= maxDays; d += step) out.push(projectAt(estimate, d));
    if (out[out.length - 1].d !== maxDays) out.push(projectAt(estimate, maxDays));
    return out;
  }, [estimate, maxDays]);
  const at = projectAt(estimate, days);
  const netColor = netLineColor(estimate.netDaily);
  const ticks = [...new Set([0, 30, 60, 90, days, maxDays])].filter((t) => t <= maxDays).sort((a, b) => a - b);

  return (
    <div className="h-[168px]">
      <ResponsiveContainer>
        <LineChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          onMouseMove={(e) => setHovering(!!(e as { isTooltipActive?: boolean } | null)?.isTooltipActive)}
          onMouseLeave={() => setHovering(false)}
        >
          <CartesianGrid vertical={false} stroke="var(--line)" strokeOpacity={0.6} />
          <XAxis
            dataKey="d"
            type="number"
            domain={[0, maxDays]}
            ticks={ticks}
            tickFormatter={(v) => `${v}d`}
            tick={{ fill: "var(--faint)", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            width={48}
            tick={{ fill: "var(--faint)", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => fmtUsd(v, { compact: true }).replace(".00", "")}
          />
          <ReferenceLine y={0} stroke="var(--faint)" strokeOpacity={0.5} />
          <Tooltip content={<ProjTip />} cursor={{ stroke: "var(--faint)", strokeDasharray: "3 3" }} isAnimationActive={false} />
          <Line dataKey="simple" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={!reduced} animationDuration={600} />
          <Line dataKey="compounded" stroke="var(--accent)" strokeOpacity={0.7} strokeDasharray="5 3" strokeWidth={1.5} dot={false} isAnimationActive={!reduced} animationDuration={600} />
          {estimate.netDaily !== null && (
            <Line dataKey="net" stroke={netColor} strokeOpacity={0.85} strokeDasharray="2 3" strokeWidth={1.5} dot={false} isAnimationActive={!reduced} animationDuration={600} />
          )}
          <ReferenceLine x={days} stroke="var(--text)" strokeOpacity={0.35} strokeDasharray="2 3" />
          <ReferenceDot x={days} y={at.simple} r={4} fill="var(--accent)" stroke="var(--bg)" strokeWidth={2} />
          {estimate.netDaily !== null && at.net !== null && (
            <ReferenceDot x={days} y={at.net} r={3} fill={netColor} stroke="var(--bg)" strokeWidth={2} />
          )}
          {!hovering && <Customized component={<MarkerCallout point={at} netColor={netColor} />} />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

interface ScaleAxis {
  scale: (v: number) => number;
}

/** Default callout at the selected-duration marker: fees / compounded / net at that day. Hidden while hovering. */
function MarkerCallout(props: {
  point: ProjPoint;
  netColor: string;
  xAxisMap?: Record<string, ScaleAxis>;
  yAxisMap?: Record<string, ScaleAxis>;
  offset?: { top: number; left: number; width: number; height: number };
}) {
  const xAxis = props.xAxisMap && Object.values(props.xAxisMap)[0];
  const yAxis = props.yAxisMap && Object.values(props.yAxisMap)[0];
  if (!xAxis || !yAxis || !props.offset) return null;
  const { point: p } = props;
  const rows: [string, string, string][] = [
    ["Fees", fmtUsd(p.simple), "var(--accent)"],
    ["Compounded", fmtUsd(p.compounded), "var(--text)"],
  ];
  if (p.net !== null) rows.push(["Net", signedUsd(p.net), props.netColor]);
  const w = 138;
  const h = 18 + rows.length * 14;
  const mx = xAxis.scale(p.d);
  const my = yAxis.scale(p.simple);
  const { left, top, width, height } = props.offset;
  // Prefer up-and-right of the marker; flip/clamp to stay inside the plot.
  let x = mx + 10;
  if (x + w > left + width) x = mx - 10 - w;
  x = Math.max(left + 2, x);
  const y = Math.max(top + 2, Math.min(my - h - 8, top + height - h - 2));
  return (
    <g pointerEvents="none" fontSize={10}>
      <rect x={x} y={y} width={w} height={h} rx={6} fill="#1e232c" fillOpacity={0.95} />
      <text x={x + 9} y={y + 13} fill="var(--muted)" fontFamily="var(--font-sans)">
        Day {p.d}
      </text>
      {rows.map(([label, value, color], i) => (
        <g key={label}>
          <text x={x + 9} y={y + 27 + i * 14} fill="var(--faint)" fontFamily="var(--font-sans)">
            {label}
          </text>
          <text x={x + w - 9} y={y + 27 + i * 14} fill={color} textAnchor="end" fontFamily="var(--font-mono)">
            {value}
          </text>
        </g>
      ))}
    </g>
  );
}

function ProjTip({ active, payload }: { active?: boolean; payload?: { payload: ProjPoint }[] }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="num rounded-lg bg-surface-3 px-3 py-2 text-[11px] shadow-xl shadow-black/40">
      <div className="mb-1 font-sans text-muted">Day {r.d}</div>
      <div className="grid grid-cols-[auto_auto] gap-x-3">
        <span className="font-sans text-faint">Fees</span>
        <span className="text-right text-accent">{fmtUsd(r.simple)}</span>
        <span className="font-sans text-faint">Compounded</span>
        <span className="text-right">{fmtUsd(r.compounded)}</span>
        {r.net !== null && (
          <>
            <span className="font-sans text-faint">Net</span>
            <span className={`text-right ${r.net < 0 ? "text-warn" : "text-text"}`}>{signedUsd(r.net)}</span>
          </>
        )}
      </div>
    </div>
  );
}

/** Visual ruler of mini bins around the active bin, the plan line, Copy, and the tokens needed. */
function BinPlanStrip({ pool, data, from, to, estimate }: { pool: Pool; data: BinData; from: number; to: number; estimate: Estimate }) {
  const [copied, setCopied] = useState(false);
  const rulerRef = useRef<HTMLDivElement>(null);
  const [rulerWidth, setRulerWidth] = useState(600);
  useEffect(() => {
    const el = rulerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setRulerWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const cur = data.curBinIdx;
  const span = Math.max(to, cur) - Math.min(from, cur) + 1;
  const pad = span > 60 ? 1 : span > 30 ? 2 : 4;
  const lo = Math.min(from, cur) - pad;
  const hi = Math.max(to, cur) + pad;
  const cells = [];
  for (let i = lo; i <= hi; i++) cells.push(i);
  // ~22px per label ("-10" in 9px mono plus breathing room).
  const labelStep = tickStep(cells.length, rulerWidth / 22);

  const summary = planText(data, from, to).split("\n")[2].replace(/ · active bin #-?\d+$/, "");
  const line = `#${from} (${fmtPlanPct(getBin(data, from).midPct)}) → #${to} (${fmtPlanPct(getBin(data, to).midPct)}) · ${summary}`;
  const { tokens, needs } = tokenParts(pool, estimate);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${pool.pair} (${pool.poolAddress})\n${planText(data, from, to)}\n${needs.text}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
      <div className="min-w-0">
        <SectionLabel>Bin plan</SectionLabel>
        <div ref={rulerRef} className="relative pb-3" aria-label={`Bins ${from} to ${to}, active bin ${cur}`}>
          <div className="flex h-7 items-end gap-[2px]">
            {cells.map((i) => {
              const sel = i >= from && i <= to;
              return (
                <div
                  key={i}
                  title={`#${i} · ${fmtPlanPct(getBin(data, i).midPct)}`}
                  className={`relative min-w-[3px] flex-1 rounded-[3px] transition-colors duration-300 ${
                    sel ? "h-7 bg-accent" : "h-5 bg-surface-3"
                  } ${i === cur ? "ring-2 ring-text ring-offset-1 ring-offset-surface" : ""}`}
                />
              );
            })}
          </div>
          {/* Bin indices under the selected squares and the active bin, thinned to a nice step when space is tight. */}
          <div className="num mt-1 flex h-3.5 gap-[2px] text-[9px] leading-none">
            {cells.map((i) => {
              const show = i === cur || ((i >= from && i <= to) && i % labelStep === 0 && Math.abs(i - cur) >= labelStep);
              return (
                <div key={i} className="relative min-w-[3px] flex-1">
                  {show && (
                    <span className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap ${i === cur ? "font-semibold text-text" : "text-muted"}`}>
                      {i}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex gap-[2px] text-[10px] text-faint">
            {cells.map((i) => (
              <div key={i} className="relative min-w-[3px] flex-1">
                {i === cur && <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-text">▲ active</span>}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <code className="num rounded-lg bg-surface-2 px-3 py-1.5 text-[13px] text-text">{line}</code>
          <button
            onClick={copy}
            className="relative h-8 w-24 overflow-hidden rounded-lg bg-accent/15 text-xs font-medium text-accent transition hover:bg-accent/25"
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
                {copied ? "Copied ✓" : "Copy plan"}
              </motion.span>
            </AnimatePresence>
          </button>
        </div>
      </div>
      <div className="lg:text-right">
        <SectionLabel>You&apos;ll need</SectionLabel>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-lg lg:justify-end">
          {tokens.length === 0 && <span className="text-faint">—</span>}
          {tokens.map((t, i) => (
            <span key={t.token.symbol} className="flex items-center gap-2">
              {i > 0 && <span className="text-faint">+</span>}
              <TokenLogo src={t.token.logoUrl} symbol={t.token.symbol} size={22} />
              {t.need.amount !== null ? (
                <>
                  <span className="num">{t.need.amount}</span>
                  <span className="text-sm text-muted">{t.token.symbol}</span>
                  <span className="num text-sm text-faint">≈ {t.need.usd}</span>
                </>
              ) : (
                <>
                  <span className="num">{t.need.usd}</span>
                  <span className="text-sm text-muted">of {t.token.symbol}</span>
                  <span className="text-xs text-warn">price n/a</span>
                </>
              )}
            </span>
          ))}
        </div>
        {tokens.length > 0 && <div className="num mt-1 text-xs text-muted lg:text-right">total {needs.total}</div>}
      </div>
    </div>
  );
}

function tokenParts(pool: Pool, e: Estimate) {
  const needs = tokenNeeds(e, pool.token0, pool.token1);
  return { needs, tokens: needs.parts.map((need) => ({ token: need.side === 0 ? pool.token0 : pool.token1, need })) };
}

function Breakdown({ estimate, days, pool, binData, period }: { estimate: Estimate; days: number; pool: Pool; binData: BinData | null; period: Period }) {
  const durations = [...new Set([...PRESET_DAYS, days])].sort((a, b) => a - b);
  let poolFeesSub: string | null = null;
  if (estimate.source === "bins" && binData) {
    const short = binData.windowDays < NOMINAL_DAYS[period] * 0.97;
    poolFeesSub = `${fmtUsd(poolWindowDailyFees(binData))} avg/day over ${short ? `${binData.windowDays.toFixed(1)}d (young pool)` : `the ${period} window`}`;
  } else {
    const p24 = poolDailyFees(pool);
    if (p24) poolFeesSub = `${fmtUsd(p24.dailyFees)}/day (24h)`;
  }
  return (
    <div className="w-[min(88vw,420px)] space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-3">
        <Mini label="Your fees / day" value={fmtUsd(estimate.dailyFees)} />
        <Mini label="Pool 7d fee APR" value={fmtApr(bpsToFraction(pool.aprBps7d))} sub={poolFeesSub ?? undefined} />
      </div>
      <table className="num w-full text-xs">
        <thead className="text-left text-[10px] uppercase tracking-[0.08em] text-faint">
          <tr>
            <th className="py-1 font-sans font-medium">Days</th>
            <th className="py-1 text-right font-sans font-medium">Fees</th>
            <th className="py-1 text-right font-sans font-medium">Compounded</th>
            <th className="py-1 text-right font-sans font-medium">Net (hist.)</th>
          </tr>
        </thead>
        <tbody>
          {durations.map((d) => {
            const p = projectFees(estimate.dailyFees, estimate.deposit, d);
            const n = estimate.netDaily === null ? null : estimate.netDaily * d;
            return (
              <tr key={d} className={`border-t border-line/60 ${d === days ? "text-text" : "text-muted"}`}>
                <td className="py-1.5">{d}</td>
                <td className="py-1.5 text-right">{fmtUsd(p.simple)}</td>
                <td className="py-1.5 text-right">{fmtUsd(p.compounded)}</td>
                <td className={`py-1.5 text-right ${n !== null && n < 0 ? "text-bad" : ""}`}>{n === null ? "—" : signedUsd(n)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-[11px] leading-relaxed text-faint">
        Compounded: r = fees/day ÷ deposit, value = D(1+r)^days − D. Net replays each bin&apos;s historical trading PnL (fees + price moves), not
        compounded. {estimate.netSkippedBins > 0 && `${estimate.netSkippedBins} bin(s) without net data are counted as 0. `}
        {NET_NOTE}
      </p>
    </div>
  );
}

function Mini({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.08em] text-faint">{label}</div>
      <div className="num mt-0.5 text-base">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-faint">{sub}</div>}
    </div>
  );
}

function HeroSkeleton({ pool, onOpenRisk }: { pool?: Pool; onOpenRisk?: () => void }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading estimate">
      <div className="flex items-center justify-between">
        {pool && onOpenRisk ? <RiskPills pool={pool} onOpen={onOpenRisk} /> : <Skeleton className="h-6 w-72 rounded-full" />}
        <Skeleton className="h-7 w-40" />
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <Card className="space-y-4 p-5">
          <Skeleton className="h-12 w-52" />
          <Skeleton className="h-4 w-40" />
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
          <Skeleton className="h-8" />
        </Card>
        <Card className="p-5">
          <Skeleton className="h-[188px]" />
        </Card>
      </div>
      <Card className="space-y-3 p-5">
        <Skeleton className="h-7" />
        <Skeleton className="h-8 w-2/3" />
      </Card>
    </div>
  );
}

function EmptyHero() {
  return (
    <Card className="flex min-h-[420px] flex-col items-center justify-center p-10 text-center">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Plan a Metric LP position, bin by bin.</h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
        Pick a pool and a deposit. Binwise estimates your fees and historical net return from each bin&apos;s recent volume and liquidity, and
        tells you exactly which bins to fill.
      </p>
    </Card>
  );
}
