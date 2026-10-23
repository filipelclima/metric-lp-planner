"use client";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { fmtAmount, fmtApr, fmtUsd, fmtWidth, parseBins, type BinData } from "@/lib/calc";
import {
  MAX_SCENARIOS,
  SCENARIO_LABELS,
  bestPerRow,
  computeScenario,
  readCompareState,
  resolveRange,
  scenarioName,
  verdicts,
  writeCompareState,
  type CompareState,
  type MetricKey,
  type PresetShare,
  type Scenario,
  type ScenarioMetrics,
} from "@/lib/compare";
import type { Period, Pool, RawBinsResponse, Strategy } from "@/lib/types";
import { compareOgQuery, compareSnapshotParams, freezeCompareSnapshot, makeShareId, today } from "@/lib/share";
import { useApi } from "@/lib/useApi";
import { useApis } from "@/lib/useApis";
import PoolPicker from "../PoolPicker";
import { ShareMenu, type ShareLinks } from "../ShareMenu";
import { Card, ChainBadge, ErrorNote, Field, InfoTip, Segmented, Skeleton, inputCls } from "../ui";
import { AprBars, OverlayHistogram, SCENARIO_COLORS } from "./CompareCharts";

const PRESET_DAYS = [30, 60, 90];
const poolKey = (chainId: number, address: string) => `${chainId}:${address.toLowerCase()}`;

interface Resolved {
  scenario: Scenario;
  label: string;
  color: string;
  pool: Pool | null;
  data: BinData | null;
  metrics: ScenarioMetrics | null;
  loading: boolean;
  error: string | null;
}

