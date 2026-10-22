"use client";
import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { binPoolApr, chartWindow, tickStep, fmtApr, fmtBinPct, fmtUsd, getBin, type BinData, type Estimate } from "@/lib/calc";
import { Segmented } from "./ui";

type Overlay = "none" | "volume" | "apr";

interface Props {
  data: BinData;
  from: number;
  to: number;
  estimate: Estimate;
  onRange: (from: number, to: number) => void;
}

interface Row {
  idx: number;
  pool: number;
  user: number;
  inRange: boolean;
  volume: number;
  apr: number;
  label: string;
}

export default function Histogram({ data, from, to, estimate, onRange }: Props) {
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [drag, setDrag] = useState<{ start: number; end: number } | null>(null);
  const [width, setWidth] = useState(800);

  const rows = useMemo<Row[]>(() => {
    const { lo, hi } = chartWindow(data, from, to);
    const userByIdx = new Map(estimate.positions.map((p) => [p.bin.idx, p.usd]));
    const out: Row[] = [];
    for (let i = lo; i <= hi; i++) {
      const b = getBin(data, i);
      out.push({
        idx: i,
        pool: b.liquidity,
        user: userByIdx.get(i) ?? 0,
        inRange: i >= from && i <= to,
        volume: b.volumeFiat,
        apr: (b.aprBps !== null ? b.aprBps / 1e4 : binPoolApr(b)) * 100,
        label: `${fmtBinPct(b.lowPct, 4)} … ${fmtBinPct(b.highPct, 4)}`,
      });
    }
    return out;
  }, [data, from, to, estimate.positions]);

  // Label every bin when it fits, otherwise every step-th bin (multiples of the step, so 0 is always labelled).
  const step = tickStep(rows.length, (width - 60) / 30);

  const sel = drag ? { a: Math.min(drag.start, drag.end), b: Math.max(drag.start, drag.end) } : { a: from, b: to };
  const hasOracle = rows.some((r) => r.idx === 0);
  const hasActive = rows.some((r) => r.idx === data.curBinIdx);

  // Recharts hands us the hovered category (the bin idx) in activeLabel.
  const labelOf = (e: unknown) => {
    const v = (e as { activeLabel?: string | number } | null)?.activeLabel;
    return v === undefined || v === null || v === "" ? null : Number(v);
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          <Legend color="#3b475e" label="Pool liquidity" />
          <Legend color="#6ee7c5" label="In your range" />
          <Legend color="#a78bfa" label="Your liquidity" />
          {overlay !== "none" && <Legend color="#facc15" label={overlay === "volume" ? "Volume" : "Bin APR"} line />}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          Overlay
          <Segmented
            size="sm"
            value={overlay}
            onChange={setOverlay}
            options={[
              { value: "none", label: "None" },
              { value: "volume", label: "Volume" },
              { value: "apr", label: "APR" },
            ]}
          />
        </div>
      </div>
      <div className="h-72 w-full cursor-crosshair">
        <ResponsiveContainer onResize={(w) => w > 0 && setWidth(w)}>
          <ComposedChart
            data={rows}
            margin={{ top: 40, right: 4, bottom: 0, left: 4 }}
            barCategoryGap={1}
            onMouseDown={(e) => {
              const i = labelOf(e);
              if (i !== null) setDrag({ start: i, end: i });
            }}
            onMouseMove={(e) => {
              const i = labelOf(e);
              if (drag && i !== null && i !== drag.end) setDrag({ ...drag, end: i });
            }}
            onMouseUp={() => {
              if (drag) onRange(Math.min(drag.start, drag.end), Math.max(drag.start, drag.end));
              setDrag(null);
            }}
            onMouseLeave={() => setDrag(null)}
          >
            <CartesianGrid vertical={false} stroke="#1c2433" />
            <XAxis
              dataKey="idx"
              interval={0}
              tick={{ fill: "#8592a8", fontSize: 11 }}
              tickFormatter={(v: number) => (v % step === 0 ? String(v) : "")}
              tickLine={false}
              axisLine={{ stroke: "#222b3b" }}
            />
            <YAxis
              yAxisId="liq"
              tick={{ fill: "#8592a8", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={56}
              tickFormatter={(v) => fmtUsd(v, { compact: true }).replace(".00", "")}
            />
            {overlay !== "none" && (
              <YAxis
                yAxisId="ov"
                orientation="right"
                tick={{ fill: "#facc15", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={52}
                tickFormatter={(v) => (overlay === "apr" ? `${Math.round(v)}%` : fmtUsd(v, { compact: true }).replace(".00", ""))}
              />
            )}
            <ReferenceArea yAxisId="liq" x1={sel.a} x2={sel.b} fill="#6ee7c5" fillOpacity={0.06} stroke="#6ee7c5" strokeOpacity={0.25} ifOverflow="hidden" />
            <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<Tip curBinIdx={data.curBinIdx} />} />
            <Bar yAxisId="liq" dataKey="pool" stackId="s" isAnimationActive={false}>
              {rows.map((r) => (
                <Cell key={r.idx} fill={r.idx === data.curBinIdx ? "#e6ebf3" : r.inRange ? "#6ee7c5" : "#3b475e"} fillOpacity={r.inRange ? 0.75 : 1} />
              ))}
            </Bar>
            <Bar yAxisId="liq" dataKey="user" stackId="s" fill="#a78bfa" radius={[2, 2, 0, 0]} isAnimationActive={false} />
            {overlay !== "none" && (
              <Line yAxisId="ov" type="monotone" dataKey={overlay} stroke="#facc15" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            )}
            {hasOracle && (
              <ReferenceLine
                yAxisId="liq"
                x={0}
                position="start"
                stroke="#e6ebf3"
                strokeDasharray="3 3"
                label={{ value: "oracle 0%", position: "top", offset: 6, fill: "#e6ebf3", fontSize: 11 }}
              />
            )}
            {hasActive && data.curBinIdx !== 0 && (
              <ReferenceLine
                yAxisId="liq"
                x={data.curBinIdx}
                stroke="#facc15"
                strokeOpacity={0.6}
                label={{ value: `active #${data.curBinIdx}`, position: "top", offset: 22, fill: "#facc15", fontSize: 11 }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-xs text-muted">Drag across the chart to pick a range. White bar = active bin.</p>
    </div>
  );
}

function Legend({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={line ? "h-0.5 w-3" : "h-2.5 w-2.5 rounded-sm"} style={{ background: color }} />
      {label}
    </span>
  );
}

function Tip({ active, payload, curBinIdx }: { active?: boolean; payload?: { payload: Row }[]; curBinIdx: number }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="rounded-lg border border-line bg-panel/95 px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-medium">
        Bin #{r.idx}
        {r.idx === curBinIdx && <span className="ml-1 text-warn">(active)</span>}
      </div>
      <div className="num text-muted">{r.label}</div>
      <div className="num mt-1 grid grid-cols-[auto_auto] gap-x-3">
        <span className="text-muted">Pool liquidity</span>
        <span className="text-right">{fmtUsd(r.pool)}</span>
        {r.user > 0 && (
          <>
            <span className="text-muted">Your liquidity</span>
            <span className="text-right text-accent-2">{fmtUsd(r.user)}</span>
          </>
        )}
        <span className="text-muted">Volume</span>
        <span className="text-right">{fmtUsd(r.volume)}</span>
        <span className="text-muted">Bin APR</span>
        <span className="text-right">{fmtApr(r.apr / 100)}</span>
      </div>
    </div>
  );
}
