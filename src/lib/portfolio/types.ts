import type { Tier } from "../types";
import type { Insight, RangeStatus } from "./model";

export interface PositionBinView {
  idx: number;
  share: number;
  valueUsd: number;
  feesUsd: number;
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
  feesUsd: number;
  hodlUsd: number | null;
  pnlUsd: number | null;
  pnlApprox: boolean;
  feeApr: number | null;
  netApr: number | null;
  status: RangeStatus;
  insights: Insight[];
  firstDepositTs: number | null;
  windowDays: number;
  scale: { confirmed: boolean; impliedExp0: number | null; impliedExp1: number | null };
}

export interface PortfolioSummary {
  valueUsd: number;
  feesUsd: number;
  pnlUsd: number | null;
  pnlApprox: boolean;
  feeApr: number | null;
  netApr: number | null;
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
