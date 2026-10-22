import type { Period, Strategy } from "./types";

export type RangeMode = { kind: "preset"; share: 80 | 90 | 95 } | { kind: "manual"; from: number; to: number };

export interface PlannerState {
  chain: number | null;
  pool: string | null;
  amount: number;
  days: number;
  range: RangeMode;
  strategy: Strategy;
  period: Period;
}

const STRATEGIES: Strategy[] = ["uniform", "curve", "fee"];
const PERIODS: Period[] = ["24h", "7d", "30d"];
const int = (v: string | null) => (v !== null && /^-?\d+$/.test(v) ? Number(v) : null);

export function readState(q: URLSearchParams): PlannerState {
  const amount = Number(q.get("amount"));
  const days = Number(q.get("days"));
  const from = int(q.get("from"));
  const to = int(q.get("to"));
  const preset = int(q.get("preset"));
  const range: RangeMode =
    preset === 80 || preset === 90 || preset === 95
      ? { kind: "preset", share: preset }
      : from !== null && to !== null
        ? { kind: "manual", from: Math.min(from, to), to: Math.max(from, to) }
        : { kind: "preset", share: 90 };
  const pool = q.get("pool");
  return {
    chain: int(q.get("chain")),
    pool: pool && /^0x[0-9a-fA-F]{40}$/.test(pool) ? pool : null,
    amount: amount > 0 ? amount : 1000,
    days: days > 0 ? Math.min(Math.round(days), 3650) : 30,
    range,
    strategy: STRATEGIES.includes(q.get("strategy") as Strategy) ? (q.get("strategy") as Strategy) : "uniform",
    period: PERIODS.includes(q.get("period") as Period) ? (q.get("period") as Period) : "7d",
  };
}

/** Serializes state; from/to are always written (the resolved range) so links stay readable. */
export function writeState(s: PlannerState, resolved: { from: number; to: number } | null): string {
  const q = new URLSearchParams();
  if (s.chain !== null) q.set("chain", String(s.chain));
  if (s.pool) q.set("pool", s.pool);
  q.set("amount", String(s.amount));
  q.set("days", String(s.days));
  const r = s.range.kind === "manual" ? s.range : resolved;
  if (r) {
    q.set("from", String(r.from));
    q.set("to", String(r.to));
  }
  if (s.range.kind === "preset") q.set("preset", String(s.range.share));
  q.set("strategy", s.strategy);
  q.set("period", s.period);
  return q.toString();
}
