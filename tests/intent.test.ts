import { describe, expect, it } from "vitest";
import { binsAround, matchPool, parseIntent, parseNumber, parseText, understoodAnything, type ParsedIntent } from "@/lib/intent";
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
