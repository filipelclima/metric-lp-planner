"use client";
import { motion, useReducedMotion } from "framer-motion";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Customized, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartWindow, fmtApr, fmtBinPct, fmtUsd, getBin, tickStep, type BinData } from "@/lib/calc";

export const SCENARIO_COLORS = ["#2dd4bf", "#a78bfa", "#fbbf24"] as const;

export interface Overlay {
  label: string;
  from: number;
  to: number;
  color: string;
}

/** Base pool liquidity per bin with each scenario's range as a colored overlay; the hovered one stands out. */
export function OverlayHistogram({ data, overlays, hovered, onHover }: { data: BinData; overlays: Overlay[]; hovered: number | null; onHover: (i: number | null) => void }) {
  const [width, setWidth] = useState(800);
  const rows = useMemo(() => {
    if (overlays.length === 0) return [];
    const { lo, hi } = chartWindow(data, Math.min(...overlays.map((o) => o.from)), Math.max(...overlays.map((o) => o.to)));
    const out = [];
    for (let i = lo; i <= hi; i++) {
      const b = getBin(data, i);
      out.push({ idx: i, liq: b.liquidity, mid: b.midPct, vol: b.volumeFiat });
    }
    return out;
  }, [data, overlays]);
  const step = tickStep(rows.length, (width - 60) / 30);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-muted">
        {overlays.map((o, i) => (
          <button
            key={o.label}
            onMouseEnter={() => onHover(i)}
            onMouseLeave={() => onHover(null)}
            className={`flex items-center gap-1.5 rounded px-1 transition ${hovered === i ? "text-text" : ""}`}
          >
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: o.color }} />
            {o.label} · #{o.from} → #{o.to}
          </button>
        ))}
      </div>
      <div className="h-56">
        <ResponsiveContainer onResize={(w) => w > 0 && setWidth(w)}>
          <ComposedChart data={rows} margin={{ top: 46, right: 4, bottom: 0, left: 4 }} barCategoryGap={1}>
            <CartesianGrid vertical={false} stroke="#1a1f27" />
            <XAxis
              dataKey="idx"
              interval={0}
              tick={{ fill: "#848fa2", fontSize: 12, fontFamily: "var(--font-mono)" }}
              tickFormatter={(v: number) => (v % step === 0 ? String(v) : "")}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fill: "#848fa2", fontSize: 12, fontFamily: "var(--font-mono)" }}
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={(v) => fmtUsd(v, { compact: true }).replace(".00", "")}
            />
            <Customized component={<Overlays overlays={overlays} hovered={hovered} />} />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const r = payload[0].payload as (typeof rows)[number];
                const inside = overlays.filter((o) => r.idx >= o.from && r.idx <= o.to).map((o) => o.label);
                return (
                  <div className="num rounded-lg bg-surface-3 px-3 py-2 text-xs shadow-xl shadow-black/40">
                    <div className="mb-1 font-medium text-text">
                      #{r.idx} <span className="text-faint">{fmtBinPct(r.mid, 4)}</span>
                    </div>
                    <div className="text-muted">liquidity {fmtUsd(r.liq)}</div>
                    <div className="text-muted">volume {fmtUsd(r.vol)}</div>
                    {inside.length > 0 && <div className="mt-1 font-sans text-faint">in {inside.join(", ")}</div>}
                  </div>
                );
              }}
            />
            <Bar dataKey="liq" isAnimationActive={false}>
              {rows.map((r) => (
                <Cell key={r.idx} fill={r.idx === data.curBinIdx ? "#e8ecf2" : "#2a313d"} />
              ))}
            </Bar>
            {rows.some((r) => r.idx === data.curBinIdx) && (
              <ReferenceLine x={data.curBinIdx} stroke="transparent" label={{ value: `active #${data.curBinIdx}`, position: "top", offset: 32, fill: "#e8ecf2", fontSize: 12 }} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

interface AxisLike {
  scale: ((v: number) => number) & { bandwidth?: () => number };
}

/** Range bands over the bars plus one thin lane per scenario above the plot, so nested ranges stay readable. */
function Overlays(props: { overlays: Overlay[]; hovered: number | null; xAxisMap?: Record<string, AxisLike>; offset?: { top: number; height: number; left: number; width: number } }) {
  const reduced = useReducedMotion();
  const axis = props.xAxisMap && Object.values(props.xAxisMap)[0];
  if (!axis || !props.offset) return null;
  const { left, width, top, height } = props.offset;
  const bw = axis.scale.bandwidth?.() ?? 0;
  const edge = (v: number, start: boolean) => {
    const x = axis.scale(v);
    if (Number.isFinite(x)) return start ? x : x + bw;
    return v < 0 ? left : left + width;
  };
  return (
    <g>
      {props.overlays.map((o, i) => {
        const x0 = Math.max(left, edge(o.from, true));
        const x1 = Math.min(left + width, edge(o.to, false));
        const hot = props.hovered === i;
        const dim = props.hovered !== null && !hot;
        const laneH = 5;
        return (
          <g key={o.label}>
            <motion.rect
              initial={false}
              animate={{ x: x0, width: Math.max(0, x1 - x0), opacity: dim ? 0.25 : 1 }}
              transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 32 }}
              y={top}
              height={height}
              fill={o.color}
              fillOpacity={hot ? 0.16 : 0.06}
              stroke={o.color}
              strokeOpacity={hot ? 0.9 : 0.35}
              rx={3}
            />
            <motion.rect
              initial={false}
              animate={{ x: x0, width: Math.max(0, x1 - x0), opacity: dim ? 0.3 : 1 }}
              transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 32 }}
              y={top - 6 - (props.overlays.length - i) * (laneH + 2)}
              height={laneH}
              fill={o.color}
              rx={2}
            />
          </g>
        );
      })}
    </g>
  );
}

