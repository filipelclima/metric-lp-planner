import { describe, expect, it } from "vitest";
import { parseBins } from "@/lib/calc";
import {
  ambiguityTitle,
  binsAround,
  compactUsd,
  distinctRange,
  matchPool,
  parseIntent,
  parseNumber,
  parseText,
  poolChipLabel,
  poolRiskWarning,
  shortAddress,
  understoodAnything,
  type ParsedIntent,
} from "@/lib/intent";
import { sharePreset, widerRange } from "@/lib/rangeInputs";
import type { Pool } from "@/lib/types";

/** Synthetic pools (fake addresses). */
let n = 0;
function pool(pair: string, chainId: number, tvl: number): Pool {
  const [a, b] = pair.split("/");
  n++;
  return {
    chainId,
    poolAddress: `0x${String(n).padStart(40, "0")}`,
    pair,
    token0: { address: "0x1", symbol: a, decimals: 18, fiatPrice: 1 },
    token1: { address: "0x2", symbol: b, decimals: 18, fiatPrice: 1 },
    tvlFiat: tvl,
    aprBps7d: 1000,
  } as unknown as Pool;
}
const AI_RH = pool("AI/USDG", 4663, 1_200_000);
const AI_ETH = pool("AI/USDG", 1, 40_000);
const SK_BNB = pool("SKHYB/USDT", 56, 500_000);
const SK_RH = pool("SKHYB/USDT", 4663, 400_000);
const SKHYB_USDC = pool("SKHYB/USDC", 56, 50_000);
const WETH_USDC = pool("WETH/USDC", 1, 5_000_000);
const NVDA = pool("NVDAB/USDT", 56, 420_000);
const POOLS = [AI_RH, AI_ETH, SK_BNB, SK_RH, SKHYB_USDC, WETH_USDC, NVDA];
const SYMBOLS = new Set(POOLS.flatMap((p) => [p.token0.symbol, p.token1.symbol]));

const parse = (t: string) => parseText(t, SYMBOLS);
/** The parsed values without notes/unknown, for compact assertions. */
const pick = (i: ParsedIntent) => Object.fromEntries(Object.entries(i).filter(([k]) => k !== "notes" && k !== "unknown"));

describe("parseText: the main sentence", () => {
  it('"I want to deposit 200 dollars on AI/USDG with a medium range"', () => {
    const i = parse("I want to deposit 200 dollars on AI/USDG with a medium range");
    expect(pick(i)).toEqual({ amount: 200, pairQuery: ["AI", "USDG"], range: "medium" });
    expect(i.unknown).toEqual([]);
  });

  it("the placeholder example", () => {
    expect(pick(parse("Deposit $200 on AI/USDG with a medium range for 60 days"))).toEqual({ amount: 200, pairQuery: ["AI", "USDG"], range: "medium", days: 60 });
  });
});

describe("amounts", () => {
  it.each([
    ["$200", 200],
    ["200$", 200],
    ["200 dollars", 200],
    ["200 usd", 200],
    ["200 bucks", 200],
    ["1.5k on WETH/USDC", 1500],
    ["$2,000 on WETH/USDC", 2000],
    ["deposit 750 on WETH/USDC", 750],
  ])("%s", (text, amount) => {
    expect(parse(text).amount).toBe(amount);
  });

  it("€ is read as USD, with a note", () => {
    const i = parse("€300 on WETH/USDC");
    expect(i.amount).toBe(300);
    expect(i.notes.join(" ")).toMatch(/€ read as US dollars/);
  });

  it("number parsing: thousands separators vs decimals", () => {
    expect(parseNumber("2,000")).toBe(2000);
    expect(parseNumber("2.000")).toBe(2000);
    expect(parseNumber("1,5")).toBe(1.5);
    expect(parseNumber("1.5")).toBe(1.5);
  });

  it("missing amount stays undefined", () => {
    expect(parse("AI/USDG wide range for 30 days").amount).toBeUndefined();
  });
});

describe("pairs", () => {
  it.each([
    ["AI-USDG", ["AI", "USDG"]],
    ["ai usdg narrow", ["AI", "USDG"]],
    ["AI and USDG", ["AI", "USDG"]],
    ["on SKHYB", ["SKHYB"]],
    ["skhyb/usdt", ["SKHYB", "USDT"]],
  ])("%s", (text, q) => {
    expect(parse(text).pairQuery).toEqual(q);
  });

  it("typos (≤ 1 edit on symbols of 3+ chars)", () => {
    expect(parse("500 on SKHYV and USDT").pairQuery).toEqual(["SKHYV", "USDT"]);
    expect(matchPool(parse("500 on SKHYV/USDT on bnb"), POOLS)).toMatchObject({ kind: "one", pool: SK_BNB });
    expect(matchPool(parse("nvdab/usdtt"), POOLS)).toMatchObject({ kind: "one", pool: NVDA });
  });
});

