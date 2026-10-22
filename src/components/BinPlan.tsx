"use client";
import { useState } from "react";
import { fmtAmount, fmtApr, fmtAprFixed, fmtBinPct, fmtUsd, planText, type BinData, type Estimate } from "@/lib/calc";
import type { Pool } from "@/lib/types";

interface Props {
  pool: Pool;
  data: BinData;
  from: number;
  to: number;
  estimate: Estimate;
}

export function tokensNeededText(pool: Pool, e: Estimate): string {
  const parts: string[] = [];
  const part = (usd: number, amt: number, t: Pool["token0"]) =>
    t.fiatPrice ? `${fmtAmount(amt, t.fiatPrice)} ${t.symbol}` : `${fmtUsd(usd)} of ${t.symbol} (no price)`;
  if (e.token1Usd > 0) parts.push(part(e.token1Usd, e.token1Amount, pool.token1));
  if (e.token0Usd > 0) parts.push(part(e.token0Usd, e.token0Amount, pool.token0));
  return parts.length ? `You'll need ≈ ${parts.join(" + ")}` : "";
}

export default function BinPlan({ pool, data, from, to, estimate }: Props) {
  const [copied, setCopied] = useState(false);
  const plan = planText(data, from, to);
  const tokens = tokensNeededText(pool, estimate);
  const missing = [
    estimate.token0Usd > 0 && !pool.token0.fiatPrice && pool.token0.symbol,
    estimate.token1Usd > 0 && !pool.token1.fiatPrice && pool.token1.symbol,
  ].filter(Boolean);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${pool.pair} (${pool.poolAddress})\n${plan}\n${tokens}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="space-y-4">
      <div className="relative rounded-xl border border-accent/25 bg-gradient-to-br from-accent/[0.07] to-accent-2/[0.05] p-4 sm:p-5">
        <pre className="num overflow-x-auto font-mono text-base leading-relaxed text-text sm:text-xl">{plan}</pre>
        <button
          onClick={copy}
          className="absolute right-3 top-3 rounded-md border border-line bg-panel-2 px-2.5 py-1 text-xs text-muted hover:text-text"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>

      <div className="rounded-xl border border-line bg-panel-2 px-4 py-3">
        <div className="text-xs uppercase tracking-wider text-muted">Tokens needed</div>
        <div className="num mt-1 text-lg font-medium">{tokens || "—"}</div>
        <div className="num mt-0.5 text-xs text-muted">
          {fmtUsd(estimate.token1Usd)} in {pool.token1.symbol} (bins below the active bin) · {fmtUsd(estimate.token0Usd)} in {pool.token0.symbol}{" "}
          (bins above) · the active bin takes both at its current reserve ratio
        </div>
        {missing.length > 0 && (
          <div className="mt-1 text-xs text-warn">Metric has no fiat price for {missing.join(" and ")}, so its token amount is unavailable.</div>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="num w-full min-w-[720px] text-xs">
          <thead className="bg-panel-2 text-left text-[11px] uppercase tracking-wider text-muted">
            <tr>
              <th className="px-1.5 py-2 font-medium">Bin</th>
              <th className="px-1.5 py-2 font-medium">Low</th>
              <th className="px-1.5 py-2 font-medium">Mid</th>
              <th className="px-1.5 py-2 font-medium">High</th>
              <th className="px-1.5 py-2 text-right font-medium">USD</th>
              <th className="px-1.5 py-2 text-right font-medium">{pool.token0.symbol}</th>
              <th className="px-1.5 py-2 text-right font-medium">{pool.token1.symbol}</th>
              <th className="px-1.5 py-2 text-right font-medium">Your share</th>
              <th className="px-1.5 py-2 text-right font-medium">Fees/day</th>
              <th className="px-1.5 py-2 text-right font-medium">Bin APR</th>
              <th className="px-1.5 py-2 text-right font-medium" title="Historical trading PnL APR (fees + price moves) on your capital in this bin">
                Net APR
              </th>
            </tr>
          </thead>
          <tbody>
            {estimate.positions.map((p) => {
              const active = p.bin.idx === data.curBinIdx;
              return (
                <tr key={p.bin.idx} className={`border-t border-line/60 ${active ? "bg-warn/[0.06]" : ""}`}>
                  <td className="px-1.5 py-1.5">
                    #{p.bin.idx}
                    {active && <span className="ml-1.5 rounded bg-warn/15 px-1 text-[10px] text-warn">active</span>}
                  </td>
                  <td className="px-1.5 py-1.5 text-muted">{fmtBinPct(p.bin.lowPct)}</td>
                  <td className="px-1.5 py-1.5">{fmtBinPct(p.bin.midPct)}</td>
                  <td className="px-1.5 py-1.5 text-muted">{fmtBinPct(p.bin.highPct)}</td>
                  <td className="px-1.5 py-1.5 text-right">{fmtUsd(p.usd)}</td>
                  <td className="px-1.5 py-1.5 text-right">{p.token0Usd > 0 && pool.token0.fiatPrice ? fmtAmount(p.token0Amount, pool.token0.fiatPrice) : <span className="text-muted">—</span>}</td>
                  <td className="px-1.5 py-1.5 text-right">{p.token1Usd > 0 && pool.token1.fiatPrice ? fmtAmount(p.token1Amount, pool.token1.fiatPrice) : <span className="text-muted">—</span>}</td>
                  <td className="px-1.5 py-1.5 text-right">{(p.share * 100).toFixed(2)}%</td>
                  <td className="px-1.5 py-1.5 text-right">{fmtUsd(p.dailyFees)}</td>
                  <td className="px-1.5 py-1.5 text-right text-accent">{fmtApr(p.apr)}</td>
                  <td className={`px-1.5 py-1.5 text-right ${p.netApr === null || p.netApr === 0 ? "" : p.netApr < 0 ? "text-bad" : "text-accent"}`}>
                    {fmtAprFixed(p.netApr)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
