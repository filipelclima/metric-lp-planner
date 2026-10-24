export const CHAINS: Record<number, { name: string; short: string }> = {
  1: { name: "Ethereum", short: "ETH" },
  56: { name: "BNB Chain", short: "BNB" },
  4663: { name: "Robinhood Chain", short: "RH" },
};
export const SUPPORTED_CHAINS = Object.keys(CHAINS).map(Number);

export type Tier = "green" | "yellow" | "red" | "black" | "unclassified";

export type PriceProviderStatus = "healthy" | "feed_down" | "pool_refused" | "pool_paused" | "unknown";

// ---------- raw API shapes (api.metric.xyz/public/v1) ----------

/** GET /chains */
export interface RawChainsResponse {
  chains: { type: string; chainId: number; name: string }[];
}

/** One pool from GET /evm/metadata (list) or GET /evm/{chainId}/{pool}/metadata. Optional fields are omitted when absent. */
export interface RawPool {
  pair: string;
  chain: unknown;
  contractVersion: string;
  poolAddress: string;
  priceProviderAddress: string;
  token0: string;
  token1: string;
  token0Symbol: string;
  token1Symbol: string;
  token0Decimals: number;
  token1Decimals: number;
  token0LogoUrl?: string;
  token1LogoUrl?: string;
  token0FiatPrice: number | null;
  token1FiatPrice: number | null;
  creator: string;
  admin: string;
  adminUsername: string | null;
  verifiedAdmin: boolean;
  spreadProtocolFeeE6: number;
  spreadAdminFeeE6: number;
  protocolNotionalFeeE8: number;
  adminNotionalFeeE8: number;
  aprBps7d?: number;
  tradingPnlAprBps7d?: number;
  lockedPricing: boolean;
  pauseLevel?: number;
  curBinIdx?: number;
  priceProviderStatus: PriceProviderStatus;
  priceProviderCooldownSecs: number | string;
  classificationSummary: { tierQualification: Tier; reasonCodes: string[] };
  extensionDetails?: {
    stopLoss?: { drawdownE6: number | string; decayPerSecondE18: number | string; timelockSecs: number | string };
    priceVelocity?: { maxChangePerBlockE18: number | string };
  };
  depositWhitelistingEnabled: boolean;
  tvlFiat?: number;
  analytics24h?: {
    fromTs: number;
    toTs: number;
    swapTxCount: number | string;
    volumeFiat: number;
    feesFiat: number;
    tvlFiat: number;
    aprBps: number;
    token0: Record<string, unknown>;
    token1: Record<string, unknown>;
  };
}

/** GET /evm/metadata envelope. */
export interface RawPoolPage {
  data: RawPool[];
  total: number;
  nextOffset: number | null;
}

/** Per-token stats of a bin. Raw fields are decimal strings; some bins omit volume. */
export interface RawBinToken {
  volumeRaw?: string;
  lpFeesRaw?: string;
  avgLiquidityRaw?: string;
  reserveRaw?: string;
  volumeFiat?: number;
  lpFeesFiat: number;
  avgLiquidityFiat: number;
  reserveFiat: number;
}

export interface RawBin {
  bin: string;
  swapCount: string;
  hasBaseline?: boolean;
  /** "0" = empty bin. */
  totalShares?: string;
  lengthE6: number;
  addFeeBuyE6?: number;
  addFeeSellE6?: number;
  token0: RawBinToken;
  token1: RawBinToken;
  aprBps: number;
  pnlAprBps: number | null;
}

/** GET /evm/{chainId}/{pool}/analytics/bins (undocumented, used by app.metric.xyz). */
export interface RawBinsResponse {
  pair?: string;
  chain?: string;
  period?: string;
  fiatAvailable?: boolean;
  fiatCurrency?: string;
  window: { fromTs: number; toTs: number };
  curBinIdx: number;
  bins: RawBin[];
}

// ---------- normalized ----------

export interface PoolToken {
  address: string;
  symbol: string;
  decimals: number;
  logoUrl?: string;
  /** null when Metric has no fiat price for the token. */
  fiatPrice: number | null;
}

export interface Pool {
  chainId: number;
  poolAddress: string;
  pair: string;
  token0: PoolToken;
  token1: PoolToken;
  tvlFiat: number;
  aprBps7d: number | null;
  tradingPnlAprBps7d: number | null;
  curBinIdx: number;
  tier: Tier;
  reasonCodes: string[];
  /** Deposit whitelisting enabled: shown as "Private" instead of a tier. */
  isPrivate: boolean;
  verifiedAdmin: boolean;
  adminUsername: string | null;
  /** Curator (admin) address; shown shortened when the curator has no username. */
  admin?: string | null;
  priceProviderStatus: PriceProviderStatus;
  priceProviderCooldown: { value: number | null; never: boolean };
  pauseLevel: number;
  lockedPricing: boolean;
  spreadAdminFeeE6: number;
  spreadProtocolFeeE6: number;
  stopLoss: { drawdownE6: number; decayPerSecondE18: number; timelockSecs: number } | null;
  /** Pool-level 24h analytics (the fallback when per-bin data is unavailable). */
  analytics24h: { fromTs: number; toTs: number; feesFiat: number; tvlFiat: number; volumeFiat: number; aprBps: number } | null;
}

export type Period = "24h" | "7d" | "30d";
export type Strategy = "uniform" | "curve" | "fee";