describe("chains, ranges, bins, durations, distribution, period", () => {
  it("chain words", () => {
    expect(parse("SKHYB/USDT on bsc").chain).toBe(56);
    expect(parse("SKHYB/USDT on binance").chain).toBe(56);
    expect(parse("WETH/USDC on mainnet").chain).toBe(1);
    expect(parse("AI/USDG on robinhood").chain).toBe(4663);
    expect(parse("AI/USDG rh").chain).toBe(4663);
  });

  it("range words", () => {
    expect(parse("tight range").range).toBe("narrow");
    expect(parse("balanced").range).toBe("medium");
    expect(parse("safe range").range).toBe("wide");
    expect(parse("very wide please").range).toBe("wider");
    expect(parse("max range").range).toBe("wider");
    expect(parse("a 95% range").range).toBe("wide");
  });

  it("explicit bins", () => {
    expect(parse("#-3 to #2").bins).toEqual({ from: -3, to: 2 });
    expect(parse("bins -3 to 2").bins).toEqual({ from: -3, to: 2 });
    expect(parse("from -3 to +2").bins).toEqual({ from: -3, to: 2 });
    expect(parse("from 100 to 200").bins).toBeUndefined();
  });

  it("width around the price", () => {
    expect(parse("±0.1%").aroundPct).toBe(0.1);
    expect(parse("0.1% around the price").aroundPct).toBe(0.1);
    expect(binsAround(0.1, 0.02)).toEqual({ from: -5, to: 4 }); // edges −0.10% … +0.10%
    expect(binsAround(0.05, 0.03)).toEqual({ from: -2, to: 1 }); // rounds outward
  });

  it.each([
    ["30 days", 30],
    ["60d", 60],
    ["2 months", 60],
    ["3 months", 90],
    ["a quarter", 90],
    ["1 week", 7],
    ["a year", 365],
  ])("duration: %s", (text, days) => {
    expect(parse(text).days).toBe(days);
  });

  it("distribution", () => {
    expect(parse("spread evenly").distribution).toBe("uniform");
    expect(parse("concentrated").distribution).toBe("curve");
    expect(parse("fee-weighted").distribution).toBe("fee");
    expect(parse("weighted by fees").distribution).toBe("fee");
  });

  it("data period, not confused with duration", () => {
    expect(parse("using 24h data").period).toBe("24h");
    expect(parse("based on last week").period).toBe("7d");
    const i = parse("for 60 days, 30 days of data");
    expect(i.period).toBe("30d");
    expect(i.days).toBe(60);
  });
});

describe("other languages", () => {
  it("Portuguese", () => {
    expect(pick(parse("Quero depositar 200 dólares em AI/USDG com faixa média por 2 meses"))).toEqual({ amount: 200, pairQuery: ["AI", "USDG"], range: "medium", days: 60 });
    expect(pick(parse("depósito de 500 dolares na SKHYB/USDT estreito 30 dias"))).toEqual({ amount: 500, pairQuery: ["SKHYB", "USDT"], range: "narrow", days: 30 });
  });
  it("Spanish", () => {
    expect(pick(parse("Depositar 300 dólares en WETH/USDC rango amplio 90 días"))).toEqual({ amount: 300, pairQuery: ["WETH", "USDC"], range: "wide", days: 90 });
    expect(parse("rango estrecho 3 meses").range).toBe("narrow");
    expect(parse("medio").range).toBe("medium");
  });
  it("French", () => {
    expect(pick(parse("Déposer 400 dollars sur AI/USDG, plage étroite, 2 mois"))).toEqual({ amount: 400, pairQuery: ["AI", "USDG"], range: "narrow", days: 60 });
  });
  it("Turkish", () => {
    expect(pick(parse("AI/USDG 250 dolar geniş 3 ay"))).toEqual({ amount: 250, pairQuery: ["AI", "USDG"], range: "wide", days: 90 });
  });
  it("Chinese", () => {
    expect(pick(parse("在 AI/USDG 存入 200 美元，中等范围，60天"))).toEqual({ amount: 200, pairQuery: ["AI", "USDG"], range: "medium", days: 60 });
    expect(parse("SKHYB/USDT 窄 两个月").days).toBe(60);
  });
  it("Vietnamese", () => {
    expect(pick(parse("Gửi 150 đô vào AI/USDG khoảng hẹp 30 ngày"))).toEqual({ amount: 150, pairQuery: ["AI", "USDG"], range: "narrow", days: 30 });
  });
  it("Russian", () => {
    expect(pick(parse("Внести 1000 долларов в WETH/USDC, широкий диапазон, 3 месяца"))).toEqual({ amount: 1000, pairQuery: ["WETH", "USDC"], range: "wide", days: 90 });
    expect(parse("средний 2 недели").days).toBe(14);
  });
});

