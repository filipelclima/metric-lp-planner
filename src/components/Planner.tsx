"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  bpsToFraction,
  estimateFromBins,
  estimateFromPool,
  fmtApr,
  fmtUsd,
  parseBins,
  poolDailyFees,
  poolWindowDailyFees,
  presetRange,
  projectFees,
  type BinData,
  type Estimate,
} from "@/lib/calc";
import type { Period, Pool, RawBinsResponse, Strategy } from "@/lib/types";
import { readState, writeState, type PlannerState } from "@/lib/urlState";
import { useApi } from "@/lib/useApi";
import BinPlan from "./BinPlan";
import Histogram from "./Histogram";
import PoolPicker from "./PoolPicker";
import RiskPanel, { RedTierBanner } from "./RiskPanel";
import { ErrorNote, Field, Panel, Segmented, inputCls } from "./ui";

const PRESET_DAYS = [30, 60, 90];

export default function Planner() {
  const router = useRouter();
  const params = useSearchParams();
  const [s, setS] = useState<PlannerState>(() => readState(new URLSearchParams(params.toString())));
  const set = (patch: Partial<PlannerState>) => setS((p) => ({ ...p, ...patch }));

  const list = useApi<{ pools: Pool[] }>("/api/pools");
  const base = s.chain !== null && s.pool ? `/api/pools/${s.chain}/${s.pool}` : null;
  const meta = useApi<{ pool: Pool }>(base);
  const bins = useApi<RawBinsResponse>(base && `${base}/bins?period=${s.period}`);

  const listed = useMemo(
    () => list.data?.pools.find((p) => p.chainId === s.chain && p.poolAddress.toLowerCase() === s.pool?.toLowerCase()) ?? null,
    [list.data, s.chain, s.pool],
  );
  const pool = meta.data?.pool ?? listed;

  const prices = useMemo(() => ({ token0: pool?.token0.fiatPrice ?? null, token1: pool?.token1.fiatPrice ?? null }), [pool]);

  const binData = useMemo(() => {
    if (!bins.data) return null;
    try {
      return parseBins(bins.data);
    } catch {
      return null;
    }
  }, [bins.data]);
  const curBinIdx = binData?.curBinIdx ?? pool?.curBinIdx ?? 0;

  const range = useMemo(() => {
    if (s.range.kind === "manual") return { from: s.range.from, to: s.range.to };
    if (!binData) return null;
    return presetRange(binData, s.range.share / 100) ?? { from: curBinIdx - 5, to: curBinIdx + 5 };
  }, [s.range, binData, curBinIdx]);

  const estimate: Estimate | null = useMemo(() => {
    if (!pool || !(s.amount > 0)) return null;
    if (binData && range) return estimateFromBins(binData, range.from, range.to, s.strategy, s.amount, prices);
    if (bins.error) return estimateFromPool(pool, s.amount);
    return null;
  }, [pool, binData, range, s.strategy, s.amount, prices, bins.error]);

  // Keep the URL shareable.
  useEffect(() => {
    const qs = writeState(s, range);
    if (qs !== params.toString()) router.replace(`?${qs}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, range]);

  const selectPool = (p: Pool) => set({ chain: p.chainId, pool: p.poolAddress, range: { kind: "preset", share: 90 } });

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(360px,420px)_1fr]">
      <div className="space-y-5">
        <Panel title="1 · Pool">
          <PoolPicker list={list} selected={pool} onSelect={selectPool} hasSelection={!!s.pool} />
          {meta.error && !listed && <div className="mt-2"><ErrorNote message={meta.error} retryAfter={meta.retryAfter} onRetry={meta.retry} /></div>}
        </Panel>

        <Panel title="2 · Position">
          <div className="space-y-4">
            <AmountInput value={s.amount} onChange={(amount) => set({ amount })} />
            <DurationInput value={s.days} onChange={(days) => set({ days })} />
            <Field label="Range" hint={s.range.kind === "preset" ? `Covers ${s.range.share}% of volume` : "Manual"}>
              <Segmented
                value={s.range.kind === "preset" ? s.range.share : "manual"}
                onChange={(v) =>
                  v === "manual"
                    ? set({ range: { kind: "manual", from: range?.from ?? curBinIdx - 5, to: range?.to ?? curBinIdx + 5 } })
                    : set({ range: { kind: "preset", share: v } })
                }
                options={[
                  { value: 80 as const, label: "80%", title: "Smallest range covering 80% of recent volume" },
                  { value: 90 as const, label: "90%", title: "Smallest range covering 90% of recent volume" },
                  { value: 95 as const, label: "95%", title: "Smallest range covering 95% of recent volume" },
                  { value: "manual" as const, label: "Manual" },
                ]}
              />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <BinInput
                  label="Start bin"
                  value={range?.from ?? null}
                  onChange={(from) => set({ range: { kind: "manual", from: Math.min(from, range?.to ?? from), to: Math.max(from, range?.to ?? from) } })}
                />
                <BinInput
                  label="End bin"
                  value={range?.to ?? null}
                  onChange={(to) => set({ range: { kind: "manual", from: Math.min(to, range?.from ?? to), to: Math.max(to, range?.from ?? to) } })}
                />
              </div>
            </Field>
            <Field label="Distribution">
              <Segmented<Strategy>
                value={s.strategy}
                onChange={(strategy) => set({ strategy })}
                options={[
                  { value: "uniform", label: "Uniform", title: "Equal USD in every bin" },
                  { value: "curve", label: "Curve", title: "Weighted toward the active bin" },
                  { value: "fee", label: "Fee-weighted", title: "Proportional to each bin's daily fees / liquidity" },
                ]}
              />
            </Field>
            <Field label="Data period" hint={binData && <WindowHint days={binData.windowDays} period={s.period} />}>
              <Segmented<Period>
                value={s.period}
                onChange={(period) => set({ period })}
                options={[
                  { value: "24h", label: "24h" },
                  { value: "7d", label: "7d" },
                  { value: "30d", label: "30d" },
                ]}
              />
            </Field>
          </div>
        </Panel>

        {pool && (
          <div className="hidden lg:block">
            <RiskPanel pool={pool} />
          </div>
        )}
      </div>

      <div className="min-w-0 space-y-5">
        {!pool && !meta.loading && (
          <Panel>
            <div className="py-16 text-center">
              <h1 className="text-2xl font-semibold tracking-tight">Plan a Metric LP position, bin by bin.</h1>
              <p className="mx-auto mt-2 max-w-lg text-sm text-muted">
                Pick a pool, enter a deposit and a range. Binwise estimates your fees from each bin&apos;s recent volume and liquidity and tells you
                exactly which bins to fill and with which tokens.
              </p>
            </div>
          </Panel>
        )}
        {pool && <RedTierBanner pool={pool} />}
        {pool && (
          <Panel
            title="Estimated fees"
            right={estimate?.source === "pool" && <span className="rounded-full bg-warn/15 px-2 py-0.5 text-xs text-warn">pool-level (no per-bin data)</span>}
          >
            {bins.error && (
              <div className="mb-3">
                <ErrorNote
                  message={`Per-bin data unavailable: ${bins.error} ${estimate ? "Showing a pool-level estimate." : "No 24h pool analytics to fall back on."}`}
                  retryAfter={bins.retryAfter}
                  onRetry={bins.retry}
                />
              </div>
            )}
            {estimate ? (
              <FeeSummary estimate={estimate} days={s.days} pool={pool} binData={binData} period={s.period} />
            ) : (
              <p className="py-8 text-center text-sm text-muted">{bins.loading ? "Loading bin data…" : "Enter a deposit amount."}</p>
            )}
          </Panel>
        )}
        {pool && binData && range && estimate?.source === "bins" && (
          <>
            <Panel title="Liquidity by bin">
              <Histogram
                data={binData}
                from={range.from}
                to={range.to}
                estimate={estimate}
                onRange={(from, to) => set({ range: { kind: "manual", from, to } })}
              />
            </Panel>
            <Panel title="Bin plan">
              <BinPlan pool={pool} data={binData} from={range.from} to={range.to} estimate={estimate} />
            </Panel>
          </>
        )}
        {pool && (
          <div className="lg:hidden">
            <RiskPanel pool={pool} />
          </div>
        )}
      </div>
    </div>
  );
}

function WindowHint({ days, period }: { days: number; period: Period }) {
  const nominal = period === "24h" ? 1 : period === "7d" ? 7 : 30;
  const short = days < nominal * 0.97;
  return (
    <span className={short ? "text-warn" : undefined} title={short ? "The pool is younger than the selected period." : undefined}>
      window {days < 2 ? `${(days * 24).toFixed(1)}h` : `${days.toFixed(1)}d`}
      {short && " (young pool)"}
    </span>
  );
}

const NOMINAL_DAYS: Record<Period, number> = { "24h": 1, "7d": 7, "30d": 30 };

function FeeSummary({
  estimate,
  days,
  pool,
  binData,
  period,
}: {
  estimate: Estimate;
  days: number;
  pool: Pool;
  binData: BinData | null;
  period: Period;
}) {
  const durations = [...new Set([...PRESET_DAYS, days])].sort((a, b) => a - b);
  const poolApr = bpsToFraction(pool.aprBps7d);
  // Pool fee subtitle follows the data actually used: the selected period's bins window, else analytics24h.
  let poolFeesSub: string | undefined;
  if (estimate.source === "bins" && binData) {
    const short = binData.windowDays < NOMINAL_DAYS[period] * 0.97;
    poolFeesSub = `${fmtUsd(poolWindowDailyFees(binData))} avg/day pool fees over ${short ? `${binData.windowDays.toFixed(1)}d (young pool)` : `the ${period} window`}`;
  } else {
    const p24 = poolDailyFees(pool);
    if (p24) poolFeesSub = `${fmtUsd(p24.dailyFees)}/day pool fees (24h)`;
  }
  const net = estimate.netApr;
  const netSub =
    estimate.netApr === null
      ? "no net data for this range"
      : `historical, can be negative${estimate.netSkippedBins > 0 ? ` · ${estimate.netSkippedBins} bin${estimate.netSkippedBins === 1 ? "" : "s"} without data` : ""}`;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Big label="Fees / day" value={fmtUsd(estimate.dailyFees)} />
        <Big label={`Fees · ${days}d`} value={fmtUsd(projectFees(estimate.dailyFees, estimate.deposit, days).simple)} />
        <Big label="Your est. APR" value={fmtApr(estimate.apr)} tone="text-accent" sub="fees only" />
        <Big label="Est. NET APR" value={fmtApr(net)} tone={net === null ? "text-muted" : net < 0 ? "text-bad" : "text-text"} sub={netSub} />
        <Big label="Pool 7d APR" value={fmtApr(poolApr)} sub={poolFeesSub} />
      </div>
      <div className="overflow-x-auto">
        <table className="num w-full text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
            <tr>
              <th className="py-1.5 font-medium">Duration</th>
              <th className="py-1.5 text-right font-medium">Fees (simple)</th>
              <th className="py-1.5 text-right font-medium">With auto-compounding</th>
              <th className="py-1.5 text-right font-medium">Net (historical)</th>
            </tr>
          </thead>
          <tbody>
            {durations.map((d) => {
              const p = projectFees(estimate.dailyFees, estimate.deposit, d);
              const n = estimate.netDaily === null ? null : estimate.netDaily * d;
              return (
                <tr key={d} className={`border-t border-line/60 ${d === days ? "text-text" : "text-muted"}`}>
                  <td className="py-1.5">
                    {d} days{d === days && !PRESET_DAYS.includes(d) && " (custom)"}
                  </td>
                  <td className="py-1.5 text-right">{fmtUsd(p.simple)}</td>
                  <td className="py-1.5 text-right">{fmtUsd(p.compounded)}</td>
                  <td className={`py-1.5 text-right ${n !== null && n < 0 ? "text-bad" : ""}`}>{n === null ? "—" : fmtUsd(n)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        Assumes the {estimate.source === "bins" ? "per-bin volume and liquidity of the data window" : "pool's recent fees, shared pro-rata with TVL"}{" "}
        continue unchanged and the price stays in your range. Fee figures exclude price moves; the net column replays each bin&apos;s historical
        trading PnL (fees + price moves) and is not compounded.
      </p>
    </div>
  );
}

function Big({ label, value, tone = "text-text", sub }: { label: string; value: string; tone?: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-panel-2 px-3 py-3">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`num mt-0.5 text-xl font-semibold sm:text-2xl ${tone}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

/** Number input that keeps its own text so partial edits ("1e", "") don't fight the parsed value. */
function useDraft(value: number) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (Number(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return [text, setText] as const;
}

function AmountInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useDraft(value);
  return (
    <Field label="Deposit (USD)">
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
        <input
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value);
            if (n > 0) onChange(n);
          }}
          className={`${inputCls} pl-7 text-base`}
        />
      </div>
    </Field>
  );
}

function DurationInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useDraft(value);
  const custom = !PRESET_DAYS.includes(value);
  return (
    <Field label="Duration">
      <div className="flex items-center gap-2">
        <Segmented<number | "custom">
          value={custom ? "custom" : value}
          onChange={(v) => onChange(v === "custom" ? (custom ? value : 14) : v)}
          options={[...PRESET_DAYS.map((d) => ({ value: d, label: `${d}d` })), { value: "custom" as const, label: "Custom" }]}
        />
        {custom && (
          <input
            type="number"
            min={1}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              const n = Math.round(Number(e.target.value));
              if (n > 0) onChange(Math.min(n, 3650));
            }}
            className={`${inputCls} w-20`}
            aria-label="Custom duration in days"
          />
        )}
      </div>
    </Field>
  );
}

function BinInput({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number) => void }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => setText(value === null ? "" : String(value)), [value]);
  const commit = () => {
    if (/^-?\d+$/.test(text.trim())) onChange(Number(text));
    else setText(value === null ? "" : String(value));
  };
  return (
    <label className="block">
      <span className="text-[11px] text-muted">{label}</span>
      <input
        value={text}
        inputMode="numeric"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        className={inputCls}
        placeholder="#"
      />
    </label>
  );
}
