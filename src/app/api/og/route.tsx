import { ImageResponse } from "next/og";
import { fmtApr, fmtPlanPct, fmtUsd, getBin, parseBins, projectFees, type BinData } from "@/lib/calc";
import { fetchJsonWithTimeout } from "@/lib/fetchTimeout";
import { normalizePool } from "@/lib/normalize";
import { computeEstimate, resolveRange } from "@/lib/plan";
import { CHAINS, type Pool, type RawBinsResponse, type RawPool } from "@/lib/types";
import { readState, type PlannerState } from "@/lib/urlState";

export const runtime = "edge";

const METRIC_API = "https://api.metric.xyz/public/v1";
const W = 1200;
const H = 630;
/** Crawlers (X, Slack, …) give up after a few seconds; the whole Metric lookup must fit in this budget. */
const BUDGET_MS = 2000;
const CACHE_LIVE = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";
/** A plan-only card (Metric unreachable) is cached briefly so live numbers replace it soon. */
const CACHE_PLAN_ONLY = "public, max-age=60, s-maxage=60, stale-while-revalidate=86400";
const COLORS = { bg: "#0a0c10", surface: "#11141a", text: "#e8ecf2", muted: "#8a94a6", faint: "#5b6577", accent: "#2dd4bf", good: "#4ade80", bad: "#f87171" };

interface CardView {
  pair: string;
  chain: string | null;
  plan: string;
  stats: { label: string; value: string; color: string }[] | null;
}

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * 1200×630 share card for the plan in the URL (same params as the page, plus optional `pair`).
 * Always answers 200 with a PNG: if Metric is slow or down it renders the plan without numbers.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  let view: CardView;
  let live = false;
  try {
    const s = readState(params);
    const data = await loadData(s);
    view = buildView(s, params.get("pair"), data.pool, data.binData, data.binsFailed);
    live = view.stats !== null;
  } catch {
    view = { pair: params.get("pair") ?? "Metric pool", chain: null, plan: "LP plan", stats: null };
  }
  return new ImageResponse(<Card view={view} />, {
    width: W,
    height: H,
    headers: { "cache-control": live ? CACHE_LIVE : CACHE_PLAN_ONLY },
  });
}

async function loadData(s: PlannerState): Promise<{ pool: Pool | null; binData: BinData | null; binsFailed: boolean }> {
  if (s.chain === null || !s.pool || !/^0x[0-9a-fA-F]{40}$/.test(s.pool)) return { pool: null, binData: null, binsFailed: true };
  const base = `${METRIC_API}/evm/${s.chain}/${s.pool}`;
  const [meta, bins] = await Promise.all([
    fetchJsonWithTimeout<RawPool>(`${base}/metadata?contract_version=v1&include24h=true`, BUDGET_MS, { next: { revalidate: 300 } }),
    fetchJsonWithTimeout<RawBinsResponse>(`${base}/analytics/bins?contract_version=v1&period=${s.period}`, BUDGET_MS, { next: { revalidate: 60 } }),
  ]);
  let pool: Pool | null = null;
  let binData: BinData | null = null;
  try {
    if (meta) pool = normalizePool(meta, s.chain);
  } catch {
    pool = null;
  }
  try {
    if (bins) binData = parseBins(bins);
  } catch {
    binData = null;
  }
  return { pool, binData, binsFailed: !binData };
}

function buildView(s: PlannerState, pairParam: string | null, pool: Pool | null, binData: BinData | null, binsFailed: boolean): CardView {
  const range = resolveRange(s, binData, binData?.curBinIdx ?? pool?.curBinIdx ?? 0);
  const rangeText =
    binData && range
      ? `#${range.from} (${fmtPlanPct(getBin(binData, range.from).midPct)}) → #${range.to} (${fmtPlanPct(getBin(binData, range.to).midPct)}) · ${range.to - range.from + 1} bins`
      : range
        ? `bins #${range.from} → #${range.to}`
        : s.range.kind === "preset"
          ? `range covering ${s.range.share}% of volume`
          : "custom range";
  const est = computeEstimate(s, pool, binData, range, binsFailed);
  const fees = est ? projectFees(est.dailyFees, est.deposit, s.days).simple : null;
  const net = est?.netApr ?? null;
  return {
    pair: pool?.pair ?? pairParam ?? (s.pool ? `Pool ${shortAddr(s.pool)}` : "Metric pool"),
    chain: s.chain !== null ? (CHAINS[s.chain]?.name ?? `Chain ${s.chain}`) : null,
    plan: `${fmtUsd(s.amount)} deposit · ${s.days} days · ${rangeText}`,
    stats:
      est && fees !== null
        ? [
            { label: `Est. fees · ${s.days}d`, value: `+${fmtUsd(fees)}`, color: COLORS.text },
            { label: "Fee APR", value: fmtApr(est.apr), color: COLORS.accent },
            { label: "Net APR (hist.)", value: fmtApr(net), color: net === null ? COLORS.faint : net < 0 ? COLORS.bad : COLORS.good },
          ]
        : null,
  };
}

function Card({ view }: { view: CardView }) {
  return (
    <div style={{ width: W, height: H, display: "flex", flexDirection: "column", background: COLORS.bg, color: COLORS.text, padding: 64, fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 5, width: 52, height: 52, borderRadius: 14, background: "#171b22", padding: "0 9px 10px" }}>
            {[14, 22, 32, 20, 12].map((h, i) => (
              <div key={i} style={{ display: "flex", width: 5, height: h, borderRadius: 2, background: i === 2 ? COLORS.accent : COLORS.faint }} />
            ))}
          </div>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 700, letterSpacing: -1 }}>Binwise</div>
        </div>
        <div style={{ display: "flex", fontSize: 22, color: COLORS.faint }}>LP plan · Metric pools</div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 56 }}>
        <div style={{ display: "flex", fontSize: 64, fontWeight: 700, letterSpacing: -2 }}>{view.pair}</div>
        {view.chain && (
          <div style={{ display: "flex", fontSize: 24, color: COLORS.muted, background: "#1e232c", borderRadius: 10, padding: "6px 14px" }}>{view.chain}</div>
        )}
      </div>
      <div style={{ display: "flex", fontSize: 28, color: COLORS.muted, marginTop: 12 }}>{view.plan}</div>

      {view.stats ? (
        <div style={{ display: "flex", gap: 24, marginTop: "auto" }}>
          {view.stats.map((st) => (
            <div key={st.label} style={{ display: "flex", flexDirection: "column", flex: 1, background: COLORS.surface, borderRadius: 20, padding: "24px 28px" }}>
              <div style={{ display: "flex", fontSize: 20, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 2 }}>{st.label}</div>
              <div style={{ display: "flex", fontSize: 52, fontWeight: 700, color: st.color, marginTop: 8, letterSpacing: -1 }}>{st.value}</div>
            </div>
          ))}
        </div>
      ) : (
        <div
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto", background: COLORS.surface, borderRadius: 20, padding: "36px 36px" }}
        >
          <div style={{ display: "flex", fontSize: 40, fontWeight: 700, color: COLORS.accent }}>Open to see live estimates</div>
          <div style={{ display: "flex", fontSize: 40, color: COLORS.accent }}>→</div>
        </div>
      )}
      <div style={{ display: "flex", fontSize: 18, color: COLORS.faint, marginTop: 28 }}>
        Estimates from past data. Fees are not profit. Unofficial community tool, not affiliated with Metric.
      </div>
    </div>
  );
}
