"use client";
import { useEffect, useState } from "react";
import type { PlannerModel } from "@/lib/usePlanner";
import type { Period, Strategy } from "@/lib/types";
import PoolPicker from "./PoolPicker";
import { Collapsible, ErrorNote, Field, InfoTip, Segmented, inputCls } from "./ui";

const PRESET_DAYS = [30, 60, 90];
const NOMINAL_DAYS: Record<Period, number> = { "24h": 1, "7d": 7, "30d": 30 };

export default function ConfigPanel({ m }: { m: PlannerModel }) {
  const { s, set, list, meta, pool, range, curBinIdx, binData } = m;
  const [advanced, setAdvanced] = useState(false);

  return (
    <div className="space-y-5">
      <Field label="Pool">
        <PoolPicker list={list} selected={pool} onSelect={m.selectPool} hasSelection={!!s.pool} />
        {meta.error && !pool && (
          <div className="mt-2">
            <ErrorNote message={meta.error} retryAfter={meta.retryAfter} onRetry={meta.retry} />
          </div>
        )}
      </Field>

      <AmountInput value={s.amount} onChange={(amount) => set({ amount })} />
      <DurationInput value={s.days} onChange={(days) => set({ days })} />

      <Field
        label="Range"
        hint={
          <span className="flex items-center gap-1.5">
            {s.range.kind === "preset" ? `${s.range.share}% of volume` : "Manual"}
            <InfoTip side="bottom">
              Presets pick the smallest contiguous bin range around the active bin that covered that share of the data period&apos;s volume. Drag on
              the chart or type bins for a manual range.
            </InfoTip>
          </span>
        }
      >
        <Segmented
          full
          value={s.range.kind === "preset" ? s.range.share : "manual"}
          onChange={(v) =>
            v === "manual"
              ? set({ range: { kind: "manual", from: range?.from ?? curBinIdx - 5, to: range?.to ?? curBinIdx + 5 } })
              : set({ range: { kind: "preset", share: v } })
          }
          options={[
            { value: 80 as const, label: "80%" },
            { value: 90 as const, label: "90%" },
            { value: 95 as const, label: "95%" },
            { value: "manual" as const, label: "Manual" },
          ]}
        />
        <div className="grid grid-cols-2 gap-2 pt-1">
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

      <div className="rounded-xl bg-surface-2/50 px-3 py-2.5">
        <Collapsible
          title="Advanced"
          open={advanced}
          onToggle={() => setAdvanced((a) => !a)}
          right={
            !advanced && (
              <span className="text-[11px] text-muted">
                {STRATEGY_LABEL[s.strategy]} · {s.period}
              </span>
            )
          }
        >
          <div className="space-y-4">
            <Field
              label="Distribution"
              hint={
                <InfoTip side="bottom">
                  Uniform: equal USD per bin. Curve: weighted toward the active bin. Fee-weighted: proportional to each bin&apos;s daily fees ÷
                  liquidity.
                </InfoTip>
              }
            >
              <Segmented<Strategy>
                full
                value={s.strategy}
                onChange={(strategy) => set({ strategy })}
                options={[
                  { value: "uniform", label: "Uniform" },
                  { value: "curve", label: "Curve" },
                  { value: "fee", label: "Fee-weighted" },
                ]}
              />
            </Field>
            <Field label="Data period" hint={binData && <WindowHint days={binData.windowDays} period={s.period} />}>
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
          </div>
        </Collapsible>
      </div>
    </div>
  );
}

const STRATEGY_LABEL: Record<Strategy, string> = { uniform: "Uniform", curve: "Curve", fee: "Fee-weighted" };

function WindowHint({ days, period }: { days: number; period: Period }) {
  const short = days < NOMINAL_DAYS[period] * 0.97;
  return (
    <span className={short ? "text-warn" : undefined} title={short ? "The pool is younger than the selected period." : undefined}>
      window {days < 2 ? `${(days * 24).toFixed(1)}h` : `${days.toFixed(1)}d`}
      {short && " · young pool"}
    </span>
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
    <Field label="Deposit">
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint">$</span>
        <input
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          aria-label="Deposit in USD"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value);
            if (n > 0) onChange(n);
          }}
          className={`${inputCls} py-2.5 pl-7 text-base`}
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
          full
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
            className={`${inputCls} w-20 shrink-0`}
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
      <span className="mb-1 block text-[11px] text-faint">{label}</span>
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