/** Fee APR vs net APR per scenario (grouped bars); net bars green/red. */
export function AprBars({ items, hovered, onHover }: { items: { label: string; feeApr: number; netApr: number | null; color: string }[]; hovered: number | null; onHover: (i: number | null) => void }) {
  const data = items.map((it) => ({ label: it.label, fee: it.feeApr * 100, net: it.netApr === null ? 0 : it.netApr * 100, hasNet: it.netApr !== null, color: it.color }));
  return (
    <div className="h-56">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={4} onMouseLeave={() => onHover(null)}>
          <CartesianGrid vertical={false} stroke="#1a1f27" />
          <XAxis dataKey="label" tick={{ fill: "#a6b0c0", fontSize: 12 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fill: "#848fa2", fontSize: 12, fontFamily: "var(--font-mono)" }} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => `${Math.round(v)}%`} />
          <ReferenceLine y={0} stroke="#848fa2" strokeOpacity={0.6} />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const r = payload[0].payload as (typeof data)[number];
              return (
                <div className="num rounded-lg bg-surface-3 px-3 py-2 text-xs shadow-xl shadow-black/40">
                  <div className="mb-1 font-sans font-medium">Scenario {r.label}</div>
                  <div className="text-accent">fee {fmtApr(r.fee / 100)}</div>
                  <div className={r.hasNet ? (r.net < 0 ? "text-bad" : "text-good") : "text-faint"}>net {r.hasNet ? fmtApr(r.net / 100) : "—"}</div>
                </div>
              );
            }}
          />
          <Bar dataKey="fee" radius={[3, 3, 0, 0]} isAnimationActive={false} onMouseEnter={(_, i) => onHover(i)}>
            {data.map((d, i) => (
              <Cell key={d.label} fill={d.color} fillOpacity={hovered === null || hovered === i ? 0.9 : 0.35} />
            ))}
          </Bar>
          <Bar dataKey="net" radius={[3, 3, 0, 0]} isAnimationActive={false} onMouseEnter={(_, i) => onHover(i)}>
            {data.map((d, i) => (
              <Cell key={d.label} fill={d.net < 0 ? "#f87171" : "#4ade80"} fillOpacity={hovered === null || hovered === i ? 0.85 : 0.3} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
