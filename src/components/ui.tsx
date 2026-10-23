"use client";
import { AnimatePresence, animate, motion, useReducedMotion } from "framer-motion";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { TIER_LABEL } from "@/lib/risk";
import { CHAINS, type Tier } from "@/lib/types";

type Glow = "good" | "bad" | "none";

const GLOW: Record<Glow, string> = {
  good: "hover:border-good/40 hover:shadow-[0_0_0_1px_rgba(74,222,128,0.15),0_12px_32px_-12px_rgba(74,222,128,0.25)]",
  bad: "hover:border-warn/40 hover:shadow-[0_0_0_1px_rgba(251,191,36,0.15),0_12px_32px_-12px_rgba(251,191,36,0.25)]",
  none: "hover:border-line",
};

/** Surface card with a subtle lift and a border glow (green when net ≥ 0, amber when negative). */
export function Card({ children, className = "", glow = "none" }: { children: ReactNode; className?: string; glow?: Glow }) {
  return (
    <div
      className={`rounded-2xl border border-transparent bg-surface transition duration-200 hover:-translate-y-px motion-reduce:transform-none ${GLOW[glow]} ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-faint">{children}</span>
      {right}
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  size = "md",
  full = false,
}: {
  value: T | null;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
  full?: boolean;
}) {
  return (
    <div className={`${full ? "flex w-full" : "inline-flex"} rounded-lg bg-surface-2 p-0.5`}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          title={o.title}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`${full ? "flex-1" : ""} whitespace-nowrap rounded-md ${size === "sm" ? "px-2 py-1 text-xs" : "px-2.5 py-1.5 text-[13px]"} transition ${
            value === o.value ? "bg-surface-3 text-accent shadow-sm" : "text-muted hover:text-text"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const TIER_STYLE: Record<Tier | "private", string> = {
  green: "text-good",
  yellow: "text-warn",
  red: "text-bad",
  black: "text-bad",
  unclassified: "text-muted",
  private: "text-accent",
};

/** Tier badge; pools with deposit whitelisting show "Private" instead of a tier. */
export function TierBadge({ tier, isPrivate }: { tier: Tier; isPrivate: boolean }) {
  const key = isPrivate ? "private" : tier;
  return (
    <span
      title={isPrivate ? "Deposits are whitelisted" : `Metric tier: ${tier}`}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium ${TIER_STYLE[key]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {isPrivate ? "Private" : TIER_LABEL[tier]}
    </span>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-faint">{label}</span>
        {hint && <span className="text-[11px] text-muted">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export const inputCls =
  "w-full rounded-lg border border-transparent bg-surface-2 px-3 py-2 text-sm text-text outline-none transition placeholder:text-faint focus:border-accent/50 num";

export function TokenLogo({ src, symbol, size = 20 }: { src?: string; symbol: string; size?: number }) {
  return (
    <span
      style={{ width: size, height: size }}
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-3 text-[9px] font-semibold text-muted ring-2 ring-surface"
    >
      {symbol.slice(0, 2)}
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />
      )}
    </span>
  );
}

export function ErrorNote({ message, onRetry, retryAfter }: { message: string; onRetry?: () => void; retryAfter?: number | null }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">
      <span>
        {message}
        {retryAfter ? ` (try again in ~${retryAfter}s)` : ""}
      </span>
      {onRetry && (
        <button onClick={onRetry} className="rounded-md bg-bad/15 px-2 py-0.5 text-xs hover:bg-bad/25">
          Retry
        </button>
      )}
    </div>
  );
}

/** Short chain label (ETH / BNB / RH) with the full name as a tooltip. */
export function ChainBadge({ chainId }: { chainId: number }) {
  const c = CHAINS[chainId];
  return (
    <span title={c?.name ?? `Chain ${chainId}`} className="inline-flex rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted">
      {c?.short ?? chainId}
    </span>
  );
}

/** ⓘ icon with a hover/focus tooltip — replaces inline explanatory text. */
export function InfoTip({ children, side = "top", className = "" }: { children: ReactNode; side?: "top" | "bottom"; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className={`relative inline-flex align-middle ${className}`} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        aria-label="More info"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold text-faint ring-1 ring-faint/60 transition hover:text-text hover:ring-text/60"
      >
        i
      </button>
      <AnimatePresence>
        {open && (
          <motion.span
            id={id}
            role="tooltip"
            initial={{ opacity: 0, y: side === "top" ? 4 : -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className={`absolute left-1/2 z-50 w-64 -translate-x-1/2 rounded-lg bg-surface-3 px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-text shadow-xl shadow-black/40 ${
              side === "top" ? "bottom-6" : "top-6"
            }`}
          >
            {children}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/** Number that counts from its previous value to the new one (~600ms ease-out); instant with reduced motion. */
export function CountUp({ value, format, className = "" }: { value: number; format: (v: number) => string; className?: string }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced || !Number.isFinite(prev.current) || !Number.isFinite(value)) {
      el.textContent = format(value);
      prev.current = value;
      return;
    }
    const controls = animate(prev.current, value, {
      duration: 0.6,
      ease: "easeOut",
      onUpdate: (v) => (el.textContent = format(v)),
    });
    prev.current = value;
    return () => controls.stop();
  }, [value, format, reduced]);
  return (
    <span ref={ref} className={`num ${className}`}>
      {format(value)}
    </span>
  );
}

export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton ${className}`} style={style} />;
}

/** Click-to-open popover anchored to its trigger; closes on outside click or Escape. */
export function Popover({
  trigger,
  children,
  align = "right",
  label,
  onOpen,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  label: string;
  /** Called each time the popover opens (before its content renders). */
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label={label}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen(!open);
        }}
        className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-muted transition hover:bg-surface-3 hover:text-text"
      >
        {trigger}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.14 }}
            className={`absolute z-40 mt-2 min-w-72 rounded-xl bg-surface-3 p-4 shadow-2xl shadow-black/50 ${align === "right" ? "right-0" : "left-0"}`}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Section with an animated expand/collapse. */
export function Collapsible({
  title,
  open,
  onToggle,
  children,
  right,
}: {
  title: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <button type="button" aria-expanded={open} onClick={onToggle} className="group flex items-center gap-2 text-left">
          <motion.span animate={{ rotate: open ? 90 : 0 }} className="text-faint transition group-hover:text-text">
            ›
          </motion.span>
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-faint transition group-hover:text-text">{title}</span>
        </button>
        {right}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="pt-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
