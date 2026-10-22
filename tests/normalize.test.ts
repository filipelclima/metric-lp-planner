import { describe, expect, it } from "vitest";
import { normalizePool, parsePoolPage } from "@/lib/normalize";
import { safeInt } from "@/lib/num";
import { providerHealth, reasonText, REASONS, TIER_LABEL } from "@/lib/risk";
import type { RawPool } from "@/lib/types";

/** Pool object with the documented field set (values are illustrative). */
const rawPool: RawPool = {
  pair: "SKHYB/USDT",
  chain: "BSC",
  contractVersion: "v1",
  poolAddress: "0xee90641E7c3b4d6338Ab7f1c23Dfb979FAb5f096",
  priceProviderAddress: "0x" + "a".repeat(40),
  token0: "0x" + "1".repeat(40),
  token1: "0x" + "2".repeat(40),
  token0Symbol: "SKHYB",
  token1Symbol: "USDT",
  token0Decimals: 18,
  token1Decimals: 18,
  token0LogoUrl: "https://example.invalid/skhyb.png",
  token0FiatPrice: 132.5,
  token1FiatPrice: null,
  creator: "0x" + "c".repeat(40),
  admin: "0x" + "c".repeat(40),
  adminUsername: null,
  verifiedAdmin: false,
  spreadProtocolFeeE6: 50000,
  spreadAdminFeeE6: 100000,
  protocolNotionalFeeE8: 0,
  adminNotionalFeeE8: 0,
  tradingPnlAprBps7d: -900,
  lockedPricing: false,
  priceProviderStatus: "feed_down",
  priceProviderCooldownSecs: "18446744073709551615",
  classificationSummary: { tierQualification: "red", reasonCodes: ["stop_loss_missing", "curator_unverified"] },
  extensionDetails: { stopLoss: { drawdownE6: 150000, decayPerSecondE18: "1736111111111", timelockSecs: 3600 } },
  depositWhitelistingEnabled: false,
  tvlFiat: 84000,
  analytics24h: {
    fromTs: 1792612553,
    toTs: 1792698953,
    swapTxCount: 120,
    volumeFiat: 1e6,
    feesFiat: 150,
    tvlFiat: 83000,
    aprBps: 6596,
    token0: {},
    token1: {},
  },
};

describe("normalizePool", () => {
  const p = normalizePool(rawPool, 56);

  it("maps the documented fields", () => {
    expect(p.chainId).toBe(56);
    expect(p.token0).toEqual({ address: rawPool.token0, symbol: "SKHYB", decimals: 18, logoUrl: rawPool.token0LogoUrl, fiatPrice: 132.5 });
    expect(p.token1.fiatPrice).toBeNull();
    expect(p.tier).toBe("red");
    expect(p.reasonCodes).toEqual(["stop_loss_missing", "curator_unverified"]);
    expect(p.priceProviderStatus).toBe("feed_down");
    expect(p.priceProviderCooldown.never).toBe(true);
    expect(p.stopLoss).toEqual({ drawdownE6: 150000, decayPerSecondE18: 1736111111111, timelockSecs: 3600 });
    expect(p.analytics24h).toMatchObject({ feesFiat: 150, tvlFiat: 83000 });
    expect(p.isPrivate).toBe(false);
  });

  it("applies defaults for omitted optional fields", () => {
    const rest: Partial<RawPool> = { ...rawPool };
    for (const k of ["aprBps7d", "tradingPnlAprBps7d", "pauseLevel", "curBinIdx", "extensionDetails", "tvlFiat", "analytics24h"] as const) delete rest[k];
    const q = normalizePool(rest as RawPool, 1);
    expect(q).toMatchObject({ aprBps7d: null, tradingPnlAprBps7d: null, pauseLevel: 0, curBinIdx: 0, stopLoss: null, tvlFiat: 0, analytics24h: null });
  });

  it("takes chainId from the request, never from `chain`", () => {
    expect(normalizePool({ ...rawPool, chain: "ethereum" }, 4663).chainId).toBe(4663);
  });

  it("flags whitelisted pools as private", () => {
    expect(normalizePool({ ...rawPool, depositWhitelistingEnabled: true }, 56).isPrivate).toBe(true);
  });
});

describe("parsePoolPage", () => {
  it("reads the { data, total, nextOffset } envelope", () => {
    expect(parsePoolPage({ data: [rawPool], total: 501, nextOffset: 500 })).toEqual({ items: [rawPool], total: 501, nextOffset: 500 });
    expect(parsePoolPage({ data: [], total: 0, nextOffset: null }).nextOffset).toBeNull();
  });
});

describe("safeInt", () => {
  it("treats >= 2^53 as never", () => {
    expect(safeInt("18446744073709551615")).toEqual({ value: null, never: true });
    expect(safeInt(18446744073709551615)).toEqual({ value: null, never: true });
    expect(safeInt("300")).toEqual({ value: 300, never: false });
  });
});

describe("risk copy", () => {
  it("translates every documented reason code", () => {
    expect(Object.keys(REASONS)).toHaveLength(16);
    expect(reasonText("bin_width_exceeded")).toBe("Bins are wider than 1%");
    expect(reasonText("multiplier_token_unscaled")).toBe("Tokenized stock priced without its issuer multiplier");
    expect(reasonText("some_future_code")).toBe("some_future_code");
  });

  it("labels tiers and provider statuses", () => {
    expect(TIER_LABEL.green).toBe("Best Practices");
    expect(TIER_LABEL.yellow).toBe("Neutral");
    expect(TIER_LABEL.red).toBe("High Risk");
    expect(TIER_LABEL.black).toBe("Delisted by Metric");
    expect(providerHealth("healthy")).toBe("ok");
    expect(providerHealth("pool_paused")).toBe("bad");
    expect(providerHealth("unknown")).toBe("unknown");
  });
});
