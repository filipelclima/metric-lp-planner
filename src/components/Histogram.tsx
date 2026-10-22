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
import { binPoolApr, chartWindow, fmtApr, fmtBinPct, fmtUsd, getBin, tickStep, type BinData, type Estimate } from "@/lib/calc";
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
  active: "#e8ecf2",
  user: "#2dd4bf",
  grid: "#1a1f27",
  tick: "#5b6577",
  overlay: "#e8ecf2",
};

export default function Histogram({ data, from, to, estimate, onRange, hovered, onHover }: Props) {
  const reduced = useReducedMotion();
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [drag, setDrag] = useState<{ start: number; end: number } | null>(null);
  const [width, setWidth] = useState(800);
  // Bars grow from 0 once, on first render; later data changes update in place.
  const [grown, setGrown] = useState(!!reduced);

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
        netApr: b.pnlAprBps === null ? null : b.pnlAprBps / 1e4,
        dailyFees: b.dailyFees,
        lowPct: b.lowPct,
        midPct: b.midPct,
        highPct: b.highPct,
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
  const animateBars = !grown;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-faint">Liquidity by bin</span>
          <InfoTip side="bottom">
            Pool liquidity per bin, your range highlighted and your liquidity stacked on top. Drag across the chart to pick a range. The white bar is
            the active bin; the dashed line marks the oracle price (0%).
          </InfoTip>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-3 text-[11px] text-muted sm:flex">
            <Legend color={C.bar} label="Pool" />
            <Legend color={C.range} label="Your range" opacity={0.4} />
            <Legend color={C.user} label="You" />
          </div>
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
      <div className="h-56 w-full cursor-crosshair xl:h-60">
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
            <CartesianGrid vertical={false} stroke={C.grid} />
            <XAxis
              dataKey="idx"
              interval={0}
              tick={{ fill: C.tick, fontSize: 10, fontFamily: "var(--font-mono)" }}
              tickFormatter={(v: number) => (v % step === 0 ? String(v) : "")}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              yAxisId="liq"
              tick={{ fill: C.tick, fontSize: 10, fontFamily: "var(--font-mono)" }}
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={(v) => fmtUsd(v, { compact: true }).replace(".00", "")}
            />
            {overlay !== "none" && (
              <YAxis
                yAxisId="ov"
                orientation="right"
                tick={{ fill: C.tick, fontSize: 10, fontFamily: "var(--font-mono)" }}
                tickLine={false}
                axisLine={false}
                width={48}
                tickFormatter={(v) => (overlay === "apr" ? `${Math.round(v)}%` : fmtUsd(v, { compact: true }).replace(".00", ""))}
              />
            )}
            <Customized component={<RangeOverlay a={sel.a} b={sel.b} reduced={!!reduced} />} />
            <Tooltip cursor={false} content={<Tip curBinIdx={data.curBinIdx} />} isAnimationActive={false} />
            <Bar
              yAxisId="liq"
              dataKey="pool"
              stackId="s"
              isAnimationActive={animateBars}
              animationDuration={700}
              animationEasing="ease-out"
              onAnimationEnd={() => setGrown(true)}
            >
              {rows.map((r) => {
                const hot = r.idx === hovered;
                const fill = r.idx === data.curBinIdx ? C.active : r.inRange ? C.range : hot ? C.barHover : C.bar;
                return <Cell key={r.idx} fill={fill} fillOpacity={r.idx === data.curBinIdx ? 0.9 : r.inRange ? (hot ? 0.7 : 0.38) : 1} />;
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
                label={{ value: "oracle 0%", position: "top", offset: 6, fill: "#8a94a6", fontSize: 10 }}
              />
            )}
            {hasActive && (
              <ReferenceLine
                yAxisId="liq"
                x={data.curBinIdx}
                stroke="transparent"
                label={{ value: `active #${data.curBinIdx}`, position: "top", offset: 20, fill: C.active, fontSize: 10 }}
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
      rx={4}
      fill="#2dd4bf"
      fillOpacity={0.06}
      stroke="#2dd4bf"
      strokeOpacity={0.25}
      initial={false}
      animate={{ x, width }}
      transition={props.reduced ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 32 }}
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
        {r.idx === curBinIdx && <span className="rounded bg-text/10 px-1.5 py-0.5 text-[10px] text-text">active</span>}
        {r.inRange && r.idx !== curBinIdx && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">in range</span>}
      </div>
      <div className="num mb-2 grid grid-cols-3 gap-2 text-[10px] text-muted">
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