export default function Compare() {
  const router = useRouter();
  const params = useSearchParams();
  const [s, setS] = useState<CompareState>(() => readCompareState(new URLSearchParams(params.toString())));
  const set = (patch: Partial<CompareState>) => setS((p) => ({ ...p, ...patch }));
  const [hovered, setHovered] = useState<number | null>(null);
  const [tab, setTab] = useState(0);

  const qs = writeCompareState(s);
  useEffect(() => {
    if (qs !== params.toString()) router.replace(`/compare?${qs}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);

  const list = useApi<{ pools: Pool[] }>("/api/pools");

  // Every distinct pool in play: the base pool plus any per-scenario override.
  const poolsInPlay = useMemo(() => {
    const out = new Map<string, { chainId: number; address: string }>();
    if (s.chain !== null && s.pool) out.set(poolKey(s.chain, s.pool), { chainId: s.chain, address: s.pool });
    for (const sc of s.scenarios) if (sc.pool) out.set(poolKey(sc.pool.chainId, sc.pool.address), sc.pool);
    return [...out.values()];
  }, [s.chain, s.pool, s.scenarios]);
  const metaUrl = (p: { chainId: number; address: string }) => `/api/pools/${p.chainId}/${p.address}`;
  const binsUrl = (p: { chainId: number; address: string }) => `${metaUrl(p)}/bins?period=${s.period}`;
  const metas = useApis<{ pool: Pool }>(poolsInPlay.map(metaUrl));
  const bins = useApis<RawBinsResponse>(poolsInPlay.map(binsUrl));

  const resolved: Resolved[] = useMemo(
    () =>
      s.scenarios.map((sc, i) => {
        const ref = sc.pool ?? (s.chain !== null && s.pool ? { chainId: s.chain, address: s.pool } : null);
        const base = { scenario: sc, label: SCENARIO_LABELS[i], color: SCENARIO_COLORS[i] };
        if (!ref) return { ...base, pool: null, data: null, metrics: null, loading: false, error: null };
        const m = metas.get(metaUrl(ref));
        const b = bins.get(binsUrl(ref));
        const pool = m.data?.pool ?? list.data?.pools.find((p) => poolKey(p.chainId, p.poolAddress) === poolKey(ref.chainId, ref.address)) ?? null;
        let data: BinData | null = null;
        try {
          data = b.data ? parseBins(b.data) : null;
        } catch {
          data = null;
        }
        const metrics =
          data && pool && s.amount > 0
            ? computeScenario(data, resolveRange(sc, data), sc.strategy, s.amount, s.days, { token0: pool.token0.fiatPrice, token1: pool.token1.fiatPrice })
            : null;
        return { ...base, pool, data, metrics, loading: b.loading || m.loading, error: b.error ?? m.error };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s, metas, bins, list.data],
  );
  const metrics = resolved.map((r) => r.metrics);
  const best = useMemo(() => bestPerRow(metrics), [metrics]);
  const verdictList = useMemo(() => verdicts(metrics), [metrics]);
  const basePool = resolved.find((r) => !r.scenario.pool)?.pool ?? (s.chain !== null && s.pool ? list.data?.pools.find((p) => p.poolAddress.toLowerCase() === s.pool!.toLowerCase()) ?? null : null);
  const baseData = resolved.find((r) => !r.scenario.pool && r.data)?.data ?? null;
  const overlays = resolved.flatMap((r) => (!r.scenario.pool && r.metrics ? [{ label: r.label, from: r.metrics.from, to: r.metrics.to, color: r.color }] : []));
  const anyError = resolved.find((r) => r.error)?.error ?? null;

  const updateScenario = (i: number, patch: Partial<Scenario>) => set({ scenarios: s.scenarios.map((sc, j) => (j === i ? { ...sc, ...patch } : sc)) });
  const removeScenario = (i: number) => {
    set({ scenarios: s.scenarios.filter((_, j) => j !== i) });
    setTab((t) => Math.max(0, Math.min(t, s.scenarios.length - 2)));
  };
  const addScenario = () => {
    const used = new Set(s.scenarios.map((sc) => (sc.range.kind === "preset" ? sc.range.share : 0)));
    const share = ([95, 90, 80] as PresetShare[]).find((x) => !used.has(x)) ?? 90;
    const next: Scenario = { range: { kind: "preset", share }, strategy: "uniform" };
    set({ scenarios: [...s.scenarios, next].slice(0, MAX_SCENARIOS) });
  };

  const plannerHref = `/?${new URLSearchParams({ ...(s.chain !== null ? { chain: String(s.chain) } : {}), ...(s.pool ? { pool: s.pool } : {}), amount: String(s.amount), days: String(s.days), period: s.period }).toString()}`;

  const build = (): ShareLinks => {
    const snap = freezeCompareSnapshot({
      pair: basePool?.pair ?? null,
      chainId: s.chain,
      days: s.days,
      date: today(),
      cols: resolved.flatMap((r) =>
        r.metrics
          ? [{ from: r.metrics.from, to: r.metrics.to, feeApr: r.metrics.feeApr * 100, netApr: r.metrics.netApr === null ? null : r.metrics.netApr * 100, fees: r.metrics.feesSimple, pair: r.scenario.pool ? (r.pool?.pair ?? null) : null }]
          : [],
      ),
    });
    const origin = window.location.origin;
    const text = `Comparing LP ranges on ${basePool?.pair ?? "a Metric pool"} with Binwise: ${resolved
      .flatMap((r) => (r.metrics ? [`${r.label} #${r.metrics.from}→#${r.metrics.to} fee ${fmtApr(r.metrics.feeApr)}${r.metrics.netApr !== null ? ` / net ${fmtApr(r.metrics.netApr)}` : ""}`] : []))
      .join(" · ")}`;
    return {
      link: `${origin}/compare?${qs}${snap ? `&${compareSnapshotParams(snap)}` : ""}&s=${makeShareId()}`,
      image: `${origin}/api/og?${compareOgQuery(snap)}`,
      text,
      asOf: snap ? new Date(`${snap.date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null,
      fileName: `binwise-compare-${(basePool?.pair ?? "pool").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`,
    };
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={plannerHref} className="text-xs text-muted hover:text-text">
            ← Back to the planner
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Compare ranges</h1>
          <p className="mt-1 text-sm text-muted">Same deposit, duration and data period; up to three ranges side by side.</p>
        </div>
        {metrics.some(Boolean) && <ShareMenu build={build} />}
      </div>

      <Card className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,0.8fr)]">
        <Field label="Pool">
          <PoolPicker list={list} selected={basePool} hasSelection={!!s.pool} onSelect={(p) => set({ chain: p.chainId, pool: p.poolAddress })} />
        </Field>
        <AmountInput value={s.amount} onChange={(amount) => set({ amount })} />
        <DurationInput value={s.days} onChange={(days) => set({ days })} />
        <Field label="Data period">
          <Segmented<Period>
            full
            value={s.period}
            onChange={(period) => set({ period })}
            options={[
              { value: "24h", label: "24h" },
              { value: "7d", label: "7d" },
              { value: "30d", label: "30d" },
            ]}
          />
        </Field>
      </Card>

      {!s.pool ? (
        <Card className="p-10 text-center text-sm text-muted">Pick a pool to compare ranges.</Card>
      ) : (
        <>
          {anyError && <ErrorNote message={`Couldn't load bin data: ${anyError}`} onRetry={() => (metas.retry(), bins.retry())} />}

          <div className={`grid gap-3 ${s.scenarios.length >= 3 ? "lg:grid-cols-3" : "lg:grid-cols-[repeat(auto-fit,minmax(0,1fr))]"} md:grid-cols-2`}>
            {resolved.map((r, i) => (
              <ScenarioEditor
                key={i}
                r={r}
                list={list}
                canRemove={s.scenarios.length > 1}
                hot={hovered === i}
                onHover={(h) => setHovered(h ? i : null)}
                onChange={(patch) => updateScenario(i, patch)}
                onRemove={() => removeScenario(i)}
              />
            ))}
            {s.scenarios.length < MAX_SCENARIOS && (
              <button
                onClick={addScenario}
                className="flex min-h-32 items-center justify-center rounded-2xl border border-dashed border-line text-sm text-muted transition hover:border-accent/50 hover:text-accent"
              >
                + Add scenario
              </button>
            )}
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Card className="p-5">
              <div className="mb-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">
                Ranges on {basePool?.pair ?? "the pool"}
                <InfoTip side="bottom">Pool liquidity per bin with each scenario&apos;s range. Scenarios on a different pool aren&apos;t drawn here.</InfoTip>
              </div>
              {baseData && overlays.length > 0 ? (
                <OverlayHistogram data={baseData} overlays={overlays} hovered={hovered} onHover={setHovered} />
              ) : (
                <Skeleton className="h-56" />
              )}
            </Card>
            <Card className="p-5">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">Fee APR vs net APR</div>
              {metrics.some(Boolean) ? (
                <AprBars
                  items={resolved.flatMap((r) => (r.metrics ? [{ label: r.label, feeApr: r.metrics.feeApr, netApr: r.metrics.netApr, color: r.color }] : []))}
                  hovered={hovered}
                  onHover={setHovered}
                />
              ) : (
                <Skeleton className="h-56" />
              )}
            </Card>
          </div>

          <CompareTable resolved={resolved} best={best} verdictList={verdictList} days={s.days} hovered={hovered} onHover={setHovered} />
          <MobileTabs resolved={resolved} best={best} verdictList={verdictList} days={s.days} tab={Math.min(tab, resolved.length - 1)} setTab={setTab} />

          <p className="text-center text-[11px] text-faint">
            Estimates from the {s.period} window&apos;s per-bin fees and liquidity; net APR is historical (fees + price moves). Fees ≠ profit.
          </p>
        </>
      )}
    </div>
  );
}

