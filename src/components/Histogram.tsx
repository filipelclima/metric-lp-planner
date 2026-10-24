"use client";
import { motion, useReducedMotion } from "framer-motion";
import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Customized,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { binPoolApr, fmtApr, fmtBinPct, fmtUsd, getBin, tickStep, type BinData, type Estimate } from "@/lib/calc";
import { activeWindow } from "@/lib/ruler";
import { InfoTip, Segmented } from "./ui";

type Overlay = "none" | "volume" | "apr";

interface Props {
  data: BinData;
  from: number;
  to: number;
  estimate: Estimate;
  onRange: (from: number, to: number) => void;
  hovered: number | null;
  onHover: (idx: number | null) => void;
}

interface Row {
  idx: number;
  pool: number;
  user: number;
  inRange: boolean;
  volume: number;
  apr: number;
  netApr: number | null;
  dailyFees: number;
  lowPct: number;
  midPct: number;
  highPct: number;
}

const C = {
  bar: "#2a313d",
  barHover: "#3d4655",
  range: "#2dd4bf",
  active: "#c3cbd8",
  user: "#2dd4bf",
  grid: "#1a1f27",
  tick: "#848fa2",
  overlay: "#e8ecf2",
};

export default function Histogram({ data, from, to, estimate, onRange, hovered, onHover }: Props) {
  const reduced = useReducedMotion();
  const [overlay, setOverlay] = useState<Overlay>("none");
  // Zoomed to bins with liquidity or volume (+2) by default; "Show all bins" shows every bin the pool returned.
  const [showAll, setShowAll] = useState(false);
  const [drag, setDrag] = useState<{ start: number; end: number } | null>(null);
  const [width, setWidth] = useState(800);
  // Bars grow from 0 once, on first render; later data changes update in place.
  const [grown, setGrown] = useState(!!reduced);

  const rows = useMemo<Row[]>(() => {
    const zoom = activeWindow(data, { from, to });
    const lo = showAll ? Math.min(data.minIdx, zoom.lo) : zoom.lo;
    const hi = showAll ? Math.max(data.maxIdx, zoom.hi) : zoom.hi;
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
        netApr: b.pnlAprBps === null ? null : b.pnlAprBps / 1e4,
        dailyFees: b.dailyFees,
        lowPct: b.lowPct,
        midPct: b.midPct,
        highPct: b.highPct,
      });
    }
    return out;
  }, [data, from, to, estimate.positions, showAll]);

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
  const animateBars = !grown;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-[0.08em] text-faint">Liquidity by bin</span>
          <InfoTip side="bottom">
            Pool liquidity per bin, your range highlighted and your liquidity stacked on top. Drag across the chart to pick a range. The light bar
            outlined in teal is the active bin; the dashed line marks the oracle price (0%). Zoomed to bins that hold liquidity or traded, plus 2.
          </InfoTip>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-3 text-xs text-muted sm:flex">
            <Legend color={C.bar} label="Pool" />
            <Legend color={C.range} label="Your range" opacity={0.4} />
            <Legend color={C.user} label="You" />
          </div>
          <button
            type="button"
            aria-pressed={showAll}
            onClick={() => setShowAll((v) => !v)}
            className={`rounded-lg px-2.5 py-1 text-xs transition ${showAll ? "bg-surface-3 text-accent" : "bg-surface-2 text-muted hover:text-text"}`}
          >
            {showAll ? "Zoom to active bins" : "Show all bins"}
          </button>
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
      {/* Leaving the chart (mouse or touch) always clears the hover, so the tooltip can't get stuck. */}
      <div
        className="h-56 w-full cursor-crosshair xl:h-60"
        onPointerLeave={() => onHover(null)}
        onTouchEnd={() => onHover(null)}
        onTouchCancel={() => onHover(null)}
      >
        <ResponsiveContainer onResize={(w) => w > 0 && setWidth(w)}>
          <ComposedChart
            data={rows}
            margin={{ top: 34, right: 4, bottom: 0, left: 4 }}
            barCategoryGap={1}
            onMouseDown={(e) => {
              const i = labelOf(e);
              if (i !== null) setDrag({ start: i, end: i });
            }}
            onMouseMove={(e) => {
              const i = labelOf(e);
              if (i !== hovered) onHover(i);
              if (drag && i !== null && i !== drag.end) setDrag({ ...drag, end: i });
            }}
            onMouseUp={() => {
              if (drag) onRange(Math.min(drag.start, drag.end), Math.max(drag.start, drag.end));
              setDrag(null);
            }}
            onMouseLeave={() => {
              setDrag(null);
              onHover(null);
            }}
          >
            <defs>
              <linearGradient id="hg-pool" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#3a4453" />
                <stop offset="1" stopColor="#252c37" />
              </linearGradient>
              <linearGradient id="hg-pool-hot" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#4c5768" />
                <stop offset="1" stopColor="#323b48" />
              </linearGradient>
              <linearGradient id="hg-range" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#2dd4bf" stopOpacity="0.62" />
                <stop offset="1" stopColor="#2dd4bf" stopOpacity="0.28" />
              </linearGradient>
              <linearGradient id="hg-range-hot" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#2dd4bf" stopOpacity="0.85" />
                <stop offset="1" stopColor="#2dd4bf" stopOpacity="0.45" />
              </linearGradient>
              <linearGradient id="hg-active" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#d5dce6" />
                <stop offset="1" stopColor="#9aa4b4" />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={C.grid} />
            <XAxis
              dataKey="idx"
              interval={0}
              tick={{ fill: C.tick, fontSize: 12, fontFamily: "var(--font-mono)" }}
              tickFormatter={(v: number) => (v % step === 0 ? String(v) : "")}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              yAxisId="liq"
              tick={{ fill: C.tick, fontSize: 12, fontFamily: "var(--font-mono)" }}
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={(v) => fmtUsd(v, { compact: true }).replace(".00", "")}
            />
            {overlay !== "none" && (
              <YAxis
                yAxisId="ov"
                orientation="right"
                tick={{ fill: C.tick, fontSize: 12, fontFamily: "var(--font-mono)" }}
                tickLine={false}
                axisLine={false}
                width={48}
                tickFormatter={(v) => (overlay === "apr" ? `${Math.round(v)}%` : fmtUsd(v, { compact: true }).replace(".00", ""))}
              />
            )}
            <Customized component={<RangeOverlay a={sel.a} b={sel.b} reduced={!!reduced} />} />
            <Tooltip cursor={false} active={hovered === null ? false : undefined} content={<Tip curBinIdx={data.curBinIdx} />} isAnimationActive={false} />
            <Bar
              yAxisId="liq"
              dataKey="pool"
              stackId="s"
              radius={[3, 3, 0, 0]}
              isAnimationActive={animateBars}
              animationDuration={700}
              animationEasing="ease-out"
              onAnimationEnd={() => setGrown(true)}
            >
              {rows.map((r) => {
                const hot = r.idx === hovered;
                const active = r.idx === data.curBinIdx;
                const fill = active ? "url(#hg-active)" : r.inRange ? (hot ? "url(#hg-range-hot)" : "url(#hg-range)") : hot ? "url(#hg-pool-hot)" : "url(#hg-pool)";
                return <Cell key={r.idx} fill={fill} fillOpacity={active ? 0.85 : 1} stroke={active ? C.range : undefined} strokeWidth={active ? 1.5 : 0} />;
              })}
            </Bar>
            <Bar
              yAxisId="liq"
              dataKey="user"
              stackId="s"
              fill={C.user}
              radius={[2, 2, 0, 0]}
              isAnimationActive={animateBars}
              animationDuration={700}
              animationEasing="ease-out"
            />
            {overlay !== "none" && (
              <Line yAxisId="ov" type="monotone" dataKey={overlay} stroke={C.overlay} strokeOpacity={0.7} strokeWidth={1.25} dot={false} isAnimationActive={false} />
            )}
            {hasOracle && (
              <ReferenceLine
                yAxisId="liq"
                x={0}
                position="start"
                stroke={C.active}
                strokeOpacity={0.6}
                strokeDasharray="3 3"
                label={{ value: "oracle 0%", position: "top", offset: 6, fill: "#a6b0c0", fontSize: 12 }}
              />
            )}
            {hasActive && (
              <ReferenceLine
                yAxisId="liq"
                x={data.curBinIdx}
                stroke="transparent"
                label={{ value: `active #${data.curBinIdx}`, position: "top", offset: 20, fill: C.active, fontSize: 12 }}
              />
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

/** Selected-range overlay drawn from the chart's own x scale so it can animate between ranges. */
function RangeOverlay(props: {
  a: number;
  b: number;
  reduced: boolean;
  xAxisMap?: Record<string, AxisLike>;
  offset?: { top: number; height: number; left: number; width: number };
}) {
  const axis = props.xAxisMap && Object.values(props.xAxisMap)[0];
  if (!axis || !props.offset) return null;
  const bw = axis.scale.bandwidth?.() ?? 0;
  const left = props.offset.left;
  const right = left + props.offset.width;
  const xa = axis.scale(props.a);
  const xb = axis.scale(props.b);
  // Range edges outside the visible window clamp to the plot area.
  const x0 = Number.isFinite(xa) ? xa : props.a < 0 ? left : right;
  const x1 = Number.isFinite(xb) ? xb + bw : props.b < 0 ? left : right;
  const x = Math.max(left, Math.min(x0, x1));
  const width = Math.max(0, Math.min(right, Math.max(x0, x1)) - x);
  return (
    <motion.rect
      y={props.offset.top}
      height={props.offset.height}
      rx={6}
      fill="#2dd4bf"
      fillOpacity={0.05}
      stroke="#2dd4bf"
      strokeOpacity={0.3}
      initial={false}
      animate={{ x, width }}
      transition={props.reduced ? { duration: 0 } : { type: "spring", stiffness: 170, damping: 26, mass: 0.9 }}
    />
  );
}

function Legend({ color, label, opacity = 1 }: { color: string; label: string; opacity?: number }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-sm" style={{ background: color, opacity }} />
      {label}
    </span>
  );
}

function Tip({ active, payload, curBinIdx }: { active?: boolean; payload?: { payload: Row }[]; curBinIdx: number }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="min-w-52 rounded-xl bg-surface-3/95 px-3.5 py-3 text-xs shadow-2xl shadow-black/50 backdrop-blur">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="num text-sm font-medium">#{r.idx}</span>
        {r.idx === curBinIdx && <span className="rounded bg-text/10 px-1.5 py-0.5 text-xs text-text">active</span>}
        {r.inRange && r.idx !== curBinIdx && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-xs text-accent">in range</span>}
      </div>
      <div className="num mb-2 grid grid-cols-3 gap-2 text-xs text-muted">
        <span>
          <span className="block font-sans text-faint">low</span>
          {fmtBinPct(r.lowPct, 4)}
        </span>
        <span>
          <span className="block font-sans text-faint">mid</span>
          <span className="text-text">{fmtBinPct(r.midPct, 4)}</span>
        </span>
        <span>
          <span className="block font-sans text-faint">high</span>
          {fmtBinPct(r.highPct, 4)}
        </span>
      </div>
      <div className="num grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
        <span className="font-sans text-faint">Pool liquidity</span>
        <span className="text-right">{fmtUsd(r.pool)}</span>
        {r.user > 0 && (
          <>
            <span className="font-sans text-faint">Your liquidity</span>
            <span className="text-right text-accent">{fmtUsd(r.user)}</span>
          </>
        )}
        <span className="font-sans text-faint">Fees / day</span>
        <span className="text-right">{fmtUsd(r.dailyFees)}</span>
        <span className="font-sans text-faint">Bin APR</span>
        <span className="text-right text-accent">{fmtApr(r.apr / 100)}</span>
        <span className="font-sans text-faint">Net APR</span>
        <span className={`text-right ${r.netApr === null ? "text-faint" : r.netApr < 0 ? "text-bad" : "text-good"}`}>{fmtApr(r.netApr)}</span>
      </div>
    </div>
  );
}
