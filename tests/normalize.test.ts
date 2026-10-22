import { describe, expect, it } from "vitest";
import { normalizePool, parsePoolPage } from "@/lib/normalize";
import { safeInt } from "@/lib/num";
import { providerHealth, reasonText } from "@/lib/risk";

describe("safeInt", () => {
  it("treats >= 2^53 as never", () => {
    expect(safeInt("18446744073709551615")).toEqual({ value: null, never: true });
    expect(safeInt(18446744073709551615)).toEqual({ value: null, never: true });
    expect(safeInt("300")).toEqual({ value: 300, never: false });
    expect(safeInt(undefined)).toEqual({ value: null, never: false });
  });
});

describe("normalizePool", () => {
  it("reads flat token fields and classification", () => {
    const p = normalizePool({
      pair: "SKHYB/USDT",
      poolAddress: "0xabc",
      chain: 56,
      token0: "0x1", token0Symbol: "SKHYB", token0Decimals: 18, token0FiatPrice: "132.5",
      token1: "0x2", token1Symbol: "USDT", token1Decimals: "18", token1FiatPrice: 1,
      tvlFiat: "12345.6",
      aprBps7d: "1234",
      tradingPnlAprBps7d: -50,
      curBinIdx: "-1",
      classificationSummary: { tierQualification: "TIER_RED", reasonCodes: ["LOW_TVL"] },
      verifiedAdmin: true,
      priceProviderCooldownSecs: "18446744073709551615",
    })!;
    expect(p.chainId).toBe(56);
    expect(p.token0).toMatchObject({ address: "0x1", symbol: "SKHYB", fiatPrice: 132.5 });
    expect(p.token1.decimals).toBe(18);
    expect(p.tier).toBe("red");
    expect(p.curBinIdx).toBe(-1);
    expect(p.priceProviderCooldown.never).toBe(true);
  });

  it("accepts chain names and page envelopes", () => {
    expect(normalizePool({ poolAddress: "0x1", chain: "bsc" })!.chainId).toBe(56);
    expect(parsePoolPage({ pools: [1, 2], nextOffset: 500 })).toEqual({ items: [1, 2], nextOffset: 500 });
    expect(parsePoolPage([1])).toEqual({ items: [1], nextOffset: null });
  });
});

describe("risk copy", () => {
  it("translates reason codes", () => {
    expect(reasonText("LOW_TVL")).toMatch(/Low total value locked/);
    expect(reasonText("someNewCode")).toBe("Some new code.");
    expect(providerHealth("UNHEALTHY")).toBe("bad");
    expect(providerHealth("Healthy")).toBe("ok");
  });
});
