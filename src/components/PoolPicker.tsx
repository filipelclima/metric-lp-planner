"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { bpsToFraction, fmtApr, fmtUsd } from "@/lib/calc";
import { chainName } from "@/lib/normalize";
import { CHAINS, type Pool } from "@/lib/types";
import type { ApiState } from "@/lib/useApi";
import { ErrorNote, Segmented, TierBadge, TokenLogo, inputCls } from "./ui";

interface Props {
  list: ApiState<{ pools: Pool[] }>;
  selected: Pool | null;
  onSelect: (p: Pool) => void;
  /** A pool is set (e.g. from the URL) even if its metadata is still loading. */
  hasSelection: boolean;
}

export default function PoolPicker({ list, selected, onSelect, hasSelection }: Props) {
  const [open, setOpen] = useState(!hasSelection);
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
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-left hover:border-accent/40"
      >
        {selected ? (
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex -space-x-1.5">
              <TokenLogo src={selected.token0.logoUrl} symbol={selected.token0.symbol} />
              <TokenLogo src={selected.token1.logoUrl} symbol={selected.token1.symbol} />
            </span>
            <span className="truncate font-medium">{selected.pair}</span>
            <span className="text-xs text-muted">{chainName(selected.chainId)}</span>
            <TierBadge tier={selected.tier} />
          </span>
        ) : (
          <span className="text-muted">{hasSelection ? "Loading pool…" : "Select a pool…"}</span>
        )}
        <span className="text-muted">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className={`${selected ? "absolute z-30 mt-2 shadow-2xl shadow-black/50 lg:w-[640px]" : "mt-2"} w-full rounded-xl border border-line bg-panel p-3`}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search pair, token or address"
              className={inputCls}
            />
            <Segmented
              size="sm"
              value={chain}
              onChange={setChain}
              options={[{ value: "all" as const, label: "All" }, ...Object.entries(CHAINS).map(([id, c]) => ({ value: Number(id), label: c.short, title: c.name }))]}
            />
          </div>
          <div className="mt-2 max-h-80 overflow-y-auto">
            {list.error && <ErrorNote message={list.error} retryAfter={list.retryAfter} onRetry={list.retry} />}
            {list.loading && <p className="py-6 text-center text-sm text-muted">Loading pools…</p>}
            {!list.loading && !list.error && pools.length === 0 && <p className="py-6 text-center text-sm text-muted">No pools match.</p>}
            {pools.length > 0 && (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-panel text-left text-[11px] uppercase tracking-wider text-muted">
                  <tr>
                    <th className="py-1.5 font-medium">Pair</th>
                    <th className="hidden py-1.5 font-medium sm:table-cell">Chain</th>
                    <th className="py-1.5 text-right font-medium">TVL</th>
                    <th className="py-1.5 text-right font-medium">7d APR</th>
                    <th className="py-1.5 text-right font-medium">Tier</th>
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
                      className={`cursor-pointer border-t border-line/60 hover:bg-panel-2 ${
                        selected?.poolAddress.toLowerCase() === p.poolAddress.toLowerCase() && selected.chainId === p.chainId ? "bg-accent/5" : ""
                      }`}
                    >
                      <td className="py-2">
                        <span className="flex items-center gap-2">
                          <span className="flex -space-x-1.5">
                            <TokenLogo src={p.token0.logoUrl} symbol={p.token0.symbol} />
                            <TokenLogo src={p.token1.logoUrl} symbol={p.token1.symbol} />
                          </span>
                          <span className="font-medium">{p.pair}</span>
                        </span>
                      </td>
                      <td className="hidden py-2 text-muted sm:table-cell">{chainName(p.chainId)}</td>
                      <td className="num py-2 text-right">{fmtUsd(p.tvlFiat, { compact: true })}</td>
                      <td className="num py-2 text-right text-accent">{fmtApr(bpsToFraction(p.aprBps7d))}</td>
                      <td className="py-2 text-right">
                        <TierBadge tier={p.tier} />
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
