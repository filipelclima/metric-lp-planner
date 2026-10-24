"use client";
import { useEffect, useRef, useState } from "react";
import { binPoolApr, fmtApr, fmtPlanPct, fmtUsd, getBin, tickStep, type BinData } from "@/lib/calc";
import { dragRange, idxFromX, keyRange, resizeRange, rulerWindow, volumeIntensity, type Range } from "@/lib/ruler";
import type { Period } from "@/lib/types";

type Gesture = { kind: "select"; anchor: number } | { kind: "resize"; edge: "from" | "to" };

/**
 * Interactive bin ruler. Click a bin for a 1-bin range, click-and-drag (mouse or touch) to select, drag an edge
 * handle to resize; ←/→ move the selection, Shift+←/→ resize it. Changes go straight to the planner's range, so
 * the Start/End inputs follow live. Bins are tinted by their share of the window's volume.
 */
export default function BinRuler({ data, from, to, period, onRange }: { data: BinData; from: number; to: number; period: Period; onRange: (r: Range) => void }) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  // Freeze the visible window while dragging, so bins don't slide under the pointer.
  const [frozen, setFrozen] = useState<{ lo: number; hi: number } | null>(null);
  const win = frozen ?? rulerWindow(data, { from, to });
  const { lo, hi } = win;
  const n = hi - lo + 1;
  const tint = volumeIntensity(data, lo, hi);
  const cur = data.curBinIdx;
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const labelStep = tickStep(n, width / 26);
  const bounds = { min: data.minIdx, max: data.maxIdx };

  const idxAt = (clientX: number) => {
    const el = stripRef.current;
    if (!el) return lo;
    const r = el.getBoundingClientRect();
    return idxFromX(clientX - r.left, r.width, lo, hi);
  };
  const set = (r: Range) => {
    if (r.from !== from || r.to !== to) onRange(r);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const edge = (e.target as HTMLElement).dataset.edge as "from" | "to" | undefined;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already released (e.g. a very quick tap): the gesture still works without capture */
    }
    setFrozen(win);
    if (edge) setGesture({ kind: "resize", edge });
    else {
      const i = idxAt(e.clientX);
      setGesture({ kind: "select", anchor: i });
      set({ from: i, to: i });
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const i = idxAt(e.clientX);
    setHover(i);
    if (!gesture) return;
    set(gesture.kind === "select" ? dragRange(gesture.anchor, i) : resizeRange({ from, to }, gesture.edge, i));
  };
  const end = () => {
    setGesture(null);
    setFrozen(null);
  };

  const pct = (i: number) => `${((i - lo) / n) * 100}%`;
  const hb = hover !== null ? getBin(data, hover) : null;
  const hbApr = hb ? (hb.aprBps !== null ? hb.aprBps / 1e4 : binPoolApr(hb)) : null;

  return (
    <div className="select-none">
      <div
        className="relative rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        tabIndex={0}
        role="group"
        aria-label={`Bin range #${from} to #${to}, active bin #${cur}. Click or drag to select bins; arrow keys move the range, Shift plus arrows resize it.`}
        onKeyDown={(e) => {
          const r = keyRange({ from, to }, e.key, e.shiftKey, bounds);
          if (r) {
            e.preventDefault();
            set(r);
          }
        }}
      >
        {/* Tooltip */}
        {hb && hover !== null && !gesture && (
          <div
            className="pointer-events-none absolute bottom-full z-10 mb-2 w-56 -translate-x-1/2 rounded-xl bg-surface-3/95 px-3 py-2.5 text-xs shadow-2xl shadow-black/50 backdrop-blur"
            style={{ left: `clamp(7rem, ${((hover - lo + 0.5) / n) * 100}%, calc(100% - 7rem))` }}
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="num text-sm font-medium text-text">#{hover}</span>
              {hover === cur && <span className="rounded bg-text/10 px-1.5 py-0.5 text-text">active</span>}
              {hover >= from && hover <= to && hover !== cur && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-accent">in range</span>}
            </div>
            <div className="num text-muted">
              {fmtPlanPct(hb.lowPct)} → {fmtPlanPct(hb.highPct)}
            </div>
            <div className="num mt-1.5 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
              <span className="font-sans text-faint">Pool liquidity</span>
              <span className="text-right text-text">{fmtUsd(hb.liquidity)}</span>
              <span className="font-sans text-faint">{period} fee APR</span>
              <span className="text-right text-accent">{fmtApr(hbApr)}</span>
              <span className="font-sans text-faint">{period} net APR</span>
              <span className={`text-right ${hb.pnlAprBps === null ? "text-faint" : hb.pnlAprBps < 0 ? "text-bad" : "text-good"}`}>
                {fmtApr(hb.pnlAprBps === null ? null : hb.pnlAprBps / 1e4)}
              </span>
            </div>
          </div>
        )}

        <div
          ref={stripRef}
          className={`relative flex h-14 items-stretch gap-[2px] ${gesture?.kind === "resize" ? "cursor-ew-resize" : "cursor-pointer"}`}
          style={{ touchAction: "pan-y" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={() => !gesture && setHover(null)}
        >
          {Array.from({ length: n }, (_, k) => {
            const i = lo + k;
            const sel = i >= from && i <= to;
            const t = tint.get(i) ?? 0;
            return (
              <div
                key={i}
                aria-hidden
                className={`min-w-[3px] flex-1 rounded-md transition-[background-color,box-shadow] duration-150 ${i === cur ? "ring-2 ring-text ring-offset-2 ring-offset-surface" : ""} ${hover === i ? "brightness-125" : ""}`}
                style={{
                  backgroundColor: sel ? `rgba(45, 212, 191, ${0.55 + 0.45 * t})` : `rgba(132, 143, 162, ${0.12 + 0.5 * t})`,
                }}
              />
            );
          })}
          {/* Edge handles */}
          {from >= lo && from <= hi && <Handle edge="from" left={pct(from)} label={`Start bin #${from}`} />}
          {to >= lo && to <= hi && <Handle edge="to" left={pct(to + 1)} label={`End bin #${to}`} />}
        </div>

        {/* Bin numbers and the active marker */}
        <div className="num relative mt-1.5 h-4 text-xs" aria-hidden>
          {Array.from({ length: n }, (_, k) => lo + k)
            .filter((i) => i === cur || i === from || i === to || (i % labelStep === 0 && Math.abs(i - cur) >= labelStep && Math.abs(i - from) >= labelStep && Math.abs(i - to) >= labelStep))
            .map((i) => (
              <span
                key={i}
                className={`absolute -translate-x-1/2 whitespace-nowrap ${i === cur ? "font-semibold text-text" : i === from || i === to ? "text-accent" : "text-faint"}`}
                style={{ left: `${((i - lo + 0.5) / n) * 100}%` }}
              >
                {i}
              </span>
            ))}
        </div>
        <div className="relative h-4 text-xs text-muted" aria-hidden>
          {cur >= lo && cur <= hi && (
            <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${((cur - lo + 0.5) / n) * 100}%` }}>
              ▲ active
            </span>
          )}
        </div>
      </div>
      <p className="mt-2 text-xs text-faint">Click or drag on the bins to choose a range, or drag the handles. Brighter bins traded more in the {period} window.</p>
    </div>
  );
}

function Handle({ edge, left, label }: { edge: "from" | "to"; left: string; label: string }) {
  return (
    <span
      data-edge={edge}
      title={label}
      className="absolute inset-y-[-4px] z-[1] flex w-6 -translate-x-1/2 cursor-ew-resize items-center justify-center"
      style={{ left }}
    >
      <span data-edge={edge} className="h-full w-1.5 rounded-full bg-text shadow-[0_0_0_2px_rgba(10,12,16,0.9)]" />
    </span>
  );
}
