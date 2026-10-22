import { ImageResponse } from "next/og";
import { fmtApr, fmtPlanPct, fmtUsd, getBin, parseBins, projectFees, type BinData } from "@/lib/calc";
import { isAddress, metricFetch } from "@/lib/metric";
import { normalizePool } from "@/lib/normalize";
import { computeEstimate, resolveRange } from "@/lib/plan";
import { CHAINS, type Pool, type RawBinsResponse, type RawPool } from "@/lib/types";
import { readState } from "@/lib/urlState";

const W = 1200;
const H = 630;
const COLORS = { bg: "#0a0c10", surface: "#11141a", line: "#232934", text: "#e8ecf2", muted: "#8a94a6", faint: "#5b6577", accent: "#2dd4bf", good: "#4ade80", bad: "#f87171" };

/** 1200×630 share card for the plan described by the URL params (same params as the page). */
export async function GET(req: Request) {
  const s = readState(new URL(req.url).searchParams);
  let pool: Pool | null = null;
  let binData: BinData | null = null;
  let binsFailed = false;

  if (s.chain !== null && s.pool && isAddress(s.pool)) {
    const base = `/evm/${s.chain}/${s.pool}`;
    const [meta, bins] = await Promise.all([
      metricFetch(`${base}/metadata?contract_version=v1&include24h=true`, 300),
      metricFetch(`${base}/analytics/bins?contract_version=v1&period=${s.period}`, 60),
    ]);
    if (meta.ok) pool = normalizePool(meta.body as RawPool, s.chain);
    if (bins.ok) {
      try {
        binData = parseBins(bins.body as RawBinsResponse);
      } catch {
        binsFailed = true;
      }
    } else binsFailed = true;
  }

  const range = resolveRange(s, binData, binData?.curBinIdx ?? pool?.curBinIdx ?? 0);
  const est = computeEstimate(s, pool, binData, range, binsFailed);
  const fees = est ? projectFees(est.dailyFees, est.deposit, s.days).simple : null;
  const net = est?.netApr ?? null;
  const rangeText =
    binData && range
      ? `#${range.from} (${fmtPlanPct(getBin(binData, range.from).midPct)}) → #${range.to} (${fmtPlanPct(getBin(binData, range.to).midPct)}) · ${range.to - range.from + 1} bins`
      : range
        ? `#${range.from} → #${range.to}`
        : "—";

  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", background: COLORS.bg, color: COLORS.text, padding: 64, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 5, width: 52, height: 52, borderRadius: 14, background: "#171b22", padding: "0 9px 10px" }}>
              {[14, 22, 32, 20, 12].map((h, i) => (
                <div key={i} style={{ width: 5, height: h, borderRadius: 2, background: i === 2 ? COLORS.accent : COLORS.faint }} />
              ))}
            </div>
            <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -1 }}>Binwise</div>
          </div>
          <div style={{ fontSize: 22, color: COLORS.faint }}>LP plan · Metric pools</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 56 }}>
          <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: -2 }}>{pool?.pair ?? "Metric pool"}</div>
          {s.chain !== null && (
            <div style={{ fontSize: 24, color: COLORS.muted, background: "#1e232c", borderRadius: 10, padding: "6px 14px" }}>
              {CHAINS[s.chain]?.name ?? `Chain ${s.chain}`}
            </div>
          )}
        </div>
        <div style={{ display: "flex", fontSize: 28, color: COLORS.muted, marginTop: 12 }}>
          {fmtUsd(s.amount)} deposit · {s.days} days · {rangeText}
        </div>

        <div style={{ display: "flex", gap: 24, marginTop: "auto" }}>
          <Stat label={`Est. fees · ${s.days}d`} value={fees === null ? "—" : `+${fmtUsd(fees)}`} color={COLORS.text} />
          <Stat label="Fee APR" value={est ? fmtApr(est.apr) : "—"} color={COLORS.accent} />
          <Stat label="Net APR (hist.)" value={fmtApr(net)} color={net === null ? COLORS.faint : net < 0 ? COLORS.bad : COLORS.good} />
        </div>
        <div style={{ display: "flex", fontSize: 18, color: COLORS.faint, marginTop: 28 }}>
          Estimates from past data. Fees are not profit. Unofficial community tool, not affiliated with Metric.
        </div>
      </div>
    ),
    { width: W, height: H, headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=1500" } },
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, background: COLORS.surface, borderRadius: 20, padding: "24px 28px" }}>
      <div style={{ fontSize: 20, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 2 }}>{label}</div>
      <div style={{ fontSize: 52, fontWeight: 700, color, marginTop: 8, letterSpacing: -1 }}>{value}</div>
    </div>
  );
}
