"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmtApr, fmtUsd } from "@/lib/calc";
import { TVL_FLOORS, TVL_LABEL, filterSortPools, poolApr, toggleSort, type AprPeriod, type PoolSort, type TvlFloor } from "@/lib/poolList";
import { CHAINS, type Pool } from "@/lib/types";
import type { ApiState } from "@/lib/useApi";
import type { PickerPrefsState } from "@/lib/usePickerPrefs";
import { tradeBadge } from "@/lib/activity";
import { ChainBadge, ErrorNote, NoTradesBadge, Segmented, Skeleton, TierBadge, TokenLogo, inputCls } from "./ui";

export const OPEN_PICKER_EVENT = "binwise:open-pool-picker";

interface Props {
  list: ApiState<{ pools: Pool[] }>;
  selected: Pool | null;
  onSelect: (p: Pool) => void;
  /** A pool is set (e.g. from the URL) even if its metadata is still loading. */
  hasSelection: boolean;
  /** Sort / filters / APR period, owned by the page so they persist in its URL. */
  picker: PickerPrefsState;
  /** Target for OPEN_PICKER_EVENT with a detail id; an event without detail opens every picker. */
  pickerId?: string;
}

export default function PoolPicker({ list, selected, onSelect, hasSelection, picker, pickerId }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [prefs, setPrefs] = picker;

  // Lets other UI (e.g. the "no trades" empty state) open the picker.
  useEffect(() => {
    const show = (e: Event) => {
      const target = (e as CustomEvent<string | undefined>).detail;
      if (target && target !== pickerId) return;
      setOpen(true);
      ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    };
    window.addEventListener(OPEN_PICKER_EVENT, show);
    return () => window.removeEventListener(OPEN_PICKER_EVENT, show);
  }, [pickerId]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !selected) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, selected]);

  const { pools, total } = useMemo(() => filterSortPools(list.data?.pools ?? [], prefs, query), [list.data, prefs, query]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2.5 text-left ring-1 ring-transparent transition hover:ring-accent/30"
      >
        {selected ? (
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="flex -space-x-1.5">
              <TokenLogo src={selected.token0.logoUrl} symbol={selected.token0.symbol} />
              <TokenLogo src={selected.token1.logoUrl} symbol={selected.token1.symbol} />
            </span>
            <span className="whitespace-nowrap font-medium">{selected.pair}</span>
            <ChainBadge chainId={selected.chainId} />
            <TierBadge tier={selected.tier} isPrivate={selected.isPrivate} />
          </span>
        ) : hasSelection ? (
          <Skeleton className="h-5 w-44" />
        ) : (
          <span className="text-muted">Select a pool…</span>
        )}
        <span className="text-faint">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-2 w-full overflow-x-hidden rounded-xl bg-surface-3 p-3 shadow-2xl shadow-black/60 lg:w-[680px]">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search pair, token or address"
              className={inputCls.replace(" num", "")}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Segmented
              size="sm"
              value={prefs.chain}
              onChange={(chain) => setPrefs({ ...prefs, chain })}
              options={[{ value: "all" as const, label: "All" }, ...Object.entries(CHAINS).map(([id, c]) => ({ value: Number(id), label: c.short, title: c.name }))]}
            />
            <span className="flex items-center gap-1.5 text-[11px] text-faint">
              APR
              <Segmented<AprPeriod>
                size="sm"
                value={prefs.period}
                onChange={(period) => setPrefs({ ...prefs, period })}
                options={[
                  { value: "24h", label: "24h", title: "Last 24h fee APR (analytics24h)" },
                  { value: "7d", label: "7d", title: "7-day fee APR" },
                ]}
              />
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-faint">
              TVL
              <Segmented<TvlFloor>
                size="sm"
                value={prefs.minTvl}
                onChange={(minTvl) => setPrefs({ ...prefs, minTvl })}
                options={TVL_FLOORS.map((v) => ({ value: v, label: TVL_LABEL[v] }))}
              />
            </span>
            <label className="flex items-center gap-1.5 text-[11px] text-muted" title="Pools with no trades in the last 7 days and under $10k TVL are hidden by default.">
              <input type="checkbox" checked={prefs.showInactive} onChange={(e) => setPrefs({ ...prefs, showInactive: e.target.checked })} className="accent-[var(--accent)]" />
              Show inactive pools
            </label>
          </div>
          {!list.loading && total > 0 && (
            <p className="mt-2 text-[11px] text-faint">
              Showing {pools.length} of {total} pools
              {pools.length < total && (prefs.minTvl > 0 || !prefs.showInactive) && (
                <>
                  {" · "}
                  <button type="button" className="text-accent hover:underline" onClick={() => setPrefs({ ...prefs, minTvl: 0, showInactive: true })}>
                    show all
                  </button>
                </>
              )}
            </p>
          )}
          <div className="mt-2 max-h-96 overflow-y-auto overflow-x-hidden">
            {list.error && <ErrorNote message={list.error} retryAfter={list.retryAfter} onRetry={list.retry} />}
            {list.loading && (
              <div className="space-y-2 py-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-7" />
                ))}
              </div>
            )}
            {!list.loading && !list.error && pools.length === 0 && <p className="py-6 text-center text-sm text-muted">No pools match.</p>}
            {pools.length > 0 && (
              <table className="w-full table-fixed text-sm">
                <thead className="sticky top-0 bg-surface-3 text-left text-[11px] uppercase tracking-wider text-muted">
                  <tr>
                    <SortTh label="Pair" col="pair" prefs={prefs} onSort={(c) => setPrefs(toggleSort(prefs, c))} />
                    <SortTh label="Chain" col="chain" prefs={prefs} onSort={(c) => setPrefs(toggleSort(prefs, c))} className="hidden w-14 sm:table-cell" />
                    <SortTh label="TVL" col="tvl" prefs={prefs} onSort={(c) => setPrefs(toggleSort(prefs, c))} className="w-[4.75rem]" right />
                    <SortTh label={`${prefs.period} APR`} col="apr" prefs={prefs} onSort={(c) => setPrefs(toggleSort(prefs, c))} className="w-[5.25rem]" right />
                    <th className="hidden w-32 py-1.5 text-right font-medium sm:table-cell">Tier</th>
                  </tr>
                </thead>
                <tbody>
                  {pools.slice(0, 300).map((p) => (
                    <tr
                      key={`${p.chainId}-${p.poolAddress}`}
                      onClick={() => {
                        onSelect(p);
                        setOpen(false);
                      }}
                      className={`cursor-pointer border-t border-line/50 hover:bg-surface-2 ${
                        selected?.poolAddress.toLowerCase() === p.poolAddress.toLowerCase() && selected.chainId === p.chainId ? "bg-accent/5" : ""
                      }`}
                    >
                      <td className="py-2 pr-2">
                        <span className="flex min-w-0 items-center gap-2" title={p.pair}>
                          <span className="hidden shrink-0 -space-x-1.5 sm:flex">
                            <TokenLogo src={p.token0.logoUrl} symbol={p.token0.symbol} />
                            <TokenLogo src={p.token1.logoUrl} symbol={p.token1.symbol} />
                          </span>
                          <span className="truncate font-medium">{p.pair}</span>
                          <NoTradesBadge badge={tradeBadge(p.analytics24h?.volumeFiat, p.aprBps7d)} />
                          <span className="shrink-0 sm:hidden">
                            <ChainBadge chainId={p.chainId} />
                          </span>
                        </span>
                      </td>
                      <td className="hidden py-2 sm:table-cell">
                        <ChainBadge chainId={p.chainId} />
                      </td>
                      <td className="num py-2 text-right">{fmtUsd(p.tvlFiat, { compact: true })}</td>
                      <td className="num py-2 text-right text-accent">{(() => {
                        const apr = poolApr(p, prefs.period);
                        return apr === null ? <span className="text-faint">—</span> : fmtApr(apr);
                      })()}</td>
                      <td className="hidden py-2 text-right sm:table-cell">
                        <TierBadge tier={p.tier} isPrivate={p.isPrivate} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SortTh({ label, col, prefs, onSort, className = "", right = false }: { label: string; col: PoolSort; prefs: { sort: PoolSort; dir: "asc" | "desc" }; onSort: (c: PoolSort) => void; className?: string; right?: boolean }) {
  const active = prefs.sort === col;
  return (
    <th className={`py-1.5 font-medium ${right ? "text-right" : ""} ${className}`} aria-sort={active ? (prefs.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-0.5 uppercase tracking-wider transition hover:text-text ${active ? "text-text" : ""}`}
        title={`Sort by ${label}`}
      >
        {label}
        <span className={`text-[9px] ${active ? "text-accent" : "opacity-0"}`}>{active && prefs.dir === "asc" ? "▲" : "▼"}</span>
      </button>
    </th>
  );
}
