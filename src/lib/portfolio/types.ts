import type { Tier } from "../types";
import type { Insight, RangeStatus } from "./model";

export interface PositionBinView {
  idx: number;
  share: number;
  valueUsd: number;
  feesUsd: number;
  dailyFeesUsd: number;
  netUsd: number | null;
  aprBps: number | null;
  pnlAprBps: number | null;
  midPct: number;
}

export interface PositionView {
  chainId: number;
  pool: string;
  pair: string;
  token0: { symbol: string; logoUrl?: string };
  token1: { symbol: string; logoUrl?: string };
  tier: Tier;
  isPrivate: boolean;
  salt: string;
  curBinIdx: number;
  /** Every bin the position touched; valueUsd 0 where it no longer holds shares. */
  bins: PositionBinView[];
  /** Lowest..highest bin still holding shares. */
  range: { from: number; to: number } | null;
  valueUsd: number;
  /** Est. fees since deposit (capped at the 7d window), from each bin's 7d fee APR × your value. */
  feesUsd: number;
  /** Est. net (fees + price moves) over the same time, from each bin's 7d net APR; null without data. */
  estNetUsd: number | null;
  hodlUsd: number | null;
  pnlUsd: number | null;
  pnlApprox: boolean;
  /** PnL vs HODL annualized (fraction); null when held < 1 day. */
  pnlAnnualized: number | null;
  /** Value-weighted 7d fee APR of your bins (consistent with feesUsd). */
  yourFeeApr: number | null;
  /** The bins' own 7d net APR (pool history, value-weighted by your holdings). */
  binsNetApr: number | null;
  heldDays: number | null;
  status: RangeStatus;
  /** The pool had no trades in the analytics window: the position earns nothing regardless of range. */
  noTrades?: boolean;
  insights: Insight[];
  firstDepositTs: number | null;
  windowDays: number;
  scale: { confirmed: boolean; impliedExp0: number | null; impliedExp1: number | null };
}

export interface PortfolioSummary {
  valueUsd: number;
  feesUsd: number;
  hodlUsd: number | null;
  pnlUsd: number | null;
  pnlApprox: boolean;
  pnlAnnualized: number | null;
  yourFeeApr: number | null;
  binsNetApr: number | null;
  estNetUsd: number | null;
  /** HODL-weighted average holding time. */
  heldDays: number | null;
  count: number;
}

export interface PortfolioResponse {
  wallet: string;
  positions: PositionView[];
  /** Positions found in logs that no longer hold any shares. */
  closed: number;
  summary: PortfolioSummary;
  errors: { chainId: number; message: string }[];
  generatedAt: number;
}