function ScenarioEditor({
  r,
  list,
  canRemove,
  hot,
  onHover,
  onChange,
  onRemove,
}: {
  r: Resolved;
  list: ReturnType<typeof useApi<{ pools: Pool[] }>>;
  canRemove: boolean;
  hot: boolean;
  onHover: (h: boolean) => void;
  onChange: (p: Partial<Scenario>) => void;
  onRemove: () => void;
}) {
  const sc = r.scenario;
  const [otherPool, setOtherPool] = useState(!!sc.pool);
  return (
    <Card className={`p-4 transition ${hot ? "ring-1" : ""}`}>
      <div onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} style={hot ? { boxShadow: `inset 0 2px 0 ${r.color}` } : undefined}>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold text-bg" style={{ background: r.color }}>
              {r.label}
            </span>
            <span className="text-sm font-medium">{scenarioName(sc)}</span>
            {r.metrics && (
              <span className="num text-xs text-muted">
                #{r.metrics.from} → #{r.metrics.to}
              </span>
            )}
          </span>
          {canRemove && (
            <button onClick={onRemove} aria-label={`Remove scenario ${r.label}`} className="rounded px-1.5 text-faint hover:bg-surface-2 hover:text-text">
              ✕
            </button>
          )}
        </div>
        <div className="mt-3 space-y-2.5">
          <Segmented<PresetShare | "manual">
            full
            size="sm"
            value={sc.range.kind === "preset" ? sc.range.share : "manual"}
            onChange={(v) =>
              onChange({
                range: v === "manual" ? { kind: "manual", from: r.metrics?.from ?? -5, to: r.metrics?.to ?? 5 } : { kind: "preset", share: v },
              })
            }
            options={[
              { value: 80, label: "80%" },
              { value: 90, label: "90%" },
              { value: 95, label: "95%" },
              { value: "manual", label: "Manual" },
            ]}
          />
          <div className="grid grid-cols-2 gap-2">
            <BinInput label="Start bin" value={r.metrics?.from ?? null} onCommit={(v) => onChange({ range: { kind: "manual", from: Math.min(v, r.metrics?.to ?? v), to: Math.max(v, r.metrics?.to ?? v) } })} />
            <BinInput label="End bin" value={r.metrics?.to ?? null} onCommit={(v) => onChange({ range: { kind: "manual", from: Math.min(v, r.metrics?.from ?? v), to: Math.max(v, r.metrics?.from ?? v) } })} />
          </div>
          <Segmented<Strategy>
            full
            size="sm"
            value={sc.strategy}
            onChange={(strategy) => onChange({ strategy })}
            options={[
              { value: "uniform", label: "Uniform" },
              { value: "curve", label: "Curve" },
              { value: "fee", label: "Fee-weighted" },
            ]}
          />
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={otherPool}
              onChange={(e) => {
                setOtherPool(e.target.checked);
                if (!e.target.checked) onChange({ pool: undefined });
              }}
              className="accent-[var(--accent)]"
            />
            Different pool (same deposit)
          </label>
          {otherPool && (
            <PoolPicker
              list={list}
              selected={sc.pool ? r.pool : null}
              hasSelection={!!sc.pool}
              onSelect={(p) => onChange({ pool: { chainId: p.chainId, address: p.poolAddress }, range: { kind: "preset", share: sc.range.kind === "preset" ? sc.range.share : 90 } })}
            />
          )}
        </div>
      </div>
    </Card>
  );
}