describe("matchPool", () => {
  it("one pool holds > 80% of the TVL → picked, with a note", () => {
    const m = matchPool(parse("200 on AI/USDG"), POOLS);
    expect(m).toMatchObject({ kind: "one", pool: AI_RH, note: "Picked the largest pool." });
  });

  it("same pair on 2 chains with similar TVL → the user chooses", () => {
    const m = matchPool(parse("SKHYB/USDT medium"), POOLS);
    expect(m.kind).toBe("choose");
    if (m.kind === "choose") expect(m.options).toEqual([SK_BNB, SK_RH]);
  });

  it("a named chain resolves the ambiguity", () => {
    expect(matchPool(parse("SKHYB/USDT on robinhood"), POOLS)).toMatchObject({ kind: "one", pool: SK_RH });
  });

  it("token order doesn't matter", () => {
    expect(matchPool(parse("USDC/WETH"), POOLS)).toMatchObject({ kind: "one", pool: WETH_USDC });
  });

  it("single token → largest pool containing it", () => {
    const m = matchPool(parse("1k on SKHYB"), POOLS);
    expect(m).toMatchObject({ kind: "one", pool: SK_BNB });
    if (m.kind === "one") expect(m.note).toMatch(/largest of 3 pools with SKHYB/);
  });

  it("not found → 3 closest suggestions", () => {
    const m = matchPool(parse("200 on DOGE/USDT"), POOLS);
    expect(m.kind).toBe("notFound");
    if (m.kind === "notFound") {
      expect(m.suggestions).toHaveLength(3);
      expect(m.suggestions.every((p) => p.token1.symbol === "USDT")).toBe(true);
    }
  });

  it("no pair mentioned → none (keep the current pool)", () => {
    expect(matchPool(parse("$500 wide 90 days"), POOLS)).toEqual({ kind: "none" });
  });
});

describe("garbage and the interface", () => {
  it("garbage input understands nothing and lists unknown words", () => {
    const i = parse("blorp zzz qwerty");
    expect(understoodAnything(i)).toBe(false);
    expect(i.unknown).toEqual(["blorp", "zzz", "qwerty"]);
    expect(understoodAnything(parse(""))).toBe(false);
    expect(understoodAnything(parse("!!! ??? ..."))).toBe(false);
  });

  it("a lone number is read as the deposit, and said out loud", () => {
    const i = parse("500 on WETH/USDC");
    expect(i.amount).toBe(500);
    expect(i.notes.join(" ")).toMatch(/Read 500 as the deposit/);
  });

  it("parseIntent runs the rule parser behind a swappable interface", async () => {
    const r = await parseIntent("Deposit $200 on AI/USDG with a medium range for 60 days", POOLS);
    expect(r.intent.amount).toBe(200);
    expect(r.match).toMatchObject({ kind: "one", pool: AI_RH });
    const custom = await parseIntent("anything", POOLS, () => ({ intent: { amount: 1, notes: [], unknown: [] }, match: { kind: "none" } }));
    expect(custom.intent.amount).toBe(1);
  });
});

describe("fix: ambiguity wording and chips", () => {
  const a = { ...pool("AI/USDG", 4663, 2_300), poolAddress: "0xA9000000000000000000000000000000000000071", verifiedAdmin: false, adminUsername: null, tier: "red", analytics24h: { volumeFiat: 12_000 } } as unknown as Pool;
  const b = { ...pool("AI/USDG", 4663, 3_100), poolAddress: "0xB4000000000000000000000000000000000000c2", verifiedAdmin: true, adminUsername: "metricdao", tier: "green", analytics24h: { volumeFiat: 800 } } as unknown as Pool;

  it("same chain → 'That pair has 2 pools on Robinhood'", () => {
    expect(ambiguityTitle([a, b])).toBe("That pair has 2 pools on Robinhood. Which one?");
  });
  it("different chains keep the chain wording", () => {
    expect(ambiguityTitle([SK_BNB, SK_RH])).toBe("That pair is on 2 chains (BNB, Robinhood). Which pool?");
  });
  it("chips tell same-pair pools apart: TVL, 24h volume, curator, short address", () => {
    expect(shortAddress("0xA9000000000000000000000000000000000000071")).toBe("0xA9…71");
    expect(poolChipLabel(a)).toBe("AI/USDG · RH · TVL $2.3k · vol $12k · Unverified · 0xA9…71");
    expect(poolChipLabel(b)).toBe("AI/USDG · RH · TVL $3.1k · vol $800 · metricdao ✓ · 0xB4…c2");
  });
  it("two small same-chain pools → the user chooses (nothing ≥ $10k to prefer)", () => {
    const m = matchPool(parseText("AI/USDG", new Set(["AI", "USDG"])), [a, b]);
    expect(m.kind).toBe("choose");
  });
});

