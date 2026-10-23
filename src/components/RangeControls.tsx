"use client";
import { useEffect, useRef, useState } from "react";
import type { BinData } from "@/lib/calc";
import {
  BIN_TYPING,
  binBounds,
  clampBin,
  concentrationNote,
  edgeLabel,
  fmtCoverage,
  hasVolume,
  NO_VOLUME_PRESETS,
  parseBinInput,
  presetOptions,
  presetSubLabel,
  type PresetKey,
} from "@/lib/rangeInputs";
import { inputCls } from "./ui";

const PRESET_LABEL: Record<PresetKey, string> = { 80: "80%", 90: "90%", 95: "95%", wider: "Wider" };
const PRESET_TITLE: Record<PresetKey, string> = {
  80: "Smallest range around the active bin that covered 80% of volume",
  90: "Smallest range around the active bin that covered 90% of volume",
  95: "Smallest range around the active bin that covered 95% of volume",
  wider: "The 95% range plus 2 bins on each side",
};

/** True for a moment after `key` changes (not on mount), to flash results that just updated. */
export function useFlash(key: string, ms = 700): boolean {
  const [on, setOn] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setOn(true);
    const t = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(t);
  }, [key, ms]);
  return on;
}

export const flashCls = (on: boolean) => `transition-shadow duration-500 ${on ? "shadow-[0_0_0_2px_rgba(45,212,191,0.45)]" : "shadow-[0_0_0_0_rgba(45,212,191,0)]"}`;

/**
 * 80/90/95%/Wider/Manual buttons. Each preset shows its resulting range and real coverage underneath
 * ("#-2…#0 (96%)"), and a note explains when a concentrated pool makes several presets match.
 */
export function PresetPicker({ data, value, onPick, size = "md" }: { data: BinData | null; value: PresetKey | "manual"; onPick: (k: PresetKey | "manual") => void; size?: "sm" | "md" }) {
  // Without volume, presets fall back to ±5 bins: hide the coverage labels and say why instead.
  const noVolume = data !== null && !hasVolume(data);
  const options = data && !noVolume ? presetOptions(data) : null;
  const note = options ? concentrationNote(options) : null;
  const keys: (PresetKey | "manual")[] = [80, 90, 95, "wider", "manual"];
  return (
    <div>
      <div className="flex w-full rounded-lg bg-surface-2 p-0.5">
        {keys.map((k) => {
          const o = options?.find((x) => x.key === k);
          const on = value === k;
          return (
            <button
              key={String(k)}
              type="button"
              aria-pressed={on}
              title={k === "manual" ? "Pick bins yourself" : PRESET_TITLE[k]}
              onClick={() => onPick(k)}
              className={`flex min-w-0 flex-1 flex-col items-center rounded-md px-1 ${size === "sm" ? "py-1" : "py-1.5"} transition ${
                on ? "bg-surface-3 text-accent shadow-sm" : "text-muted hover:text-text"
              }`}
            >
              <span className={size === "sm" ? "text-xs" : "text-[13px]"}>{k === "manual" ? "Manual" : PRESET_LABEL[k]}</span>
              {/* "#-2…#0" over "96%" so it fits five buttons in the narrow sidebar; title has the one-line form. */}
              <span className={`num mt-0.5 flex h-6 max-w-full flex-col items-center text-[9.5px] leading-3 ${on ? "text-accent/80" : "text-faint"}`} title={o ? presetSubLabel(o) : undefined}>
                {o && (
                  <>
                    <span className="max-w-full truncate">
                      #{o.from}…#{o.to}
                    </span>
                    <span>{fmtCoverage(o.coverage)}</span>
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {note && <p className="mt-1.5 text-[11px] leading-snug text-warn">{note}</p>}
      {noVolume && <p className="mt-1.5 text-[11px] leading-snug text-faint">{NO_VOLUME_PRESETS}: nothing traded in this data period, so 80/90/95% can&apos;t be computed.</p>}
    </div>
  );
}

/**
 * Start/end bin input: accepts "+1", "1", "-2" and "−2"; rejects other characters without wiping the field;
 * clamps to the pool's bins with a visible note; −/+ steppers; shows the bin's % edge underneath.
 */
export function BinField({
  label,
  side,
  value,
  data,
  onCommit,
}: {
  label: string;
  side: "start" | "end";
  value: number | null;
  data: BinData | null;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => setText(value === null ? "" : String(value)), [value]);
  const bounds = data ? binBounds(data) : null;

  const commitValue = (raw: number) => {
    const c = clampBin(raw, bounds);
    setHint(c.clamped ? `Limited to #${c.value}, the pool's ${c.clamped === "min" ? "lowest" : "highest"} bin with data (you typed ${raw}).` : null);
    setText(String(c.value));
    if (c.value !== value) onCommit(c.value);
  };
  const commitText = () => {
    const p = parseBinInput(text);
    if (p.ok) return commitValue(p.value);
    setText(value === null ? "" : String(value));
    setHint(p.error === "empty" ? "Enter a bin number, e.g. -2 or +1." : "Whole bin numbers only, e.g. -2 or +1.");
  };
  const step = (d: number) => value !== null && commitValue(value + d);
  const btn = "flex w-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted transition hover:bg-surface-3 hover:text-text disabled:opacity-40";

  return (
    <div className="min-w-0">
      <span className="mb-1 block text-[11px] text-faint">{label}</span>
      <div className="flex gap-1">
        <button type="button" className={btn} onClick={() => step(-1)} disabled={value === null || (bounds !== null && value <= bounds.min)} aria-label={`${label}: one bin lower`}>
          −
        </button>
        <input
          value={text}
          inputMode="numeric"
          aria-label={label}
          aria-invalid={hint !== null}
          onChange={(e) => {
            if (!BIN_TYPING.test(e.target.value)) {
              setHint("Whole bin numbers only, e.g. -2 or +1.");
              return;
            }
            setHint(null);
            setText(e.target.value);
          }}
          onBlur={commitText}
          onKeyDown={(e) => e.key === "Enter" && commitText()}
          className={`${inputCls} min-w-0 text-center`}
          placeholder="#"
        />
        <button type="button" className={btn} onClick={() => step(1)} disabled={value === null || (bounds !== null && value >= bounds.max)} aria-label={`${label}: one bin higher`}>
          +
        </button>
      </div>
      <div className="num mt-1 min-h-[14px] text-[10px] text-faint">{data && value !== null ? edgeLabel(data, value, side) : ""}</div>
      {hint && (
        <p role="status" className="text-[10.5px] leading-snug text-warn">
          {hint}
        </p>
      )}
    </div>
  );
}