// ---------- table ----------

type Row = { key: string; label: string; tip?: string; best?: MetricKey; render: (m: ScenarioMetrics, r: Resolved) => React.ReactNode };

function rows(days: number): Row[] {
  return [
    {
      key: "range",
      label: "Range",
      render: (m) => (
        <span>
          #{m.from} → #{m.to}
          <span className="block font-sans text-[11px] text-faint">
            {fmtWidth(m.widthPct * 1e4)} wide · {m.bins} bin{m.bins === 1 ? "" : "s"}
          </span>
        </span>
      ),
    },
    {
      key: "cov",
      label: "Volume covered",
      tip: "Share of the data window's volume that traded inside the range: a proxy for how often you earn.",
      best: "volumeCovered",
      render: (m) => (m.volumeCovered === null ? "—" : `${(m.volumeCovered * 100).toFixed(1)}%`),
    },
    {
      key: "share",
      label: "Your share of liquidity",
      tip: "Your deposit ÷ (liquidity already in the range + your deposit): how concentrated you are.",
      best: "share",
      render: (m) => `${(m.share * 100).toFixed(2)}%`,
    },
    { key: "fee", label: "Fee APR", best: "feeApr", render: (m) => <span className="text-accent">{fmtApr(m.feeApr)}</span> },
    {
      key: "fees",
      label: `Est. fees · ${days}d`,
      best: "feesSimple",
      render: (m) => (
        <span>
          {fmtUsd(m.feesSimple)}
          <span className="block font-sans text-[11px] text-faint">compounded {fmtUsd(m.feesCompounded)}</span>
        </span>
      ),
    },
    {
      key: "net",
      label: "Net APR (historical)",
      tip: "Fees + price moves over the data window, from each bin's trading PnL. Can be negative.",
      best: "netApr",
      render: (m) => <span className={m.netApr === null ? "text-faint" : m.netApr < 0 ? "text-bad" : "text-good"}>{fmtApr(m.netApr)}</span>,
    },
    {
      key: "netUsd",
      label: `Net · ${days}d`,
      best: "netUsd",
      render: (m) => (m.netUsd === null ? "—" : <span className={m.netUsd < 0 ? "text-bad" : "text-good"}>{`${m.netUsd < 0 ? "−" : "+"}${fmtUsd(Math.abs(m.netUsd))}`}</span>),
    },
    { key: "drag", label: "Price drag", tip: "Fee APR − net APR: how much price moves ate.", best: "priceDrag", render: (m) => fmtApr(m.priceDrag) },
    {
      key: "tokens",
      label: "Tokens needed",
      render: (m, r) => {
        const parts: string[] = [];
        if (m.token1Usd > 0) parts.push(r.pool?.token1.fiatPrice ? `${fmtAmount(m.token1Amount, r.pool.token1.fiatPrice)} ${r.pool.token1.symbol}` : `${fmtUsd(m.token1Usd)} of ${r.pool?.token1.symbol ?? "token1"}`);
        if (m.token0Usd > 0) parts.push(r.pool?.token0.fiatPrice ? `${fmtAmount(m.token0Amount, r.pool.token0.fiatPrice)} ${r.pool.token0.symbol}` : `${fmtUsd(m.token0Usd)} of ${r.pool?.token0.symbol ?? "token0"}`);
        return <span className="text-[12px]">{parts.join(" + ") || "—"}</span>;
      },
    },
    {
      key: "idle",
      label: "Idle bins",
      tip: "Bins in the range that traded ~0 volume (under 0.1% of the window's total).",
      best: "idle",
      render: (m) => (m.idle.length === 0 ? "0" : <span className="text-warn">{m.idle.length}<span className="ml-1 font-sans text-[11px] text-faint">({compactRuns(m.idle)})</span></span>),
    },
  ];
}

