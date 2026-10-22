import { safeInt, toNum } from "./num";
import { CHAINS, type Pool, type PriceProviderStatus, type RawChainsResponse, type RawPool, type RawPoolPage, type Tier } from "./types";

const TIERS: Tier[] = ["green", "yellow", "red", "black", "unclassified"];
const PROVIDER_STATUSES: PriceProviderStatus[] = ["healthy", "feed_down", "pool_refused", "pool_paused", "unknown"];

/** Chains keyed on chainId (names vary in casing, so they're never used as keys). */
export function parseChains(body: RawChainsResponse): Map<number, string> {
  return new Map(body.chains.map((c) => [c.chainId, c.name]));
}

/** One page of GET /evm/metadata: `{ data, total, nextOffset }`. */
export function parsePoolPage(body: RawPoolPage): { items: RawPool[]; total: number; nextOffset: number | null } {
  return { items: body.data, total: body.total, nextOffset: body.nextOffset };
}

/**
 * Normalizes a pool. The chainId comes from the request (chainIds filter or URL path),
 * never from the pool's `chain` field.
 */
export function normalizePool(o: RawPool, chainId: number): Pool {
  const tier = TIERS.includes(o.classificationSummary?.tierQualification) ? o.classificationSummary.tierQualification : "unclassified";
  const sl = o.extensionDetails?.stopLoss;
  const a = o.analytics24h;
  return {
    chainId,
    poolAddress: o.poolAddress,
    pair: o.pair,
    token0: { address: o.token0, symbol: o.token0Symbol, decimals: o.token0Decimals, logoUrl: o.token0LogoUrl, fiatPrice: o.token0FiatPrice ?? null },
    token1: { address: o.token1, symbol: o.token1Symbol, decimals: o.token1Decimals, logoUrl: o.token1LogoUrl, fiatPrice: o.token1FiatPrice ?? null },
    tvlFiat: o.tvlFiat ?? 0,
    aprBps7d: o.aprBps7d ?? null,
    tradingPnlAprBps7d: o.tradingPnlAprBps7d ?? null,
    curBinIdx: o.curBinIdx ?? 0,
    tier,
    reasonCodes: o.classificationSummary?.reasonCodes ?? [],
    isPrivate: o.depositWhitelistingEnabled === true,
    verifiedAdmin: o.verifiedAdmin === true,
    adminUsername: o.adminUsername ?? null,
    priceProviderStatus: PROVIDER_STATUSES.includes(o.priceProviderStatus) ? o.priceProviderStatus : "unknown",
    priceProviderCooldown: safeInt(o.priceProviderCooldownSecs),
    pauseLevel: o.pauseLevel ?? 0,
    lockedPricing: o.lockedPricing === true,
    spreadAdminFeeE6: o.spreadAdminFeeE6,
    spreadProtocolFeeE6: o.spreadProtocolFeeE6,
    stopLoss: sl
      ? { drawdownE6: toNum(sl.drawdownE6), decayPerSecondE18: toNum(sl.decayPerSecondE18), timelockSecs: toNum(sl.timelockSecs) }
      : null,
    analytics24h: a
      ? { fromTs: a.fromTs, toTs: a.toTs, feesFiat: a.feesFiat, tvlFiat: a.tvlFiat, volumeFiat: a.volumeFiat, aprBps: a.aprBps }
      : null,
  };
}

export const chainName = (id: number) => CHAINS[id]?.name ?? `Chain ${id}`;
