"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { bpsToFraction, fmtApr, fmtUsd } from "@/lib/calc";
import { CHAINS, type Pool } from "@/lib/types";
import type { ApiState } from "@/lib/useApi";
import { ChainBadge, ErrorNote, Segmented, Skeleton, TierBadge, TokenLogo, inputCls } from "./ui";

interface Props {
  list: ApiState<{ pools: Pool[] }>;
  selected: Pool | null;
  onSelect: (p: Pool) => void;
  /** A pool is set (e.g. from the URL) even if its metadata is still loading. */
  hasSelection: boolean;
}

export default function PoolPicker({ list, selected, onSelect, hasSelection }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [chain, setChain] = useState<number | "all">("all");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !selected) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, selected]);

  const pools = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (list.data?.pools ?? []).filter(
      (p) =>
        (chain === "all" || p.chainId === chain) &&
        (!q ||
          p.pair.toLowerCase().includes(q) ||
          p.token0.symbol.toLowerCase().includes(q) ||
          p.token1.symbol.toLowerCase().includes(q) ||
          p.poolAddress.toLowerCase().includes(q)),
    );
  }, [list.data, query, chain]);

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
            <div className="shrink-0">
            <Segmented
              size="sm"
              value={chain}
              onChange={setChain}
              options={[{ value: "all" as const, label: "All" }, ...Object.entries(CHAINS).map(([id, c]) => ({ value: Number(id), label: c.short, title: c.name }))]}
            />
            </div>
          </div>
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
                    <th className="py-1.5 font-medium">Pair</th>
                    <th className="hidden w-12 py-1.5 font-medium sm:table-cell">Chain</th>
                    <th className="w-[4.5rem] py-1.5 text-right font-medium">TVL</th>
                    <th className="w-[4.5rem] py-1.5 text-right font-medium">7d APR</th>
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
                          <span className="shrink-0 sm:hidden">
                            <ChainBadge chainId={p.chainId} />
                          </span>
                        </span>
                      </td>
                      <td className="hidden py-2 sm:table-cell">
                        <ChainBadge chainId={p.chainId} />
                      </td>
                      <td className="num py-2 text-right">{fmtUsd(p.tvlFiat, { compact: true })}</td>
                      <td className="num py-2 text-right text-accent">{fmtApr(bpsToFraction(p.aprBps7d))}</td>
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