function compactRuns(idx: number[]): string {
  const out: string[] = [];
  let start = idx[0];
  for (let i = 1; i <= idx.length; i++) {
    if (i === idx.length || idx[i] !== idx[i - 1] + 1) {
      out.push(start === idx[i - 1] ? `#${start}` : `#${start}–#${idx[i - 1]}`);
      start = idx[i];
    }
  }
  return out.slice(0, 3).join(", ") + (out.length > 3 ? "…" : "");
}

function CompareTable({
  resolved,
  best,
  verdictList,
  days,
  hovered,
  onHover,
}: {
  resolved: Resolved[];
  best: Record<MetricKey, number[]>;
  verdictList: (string | null)[];
  days: number;
  hovered: number | null;
  onHover: (i: number | null) => void;
}) {
  return (
    <Card className="hidden overflow-x-auto md:block">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-line/60">
            <th className="w-48 px-4 py-3" />
            {resolved.map((r, i) => (
              <th
                key={r.label}
                onMouseEnter={() => onHover(i)}
                onMouseLeave={() => onHover(null)}
                className={`px-4 py-3 text-left transition-colors ${hovered === i ? "bg-surface-2/70" : ""}`}
                style={{ boxShadow: `inset 0 3px 0 ${r.color}` }}
              >
                <span className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold text-bg" style={{ background: r.color }}>
                    {r.label}
                  </span>
                  <span className="font-medium">{scenarioName(r.scenario)}</span>
                  {r.scenario.pool && r.pool && (
                    <span className="flex items-center gap-1 text-xs text-muted">
                      · {r.pool.pair} <ChainBadge chainId={r.pool.chainId} />
                    </span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows(days).map((row) => (
            <tr key={row.key} className="border-b border-line/40">
              <td className="px-4 py-2.5 text-[12px] text-muted">
                <span className="flex items-center gap-1.5">
                  {row.label}
                  {row.tip && <InfoTip>{row.tip}</InfoTip>}
                </span>
              </td>
              {resolved.map((r, i) => {
                const isBest = row.best ? best[row.best].includes(i) : false;
                return (
                  <td
                    key={r.label}
                    onMouseEnter={() => onHover(i)}
                    onMouseLeave={() => onHover(null)}
                    className={`num px-4 py-2.5 transition-colors ${hovered === i ? "bg-surface-2/70" : ""}`}
                  >
                    {r.metrics ? (
                      <span className={`inline-block rounded-md px-1.5 py-0.5 ${isBest ? "bg-accent/12 ring-1 ring-accent/40" : ""}`}>{row.render(r.metrics, r)}</span>
                    ) : r.loading ? (
                      <Skeleton className="h-4 w-20" />
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr>
            <td className="px-4 py-3 text-[12px] text-muted">Verdict</td>
            {resolved.map((r, i) => (
              <td key={r.label} className={`px-4 py-3 text-[13px] ${hovered === i ? "bg-surface-2/70" : ""}`} onMouseEnter={() => onHover(i)} onMouseLeave={() => onHover(null)}>
                {verdictList[i] ?? "—"}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="px-4 py-2 text-[11px] text-faint">Highlighted: the best value in each row.</p>
    </Card>
  );
}

function MobileTabs({
  resolved,
  best,
  verdictList,
  days,
  tab,
  setTab,
}: {
  resolved: Resolved[];
  best: Record<MetricKey, number[]>;
  verdictList: (string | null)[];
  days: number;
  tab: number;
  setTab: (i: number) => void;
}) {
  const r = resolved[tab];
  return (
    <div className="md:hidden">
      <div className="mb-2 flex gap-1 rounded-xl bg-surface p-1">
        {resolved.map((x, i) => (
          <button
            key={x.label}
            onClick={() => setTab(i)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm transition ${i === tab ? "bg-surface-3 text-text" : "text-muted"}`}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: x.color }} />
            {x.label} · {scenarioName(x.scenario)}
          </button>
        ))}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.18 }}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.2}
          onDragEnd={(_, info) => {
            if (info.offset.x < -60 && tab < resolved.length - 1) setTab(tab + 1);
            if (info.offset.x > 60 && tab > 0) setTab(tab - 1);
          }}
        >
          <Card className="p-4" >
            <div className="h-1 rounded-full" style={{ background: r.color }} />
            <dl className="mt-3 space-y-2.5">
              {rows(days).map((row) => {
                const isBest = row.best ? best[row.best].includes(tab) : false;
                return (
                  <div key={row.key} className="flex items-start justify-between gap-3 text-sm">
                    <dt className="text-[12px] text-muted">{row.label}</dt>
                    <dd className={`num rounded-md px-1.5 text-right ${isBest ? "bg-accent/12 ring-1 ring-accent/40" : ""}`}>
                      {r.metrics ? row.render(r.metrics, r) : r.loading ? <Skeleton className="h-4 w-16" /> : "—"}
                    </dd>
                  </div>
                );
              })}
            </dl>
            <p className="mt-3 border-t border-line/60 pt-3 text-[13px]">{verdictList[tab] ?? "—"}</p>
            {resolved.length > 1 && <p className="mt-2 text-center text-[10px] text-faint">Swipe or tap the tabs to switch scenarios</p>}
          </Card>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ---------- inputs ----------

function AmountInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (Number(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Field label="Deposit">
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint">$</span>
        <input
          type="number"
          min={0}
          step="any"
          aria-label="Deposit in USD"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value);
            if (n > 0) onChange(n);
          }}
          className={`${inputCls} pl-7`}
        />
      </div>
    </Field>
  );
}

function DurationInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const custom = !PRESET_DAYS.includes(value);
  return (
    <Field label="Duration">
      <div className="flex items-center gap-2">
        <Segmented<number | "custom">
          full
          value={custom ? "custom" : value}
          onChange={(v) => onChange(v === "custom" ? (custom ? value : 14) : v)}
          options={[...PRESET_DAYS.map((d) => ({ value: d, label: `${d}d` })), { value: "custom" as const, label: "Custom" }]}
        />
        {custom && (
          <input
            type="number"
            min={1}
            defaultValue={value}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value));
              if (n > 0) onChange(Math.min(n, 3650));
            }}
            className={`${inputCls} w-20 shrink-0`}
            aria-label="Custom duration in days"
          />
        )}
      </div>
    </Field>
  );
}

function BinInput({ label, value, onCommit }: { label: string; value: number | null; onCommit: (v: number) => void }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => setText(value === null ? "" : String(value)), [value]);
  const commit = () => {
    if (/^-?\d+$/.test(text.trim())) onCommit(Number(text));
    else setText(value === null ? "" : String(value));
  };
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-faint">{label}</span>
      <input value={text} inputMode="numeric" onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} className={inputCls} placeholder="#" />
    </label>
  );
}
