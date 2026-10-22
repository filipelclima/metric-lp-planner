"use client";
import { useEffect, useRef } from "react";
import { fmtAmount, fmtApr, fmtAprFixed, fmtBinPct, fmtUsd, type BinData, type Estimate } from "@/lib/calc";
import { NET_NOTE } from "@/lib/plan";
import type { Pool } from "@/lib/types";
import { InfoTip } from "./ui";

interface Props {
  pool: Pool;
  data: BinData;
  estimate: Estimate;
  hovered: number | null;
  onHover: (idx: number | null) => void;
}

/** Per-bin table. Hovering a row highlights its bar in the histogram and vice versa. */
export default function BinDetails({ pool, data, estimate, hovered, onHover }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const overTable = useRef(false);
  const rows = useRef(new Map<number, HTMLTableRowElement>());

  // Hover coming from the chart: bring the matching row into view inside the table.
  useEffect(() => {
    if (hovered === null || overTable.current) return;
    const row = rows.current.get(hovered);
    const el = box.current;
    if (!row || !el) return;
    const top = row.offsetTop - el.clientHeight / 2 + row.clientHeight / 2;
    el.scrollTo({ top, behavior: "smooth" });
  }, [hovered]);

  const th = "px-2 py-2 font-medium";
  return (
    <div
      ref={box}
      className="max-h-[440px] overflow-auto rounded-xl"
      onMouseEnter={() => (overTable.current = true)}
      onMouseLeave={() => {
        overTable.current = false;
        onHover(null);
      }}
    >
      <table className="num w-full min-w-[760px] text-xs">
        <thead className="sticky top-0 z-10 bg-surface text-left font-sans text-[10px] uppercase tracking-[0.08em] text-faint">
          <tr>
            <th className={th}>Bin</th>
            <th className={th}>Low</th>
            <th className={th}>Mid</th>
            <th className={th}>High</th>
            <th className={`${th} text-right`}>USD</th>
            <th className={`${th} text-right`}>{pool.token0.symbol}</th>
            <th className={`${th} text-right`}>{pool.token1.symbol}</th>
            <th className={`${th} text-right`}>Your share</th>
            <th className={`${th} text-right`}>Fees/day</th>
            <th className={`${th} text-right`}>Bin APR</th>
            <th className={`${th} text-right`}>
              <span className="inline-flex items-center gap-1">
                Net APR
                <InfoTip side="bottom">Historical trading PnL APR (fees + price moves) on your capital in this bin. {NET_NOTE}</InfoTip>
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {estimate.positions.map((p) => {
            const active = p.bin.idx === data.curBinIdx;
            const hot = p.bin.idx === hovered;
            return (
              <tr
                key={p.bin.idx}
                ref={(el) => {
                  if (el) rows.current.set(p.bin.idx, el);
                  else rows.current.delete(p.bin.idx);
                }}
                onMouseEnter={() => onHover(p.bin.idx)}
                className={`transition-colors duration-150 ${hot ? "bg-accent/10" : active ? "bg-text/[0.04]" : ""}`}
              >
                <td className="px-2 py-1.5">
                  #{p.bin.idx}
                  {active && <span className="ml-1.5 rounded bg-text/10 px-1 font-sans text-[10px] text-text">active</span>}
                </td>
                <td className="px-2 py-1.5 text-faint">{fmtBinPct(p.bin.lowPct)}</td>
                <td className="px-2 py-1.5">{fmtBinPct(p.bin.midPct)}</td>
                <td className="px-2 py-1.5 text-faint">{fmtBinPct(p.bin.highPct)}</td>
                <td className="px-2 py-1.5 text-right">{fmtUsd(p.usd)}</td>
                <td className="px-2 py-1.5 text-right">
                  {p.token0Usd > 0 && pool.token0.fiatPrice ? fmtAmount(p.token0Amount, pool.token0.fiatPrice) : <span className="text-faint">—</span>}
                </td>
                <td className="px-2 py-1.5 text-right">
                  {p.token1Usd > 0 && pool.token1.fiatPrice ? fmtAmount(p.token1Amount, pool.token1.fiatPrice) : <span className="text-faint">—</span>}
                </td>
                <td className="px-2 py-1.5 text-right">{(p.share * 100).toFixed(2)}%</td>
                <td className="px-2 py-1.5 text-right">{fmtUsd(p.dailyFees)}</td>
                <td className="px-2 py-1.5 text-right text-accent">{fmtApr(p.apr)}</td>
                <td className={`px-2 py-1.5 text-right ${p.netApr === null || p.netApr === 0 ? "" : p.netApr < 0 ? "text-bad" : "text-accent"}`}>
                  {fmtAprFixed(p.netApr)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
