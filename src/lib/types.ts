export type ChainId = 1 | 56 | 4663;

export const CHAINS: Record<number, { name: string; short: string }> = {
  1: { name: "Ethereum", short: "ETH" },
  56: { name: "BNB Chain", short: "BNB" },
  4663: { name: "Robinhood Chain", short: "RH" },
};
export const SUPPORTED_CHAINS = Object.keys(CHAINS).map(Number);

export type Tier = "green" | "yellow" | "red" | "unknown";

/** Normalized pool metadata (from /evm/metadata or /evm/{chain}/{pool}/metadata). */
export interface Pool {
  chainId: number;
  poolAddress: string;
  pair: string;
  token0: { address: string; symbol: string; decimals: number; logoUrl?: string; fiatPrice: number };
  token1: { address: string; symbol: string; decimals: number; logoUrl?: string; fiatPrice: number };
  tvlFiat: number;
  aprBps7d: number | null;
  tradingPnlAprBps7d: number | null;
  curBinIdx: number;
  tier: Tier;
  tierRaw: string | null;
  reasonCodes: string[];
  verifiedAdmin: boolean;
  adminUsername: string | null;
  priceProviderStatus: string | null;
  priceProviderCooldown: { value: number | null; never: boolean };
  pauseLevel: number | null;
  spreadAdminFeeE6: number | null;
  spreadProtocolFeeE6: number | null;
  /** Pool-level daily LP fees in USD derived from the 24h analytics, if present. */
  lpFees24hFiat: number | null;
  volume24hFiat: number | null;
}

/** Raw per-token stats of a bin from /analytics/bins. */
export interface RawBinToken {
  volumeFiat?: string | number;
  lpFeesFiat?: string | number;
  avgLiquidityFiat?: string | number;
  reserveFiat?: string | number;
  [k: string]: unknown;
}

export interface RawBin {
  bin: string | number;
  swapCount?: string | number;
  totalShares?: string | number;
  lengthE6?: string | number;
  addFeeBuyE6?: string | number;
  addFeeSellE6?: string | number;
  token0?: RawBinToken;
  token1?: RawBinToken;
  aprBps?: string | number | null;
  pnlAprBps?: string | number | null;
}

export interface RawBinsResponse {
  window: { fromTs: string | number; toTs: string | number };
  curBinIdx: string | number;
  bins: RawBin[];
}

export type Period = "24h" | "7d" | "30d";
export type Strategy = "uniform" | "curve" | "fee";