describe("fix: small / risky pools", () => {
  it("compact USD", () => {
    expect([800, 2_300, 3_100, 10_000, 12_000, 50_000, 1_200_000].map(compactUsd)).toEqual(["$800", "$2.3k", "$3.1k", "$10k", "$12k", "$50k", "$1.2M"]);
  });
  it("tiny High-Risk pool (the example)", () => {
    expect(poolRiskWarning({ tvlFiat: 2_300, tier: "red" }, 200, 30)).toBe(
      "⚠ Tiny High-Risk pool ($2.3k TVL): your $200 would be ~9% of it, so these estimates (≈3,000% APR) are unreliable.",
    );
  });
  it("deposit > 10% of TVL on an otherwise fine pool", () => {
    expect(poolRiskWarning({ tvlFiat: 50_000, tier: "green" }, 10_000, 0.4)).toBe(
      "⚠ Small pool ($50k TVL): your $10k would be ~20% of it, so these estimates (≈40% APR) are unreliable.",
    );
  });
  it("High Risk tier on a big pool", () => {
    expect(poolRiskWarning({ tvlFiat: 1_200_000, tier: "red" }, 1_000, 0.6)).toBe("⚠ High-Risk pool ($1.2M TVL): Metric rates it High Risk, so these estimates (≈60% APR) may not hold.");
  });
  it("no warning for a normal deposit on a normal pool; exactly 10% doesn't warn", () => {
    expect(poolRiskWarning({ tvlFiat: 500_000, tier: "yellow" }, 1_000, 0.2)).toBeNull();
    expect(poolRiskWarning({ tvlFiat: 100_000, tier: "green" }, 10_000, 0.2)).toBeNull();
  });
  it("matching prefers pools ≥ $10k TVL, and falls back to small ones only if nothing else matches", () => {
    const tiny = pool("ZED/USDT", 56, 3_000);
    const big = pool("ZED/USDT", 4663, 20_000);
    const tiny2 = pool("ZED/USDT", 1, 8_000);
    // 20k vs 3k + 8k: without the preference, 20k is 65% of the TVL → the user would be asked
    expect(matchPool(parseText("ZED/USDT", new Set(["ZED", "USDT"])), [tiny, big, tiny2])).toMatchObject({ kind: "one", pool: big });
    // only small pools: fall back to them (8k is 73% of 11k, under the 80% bar → ask)
    expect(matchPool(parseText("ZED/USDT", new Set(["ZED", "USDT"])), [tiny, tiny2]).kind).toBe("choose");
    expect(matchPool(parseText("ZED/USDT", new Set(["ZED", "USDT"])), [tiny2])).toMatchObject({ kind: "one", pool: tiny2 });
  });
});

