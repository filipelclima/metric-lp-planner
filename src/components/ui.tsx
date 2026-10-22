import type { ReactNode } from "react";
import { TIER_LABEL } from "@/lib/risk";
import { CHAINS, type Tier } from "@/lib/types";

export function Panel({ title, right, children, className = "" }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-panel/90 p-4 sm:p-5 ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-sm font-medium uppercase tracking-wider text-muted">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  size = "md",
}: {
  value: T | null;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex flex-wrap rounded-lg border border-line bg-panel-2 p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`rounded-md ${size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm"} transition ${
            value === o.value ? "bg-accent/15 text-accent" : "text-muted hover:text-text"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const TIER_STYLE: Record<Tier | "private", string> = {
  green: "bg-good/15 text-good border-good/30",
  yellow: "bg-warn/15 text-warn border-warn/30",
  red: "bg-bad/15 text-bad border-bad/30",
  black: "bg-black text-text border-line",
  unclassified: "bg-panel-2 text-muted border-line",
  private: "bg-accent-2/15 text-accent-2 border-accent-2/30",
};

/** Tier badge; pools with deposit whitelisting show "Private" instead of a tier. */
export function TierBadge({ tier, isPrivate }: { tier: Tier; isPrivate: boolean }) {
  const key = isPrivate ? "private" : tier;
  return (
    <span
      title={isPrivate ? "Deposits are whitelisted" : `Metric tier: ${tier}`}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${TIER_STYLE[key]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {isPrivate ? "Private" : TIER_LABEL[tier]}
    </span>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-xs font-medium uppercase tracking-wider text-muted">{label}</label>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export const inputCls =
  "w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-text outline-none placeholder:text-muted focus:border-accent/60 num";

export function TokenLogo({ src, symbol }: { src?: string; symbol: string }) {
  return (
    <span className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-panel-2 text-[9px] font-semibold text-muted ring-1 ring-line">
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
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">
      <span>
        {message}
        {retryAfter ? ` (try again in ~${retryAfter}s)` : ""}
      </span>
      {onRetry && (
        <button onClick={onRetry} className="rounded-md border border-bad/40 px-2 py-0.5 text-xs hover:bg-bad/20">
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
    <span title={c?.name ?? `Chain ${chainId}`} className="inline-flex rounded border border-line bg-panel-2 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted">
      {c?.short ?? chainId}
    </span>
  );
}