describe("fix: range words stay distinct on concentrated pools", () => {
  /** bins -5..5, price at 0, volume per bin from `vol`. */
  const bins = (vol: number[]) =>
    parseBins({
      window: { fromTs: 0, toTs: 7 * 86400 },
      curBinIdx: 0,
      bins: vol.map((v, i) => ({
        bin: String(i - 5), swapCount: "1", lengthE6: 100,
        token0: { volumeFiat: v / 2, lpFeesFiat: v / 2000, avgLiquidityFiat: 500, reserveFiat: i >= 5 ? 1000 : 0 },
        token1: { volumeFiat: v / 2, lpFeesFiat: v / 2000, avgLiquidityFiat: 500, reserveFiat: i <= 5 ? 1000 : 0 },
        aprBps: 100, pnlAprBps: 50,
      })),
    });
  const allSame = bins([0, 0, 1, 40, 16, 40, 1, 1, 1, 0, 0]); // 3 bins hold 96%: 80/90/95% all = #-2…#0
  const wideIsMedium = bins([0, 0, 0, 10, 1500, 8000, 480, 5, 5, 0, 0]); // 90% = 95% = #-1…#0, 80% = #0…#0
  const spread = bins([1, 2, 4, 8, 15, 40, 15, 8, 4, 2, 1]);

  it("'wide' equal to 'medium' → the Wider preset, flagged as widened", () => {
    expect(sharePreset(wideIsMedium, 95)).toEqual(sharePreset(wideIsMedium, 90));
    expect(distinctRange("wide", wideIsMedium)).toEqual({ range: { kind: "manual", ...widerRange(wideIsMedium) }, widened: true });
    expect(distinctRange("medium", wideIsMedium)).toEqual({ range: { kind: "preset", share: 90 }, widened: false }); // 90% ≠ 80% here
  });
  it("'medium' equal to 'narrow' → narrow ± 1 bin", () => {
    expect(distinctRange("medium", allSame)).toEqual({ range: { kind: "manual", from: -3, to: 1 }, widened: true });
    expect(distinctRange("narrow", allSame)).toEqual({ range: { kind: "preset", share: 80 }, widened: false });
  });
  it("all three distinct on a concentrated pool", () => {
    const r = (["narrow", "medium", "wide"] as const).map((w) => {
      const x = distinctRange(w, allSame).range;
      return x.kind === "manual" ? `${x.from}:${x.to}` : `${sharePreset(allSame, x.share).from}:${sharePreset(allSame, x.share).to}`;
    });
    expect(new Set(r).size).toBe(3);
  });
  it("normal pools keep the plain presets", () => {
    for (const w of ["narrow", "medium", "wide"] as const) expect(distinctRange(w, spread).widened).toBe(false);
  });
});

describe("regression: pairs whose only pools are under $10k (live AI/USDG on Robinhood)", () => {
  const small1 = pool("AI/USDG", 4663, 2_246);
  const small2 = pool("AI/USDG", 4663, 1_481);
  const zeros = [pool("AI/USDG", 4663, 0), pool("AI/USDG", 4663, 0), pool("AI/USDG", 4663, 0)];
  const big = pool("WETH/USDC", 1, 5_000_000);
  const live = [big, ...zeros, small2, small1];
  const sentence = "I want to deposit 200 dollars on AI/USDG with a medium range";

  it("the exact sentence → chips for the two small pools, largest first, no $0 pools", async () => {
    const { intent, match } = await parseIntent(sentence, live);
    expect(intent.amount).toBe(200);
    expect(match.kind).toBe("choose");
    if (match.kind === "choose") expect(match.options).toEqual([small1, small2]);
  });

  it("a dominant small pool is picked, saying only small pools have the pair", () => {
    const m = matchPool(parseText("AI/USDG", new Set(["AI", "USDG"])), [big, ...zeros, small1, pool("AI/USDG", 4663, 100)]);
    expect(m).toMatchObject({ kind: "one", pool: small1 });
    if (m.kind === "one") {
      expect(m.note).toMatch(/Only small pools \(under \$10k TVL\) have this pair/);
      expect(m.alternatives.every((p) => p.tvlFiat > 0)).toBe(true);
    }
  });

  it("$0 pools are used only when nothing else has the pair", () => {
    const m = matchPool(parseText("AI/USDG", new Set(["AI", "USDG"])), [big, ...zeros]);
    expect(m.kind).toBe("choose");
    if (m.kind === "choose") expect(m.options).toHaveLength(3);
  });

  it("a ≥ $10k pool is ranked first but small ones stay in the chips", () => {
    const mid = pool("AI/USDG", 1, 12_000);
    const mid2 = pool("AI/USDG", 56, 11_000);
    const m = matchPool(parseText("AI/USDG", new Set(["AI", "USDG"])), [small1, mid2, ...zeros, mid, small2]);
    expect(m.kind).toBe("choose");
    if (m.kind === "choose") expect(m.options).toEqual([mid, mid2, small1, small2]);
  });

  it("the picked tiny pool gets the risk warning", () => {
    expect(poolRiskWarning({ tvlFiat: small1.tvlFiat, tier: "red" }, 200, 30)).toMatch(/^⚠ Tiny High-Risk pool \(\$2\.2k TVL\): your \$200 would be ~9% of it/);
  });

  it("no pools loaded → not found with no suggestions (the UI then says 'Couldn't find … on Metric.')", () => {
    expect(matchPool(parseText(sentence), [])).toEqual({ kind: "notFound", query: "AI/USDG", suggestions: [] });
  });
});
