/**
 * "Describe your plan": a rule-based natural-language parser. No AI, no network, no API keys.
 * It only produces form values; every number shown afterwards still comes from calc.ts.
 *
 * Two steps, both pure:
 *   parseText(text, symbols?)  → ParsedIntent (amount, pair query, chain, range, bins, days, …)
 *   matchPool(intent, pools)   → which pool the pair query means (one / choose / not found / none)
 * `parseIntent(text, pools)` runs both behind the `IntentParser` interface, so an optional AI fallback
 * can be plugged in later without touching the UI.
 *
 * Keywords: English, Portuguese, Spanish, French, Turkish, Chinese, Vietnamese, Russian.
 */
import { fmtUsd, type BinData } from "./calc";
import { sharePreset, widerRange } from "./rangeInputs";
import { TIER_LABEL } from "./risk";
import { CHAINS, type Period, type Pool, type Strategy } from "./types";

export type RangeWord = "narrow" | "medium" | "wide" | "wider";

export interface ParsedIntent {
  /** Deposit in USD. */
  amount?: number;
  /** One or two token symbols as typed (e.g. ["AI", "USDG"] or ["SKHYB"]). */
  pairQuery?: string[];
  chain?: number;
  range?: RangeWord;
  /** Explicit bins ("#-3 to #2"). */
  bins?: { from: number; to: number };
  /** "±0.1%" / "0.1% around the price": half-width in percent units. */
  aroundPct?: number;
  days?: number;
  distribution?: Strategy;
  period?: Period;
  /** Things worth telling the user (e.g. "€ read as USD"). */
  notes: string[];
  /** Words that weren't understood (shown only when nothing was parsed). */
  unknown: string[];
}

// ---------- helpers ----------

const L = "\\p{L}\\p{N}";
/** Word boundaries that work for accented and Cyrillic letters (JS \b is ASCII-only). */
const B = `(?<![${L}])`;
const E = `(?![${L}])`;
const NUM = "(\\d{1,3}(?:[,.\\s]\\d{3})+|\\d+(?:[.,]\\d+)?)";
const SIGNED = "([+\\-−]?\\s?\\d{1,6})";

/** "2,000" / "2.000" / "2 000" → 2000; "1.5" / "1,5" → 1.5. */
export function parseNumber(raw: string): number {
  const s = raw.trim();
  if (/^\d{1,3}([,.\s]\d{3})+$/.test(s)) return Number(s.replace(/[,.\s]/g, ""));
  return Number(s.replace(",", "."));
}

const signedInt = (s: string) => {
  const t = s.replace(/\s/g, "").replace("−", "-");
  return Number(t) || 0;
};

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** Distance from a typed token to a symbol; Infinity when too far. Typos (≤ 1 edit) only for symbols of 3+ chars. */
export function symbolDistance(token: string, symbol: string): number {
  const a = token.toUpperCase();
  const b = symbol.toUpperCase();
  if (a === b) return 0;
  if (a.length < 3 || b.length < 3) return Infinity;
  const d = levenshtein(a, b);
  return d <= 1 ? d : Infinity;
}

// ---------- keyword tables ----------

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, six: 6, twelve: 12,
  um: 1, uma: 1, dois: 2, duas: 2, três: 3, tres: 3, seis: 6, un: 1, una: 1, uno: 1, dos: 2, une: 1, deux: 2, trois: 3,
  bir: 1, iki: 2, üç: 3, một: 1, hai: 2, ba: 3, один: 1, одна: 1, два: 2, две: 2, три: 3,
  一: 1, 两: 2, 二: 2, 三: 3, 六: 6, 十二: 12,
};
const NUMBER_WORD = `(\\d+|${Object.keys(NUMBER_WORDS).sort((x, y) => y.length - x.length).join("|")})`;
const numOrWord = (s: string) => (/^\d+$/.test(s) ? Number(s) : (NUMBER_WORDS[s] ?? 1));

const DAY_WORDS = "days?|d|dias?|días|día|jours?|j|gün|ngày|дн(?:ей|я|ь)";
const WEEK_WORDS = "weeks?|semanas?|semaines?|hafta|tuần|недел[ьяиюе]|недель";
const MONTH_WORDS = "months?|meses|mês|mes|mois|ay|tháng|месяц(?:а|ев)?";
const YEAR_WORDS = "years?|anos?|años?|ans?|années?|yıl|năm|год(?:а)?|лет";

const RANGE_WORDS: [RangeWord, string][] = [
  // "very wide" etc. first, so plain "wide" doesn't win.
  ["wider", "very wide|wider|widest|max(?:imum)?|muito (?:largo|amplo)|muy (?:amplio|ancho|largo)|très large|plus large|çok geniş|rất rộng|очень широк\\p{L}*|максимальн\\p{L}*"],
  ["narrow", "narrow|tight|small|estreito|estreita|apertado|estrecho|estrecha|ajustado|étroit|étroite|serré|dar|hẹp|узк\\p{L}*"],
  ["medium", "medium|normal|balanced|médio|medio|média|media|moyen(?:ne)?|équilibré|orta|dengeli|trung bình|средн\\p{L}*|сбалансированн\\p{L}*"],
  ["wide", "wide|safe|largo|larga|amplo|ampla|amplio|amplia|ancho|large|geniş|rộng|широк\\p{L}*"],
];
/** Chinese range words (no word boundaries in CJK). */
const RANGE_CJK: [RangeWord, string][] = [
  ["wider", "最宽|很宽|非常宽|最大"],
  ["narrow", "窄|小范围|紧"],
  ["medium", "中等|中间|适中|平衡"],
  ["wide", "宽|安全"],
];

const DIST_WORDS: [Strategy, string][] = [
  ["fee", "fee[-\\s]?weighted|by fees?|weighted by fees|por taxas?|por comisi(?:ó|o)n(?:es)?|par frais|selon les frais|ücrete göre|theo phí|по комисси\\p{L}*|按手续费|按费用"],
  ["uniform", "uniform(?:ly)?|even(?:ly)?|equal(?:ly)?|uniforme|igual(?:mente)?|égal(?:ement)?|eşit|đều|равномерн\\p{L}*|均匀|平均"],
  ["curve", "curve|concentrated|curva|concentrad[oa]|courbe|concentré|eğri|đường cong|кривая|концентрированн\\p{L}*|曲线|集中"],
];

const CHAIN_WORDS: [number, string][] = [
  [56, "bnb(?: chain)?|bsc|binance(?: smart chain)?"],
  [1, "ethereum|eth|mainnet|ethereum mainnet"],
  [4663, "robinhood(?: chain)?|rh"],
];

const CURRENCY_USD = "usd|dollars?|bucks|dólares|dolares|dólar|dolar|đô(?: la)?|долл\\p{L}*";
const CURRENCY_USD_CJK = "美元|美金|刀";
const CURRENCY_EUR = "€|eur|euros?|евро|欧元";
const DEPOSIT_VERBS = "deposit|put|invest|add|depositar|depósito|deposito|investir|invertir|colocar|poner|déposer|dépôt|placer|investir|yatır\\p{L}*|gửi|nạp|đầu tư|внести|вложить|депозит|положить";

/** Filler words in all supported languages (never reported as unknown). */
const FILLER = new Set(
  (
    "i want to would like like please deposit put invest add with a an the on in into at for of and my plan range lp liquidity pool position " +
    "using use based last data days day me let's lets do it its it's some about around approx approximately into via by then also just " +
    "eu quero gostaria de depositar depósito deposito com um uma em no na nos nas o os as do da dos das para por durante faixa intervalo e " +
    "yo quiero quisiera con en el la los las un una por para durante rango y del al " +
    "je veux voudrais déposer dépôt avec sur dans le les des du une pour pendant plage et à " +
    "ben istiyorum yatırmak ile için aralık havuz ve bir " +
    "tôi muốn gửi với trên trong khoảng cho và một vào " +
    "я хочу внести с на в течение для диапазон и пул " +
    "range-wise around about"
  ).split(/\s+/),
);
const FILLER_CJK = /[我想要存入在用的范围池里个和以及请把投投入存放资金为期]/gu;

// ---------- parseText ----------

interface Work {
  t: string;
  out: ParsedIntent;
}

/** Match plus capture groups. Groups that didn't take part are undefined at runtime, hence the `??` below. */
type Groups = string[];

/**
 * Runs a regex over the working text; each match is handed to `on` and blanked out, unless `on`
 * returns false (then it's left in place). Returns whether anything was taken.
 */
function take(w: Work, re: RegExp, on: (m: Groups) => boolean | void): boolean {
  let hit = false;
  w.t = w.t.replace(re, (...args: unknown[]) => {
    // replace() passes (match, ...groups, offset, input); the offset is the first number.
    const m = args.slice(0, args.findIndex((a) => typeof a === "number")) as Groups;
    if (on(m) === false) return m[0];
    hit = true;
    return " ";
  });
  return hit;
}

const rx = (src: string, flags = "giu") => new RegExp(src, flags);

/** Tries alternatives in order and stops at the first that takes something. */
const first = (...alts: (() => boolean)[]) => alts.some((f) => f());

/**
 * Extracts everything understood from free text. `symbols` (upper-case pool token symbols) lets bare
 * words like "ai usdg" or "on SKHYB" be read as a pair; without it only "X/Y" and "X-Y" are.
 */
export function parseText(text: string, symbols: Set<string> = new Set()): ParsedIntent {
  const out: ParsedIntent = { notes: [], unknown: [] };
  const w: Work = { t: ` ${text.normalize("NFC").toLowerCase()} `, out };
  const TO = "(?:to|a|até|ate|hasta|à|au|->|→|–|—|~|\\.\\.|…|đến|tới|до|ila|kadar|到|至)";

  // 1. Explicit bins: "#-3 to #2", "bins -3 to 2", "from -3 to +2", "de -3 a +2".
  const setBins = (a: string, b: string) => {
    const x = signedInt(a);
    const y = signedInt(b);
    out.bins = { from: Math.min(x, y), to: Math.max(x, y) };
  };
  first(
    () =>
      take(w, rx(`#\\s*${SIGNED}\\s*${TO}\\s*#?\\s*${SIGNED}`), (m) => setBins(m[1], m[2])),
    () =>
      take(w, rx(`${B}(?:bins?|bines|bin'?ler|бин\\p{L}*)\\s*#?${SIGNED}\\s*${TO}\\s*#?${SIGNED}`), (m) => setBins(m[1], m[2])),
    () =>
      take(w, rx(`${B}(?:from|de|desde|du|từ|от|从)\\s*([+\\-−]\\s?\\d{1,6}|\\d{1,6})\\s*${TO}\\s*([+\\-−]\\s?\\d{1,6}|\\d{1,6})${E}`), (m) => {
        if (!/[+\-−]/.test(m[1] + m[2])) return false; // "from 100 to 200" isn't bins
        setBins(m[1], m[2]);
      }),
  );

  // 2. Width around the price: "±0.1%", "+/-0.1%", "0.1% around the price".
  const setAround = (m: Groups) => {
    out.aroundPct = parseNumber(m[1]);
  };
  first(
    () => take(w, rx(`(?:±|\\+\\s?/\\s?-|\\+-)\\s*(\\d+(?:[.,]\\d+)?)\\s*%`), setAround),
    () =>
      take(
        w,
        rx(`(\\d+(?:[.,]\\d+)?)\\s*%\\s*(?:around|either side|each side|of the price|ao redor|em volta|alrededor|autour|etrafında|quanh|вокруг|左右)(?:\\s+(?:the\\s+)?(?:current\\s+)?price)?`),
        setAround,
      ),
  );

  // 3. "a 90% range" / "95%" → preset (only the three presets).
  take(w, rx(`${B}(80|90|95)\\s*%(?:\\s*(?:range|preset|of volume|faixa|rango|plage))?`), (m) => {
    out.range = m[1] === "80" ? "narrow" : m[1] === "90" ? "medium" : "wide";
  });

  // 4. Data period (before duration, so "30 days of data" isn't the duration).
  const setPeriod = (s: string) => {
    out.period = /24|day|hour|dia|día|jour|gün|ngày|день|天/.test(s) && !/30|month|mes|mois|ay|tháng|месяц|月/.test(s) && !/7|week|semana|semaine|hafta|tuần|недел|周/.test(s) ? "24h" : /7|week|semana|semaine|hafta|tuần|недел|周/.test(s) ? "7d" : "30d";
  };
  first(
    () =>
      take(w, rx(`${B}(?:using|use|with|based on|from|on)\\s+(?:the\\s+)?(?:last\\s+|past\\s+)?(24\\s*h(?:ours?)?|1\\s*day|day|7\\s*d(?:ays)?|week|30\\s*d(?:ays)?|month)(?:'s)?\\s*(?:of\\s+)?data${E}`), (m) => setPeriod(m[1])),
    () =>
      take(w, rx(`${B}(24\\s*h(?:ours?)?|7\\s*d(?:ays)?|30\\s*d(?:ays)?|7\\s*days|30\\s*days|24\\s*hours)\\s+(?:of\\s+)?data${E}`), (m) => setPeriod(m[1])),
    () =>
      take(w, rx(`${B}based on (?:the\\s+)?(?:last|past)\\s+(24\\s*h(?:ours?)?|day|week|month|7\\s*days|30\\s*days)${E}`), (m) => setPeriod(m[1])),
    () =>
      take(w, rx(`${B}(?:dados|datos|données|veri|dữ liệu|данн\\p{L}*)\\s+(?:de\\s+|des\\s+)?(24\\s*h|7\\s*d|30\\s*d)${E}`), (m) => setPeriod(m[1])),
  );

  // 5. Duration.
  const setDays = (d: number) => {
    if (d > 0 && d <= 3650) out.days = Math.round(d);
  };
  first(
    () =>
      take(w, rx(`${B}(?:a|one|un|une|um|uma|una|bir|một|один|1)?\\s*(?:quarter|trimestre|çeyrek|quý|квартал)${E}|季度`), () => setDays(90)),
    () =>
      take(w, rx(`${B}${NUMBER_WORD}\\s*(${YEAR_WORDS})${E}|${NUMBER_WORD}\\s*年`), (m) => setDays(365 * numOrWord(m[1] ?? m[3]))),
    () =>
      take(w, rx(`${B}${NUMBER_WORD}\\s*(${MONTH_WORDS})${E}|${NUMBER_WORD}\\s*(?:个月|個月|月)`), (m) => setDays(30 * numOrWord(m[1] ?? m[3]))),
    () =>
      take(w, rx(`${B}${NUMBER_WORD}\\s*(${WEEK_WORDS})${E}|${NUMBER_WORD}\\s*(?:周|星期)`), (m) => setDays(7 * numOrWord(m[1] ?? m[3]))),
    () =>
      take(w, rx(`${B}(\\d+)\\s*(y|w|mo)${E}`), (m) => setDays(Number(m[1]) * (m[2] === "y" ? 365 : m[2] === "w" ? 7 : 30))),
    () =>
      take(w, rx(`${B}(\\d+)\\s*(${DAY_WORDS})${E}|(\\d+)\\s*天`), (m) => setDays(Number(m[1] ?? m[3]))),
  );

  // 6. Amount, with a currency sign or word first.
  const setAmount = (raw: string, k?: string) => {
    let v = parseNumber(raw);
    if (k && /^k$/i.test(k)) v *= 1e3;
    if (k && /^m$/i.test(k)) v *= 1e6;
    if (Number.isFinite(v) && v > 0) out.amount = v;
  };
  const K = "\\s?(k|m)?";
  const gotEur = take(w, rx(`(?:€|${B}eur${E})\\s*${NUM}${K}${E}|${B}${NUM}${K}\\s*(?:${CURRENCY_EUR})(?![\\p{L}])`), (m) => {
    if (m[1]) setAmount(m[1], m[2]);
    else setAmount(m[3], m[4]);
  });
  if (gotEur) out.notes.push("€ read as US dollars (estimates are in USD).");
  if (out.amount === undefined)
    take(w, rx(`\\$\\s*${NUM}${K}${E}|${B}${NUM}${K}\\s*(?:\\$|(?:${CURRENCY_USD})${E}|${CURRENCY_USD_CJK})`), (m) => {
      if (m[1]) setAmount(m[1], m[2]);
      else setAmount(m[3], m[4]);
    });
  if (out.amount === undefined)
    take(w, rx(`${B}(?:${DEPOSIT_VERBS})${E}\\s*(?:of\\s+|de\\s+)?${NUM}${K}${E}`), (m) => setAmount(m[1], m[2]));
  if (out.amount === undefined) take(w, rx(`${B}${NUM}\\s?(k|m)${E}`), (m) => setAmount(m[1], m[2]));
  if (out.amount === undefined)
    take(w, rx(`(?:存入?|投入?)\\s*${NUM}`), (m) => setAmount(m[1]));

  // 7. Distribution (before pairs: "fee-weighted" has a dash).
  for (const [s, words] of DIST_WORDS) if (take(w, rx(`${B}(?:${words})${E}`), () => {})) { out.distribution = s; break; }

  // 8. Pair: "AI/USDG", "AI-USDG", "AI and USDG" (both known symbols), "ai usdg" (both known symbols).
  const known = (s: string) => [...symbols].some((sym) => symbolDistance(s, sym) < Infinity);
  take(w, rx(`${B}([\\p{L}][\\p{L}\\p{N}.]{0,15})\\s*[/\\-]\\s*([\\p{L}][\\p{L}\\p{N}.]{0,15})${E}`), (m) => {
    out.pairQuery = [m[1].toUpperCase(), m[2].toUpperCase()];
  });
  if (!out.pairQuery && symbols.size)
    take(w, rx(`${B}([\\p{L}][\\p{L}\\p{N}.]{0,15})\\s+(?:and|e|y|et|ve|và|и|和|&)\\s+([\\p{L}][\\p{L}\\p{N}.]{0,15})${E}`), (m) => {
      if (!known(m[1]) || !known(m[2])) return false;
      out.pairQuery = [m[1].toUpperCase(), m[2].toUpperCase()];
    });

  // 9. Chain.
  for (const [id, words] of CHAIN_WORDS) if (take(w, rx(`${B}(?:on|em|en|sur|trên|на|在)?\\s*(?:${words})${E}`), () => {})) { out.chain = id; break; }

  // 10. Range words.
  if (!out.range) {
    for (const [r, words] of RANGE_WORDS) if (take(w, rx(`${B}(?:${words})${E}(?:\\s+(?:range|faixa|rango|plage|aralık|khoảng|диапазон))?`), () => {})) { out.range = r; break; }
  }
  if (!out.range) for (const [r, words] of RANGE_CJK) if (take(w, rx(`(?:${words})(?:范围)?`), () => {})) { out.range = r; break; }

  // 11. Leftovers: known symbols → pair; a lone number → deposit (said out loud); the rest is unknown.
  const rest = w.t.replace(FILLER_CJK, " ").split(/[\s,;:!?()"'“”«»]+|(?<=\.)\s/u).map((s) => s.replace(/^[.\-]+|[.\-]+$/g, "")).filter(Boolean);
  const pairTokens: string[] = [];
  for (const tok of rest) {
    if (FILLER.has(tok)) continue;
    if (/^\d+(?:[.,]\d+)?$/.test(tok) && out.amount === undefined) {
      setAmount(tok);
      if (out.amount !== undefined) out.notes.push(`Read ${tok} as the deposit in USD.`);
      continue;
    }
    if (!out.pairQuery && symbols.size && /^[\p{L}][\p{L}\p{N}.]*$/u.test(tok) && known(tok) && pairTokens.length < 2) {
      pairTokens.push(tok.toUpperCase());
      continue;
    }
    out.unknown.push(tok);
  }
  if (!out.pairQuery && pairTokens.length) out.pairQuery = pairTokens;
  return out;
}

/** True when the text gave us at least one usable value. */
export const understoodAnything = (i: ParsedIntent) =>
  i.amount !== undefined || !!i.pairQuery || i.chain !== undefined || !!i.range || !!i.bins || i.aroundPct !== undefined || i.days !== undefined || !!i.distribution || !!i.period;

// ---------- pool matching ----------

export type PoolMatch =
  | { kind: "none" }
  | { kind: "one"; pool: Pool; note?: string; alternatives: Pool[] }
  | { kind: "choose"; options: Pool[] }
  | { kind: "notFound"; query: string; suggestions: Pool[] };

/** Largest pool wins outright when it holds more than this share of the candidates' combined TVL. */
export const DOMINANT_TVL_SHARE = 0.8;

/** Same bar as the pool picker's default view: pools under $10k TVL are only used when nothing else matches. */
export const MIN_ELIGIBLE_TVL = 1e4;
export const isEligiblePool = (p: Pool) => p.tvlFiat >= MIN_ELIGIBLE_TVL;

function pairScore(p: Pool, q: string[]): number {
  const s0 = p.token0.symbol;
  const s1 = p.token1.symbol;
  if (q.length === 1) return Math.min(symbolDistance(q[0], s0), symbolDistance(q[0], s1));
  return Math.min(symbolDistance(q[0], s0) + symbolDistance(q[1], s1), symbolDistance(q[0], s1) + symbolDistance(q[1], s0));
}

const byTvl = (a: Pool, b: Pool) => b.tvlFiat - a.tvlFiat;

/**
 * Two symbols: pools with that pair (any order, ≤ 1 typo per symbol), on the chain if one was named.
 * Several → pick one only if it holds > 80% of their combined TVL, else let the user choose.
 * One symbol: the highest-TVL pool containing it. Nothing → the 3 closest pairs as suggestions.
 */
export function matchPool(intent: ParsedIntent, pools: Pool[]): PoolMatch {
  const q = intent.pairQuery;
  if (!q?.length) return { kind: "none" };
  const scored = pools.map((p) => ({ p, d: pairScore(p, q) })).filter((x) => x.d < Infinity);
  const onChain = intent.chain !== undefined ? scored.filter((x) => x.p.chainId === intent.chain) : scored;
  const pool = onChain.length ? onChain : scored;
  if (pool.length === 0) {
    const want = q.join("/");
    const suggestions = [...pools]
      .map((p) => ({ p, d: Math.min(levenshtein(want, p.pair.toUpperCase()), levenshtein(want, `${p.token1.symbol}/${p.token0.symbol}`.toUpperCase()), ...q.map((t) => Math.min(levenshtein(t, p.token0.symbol.toUpperCase()), levenshtein(t, p.token1.symbol.toUpperCase())) + (q.length > 1 ? 2 : 0))) }))
      .sort((a, b) => a.d - b.d || b.p.tvlFiat - a.p.tvlFiat)
      .slice(0, 3)
      .map((x) => x.p);
    return { kind: "notFound", query: want, suggestions };
  }
  const best = Math.min(...pool.map((x) => x.d));
  const all = pool.filter((x) => x.d === best).map((x) => x.p).sort(byTvl);
  // TVL only re-ranks: pools ≥ $10k (the picker's default) first, then any with TVL > $0, and $0 pools only
  // when nothing else has that pair. Private (allowlisted) pools go last and are only auto-picked when every
  // match is private. Nothing that matches is ever dropped for being small.
  const open = all.filter((p) => !p.isPrivate);
  const base = open.length ? open : all;
  const eligible = base.filter(isEligiblePool);
  const funded = base.filter((p) => p.tvlFiat > 0);
  const tier = eligible.length ? eligible : funded.length ? funded : base;
  const anyFunded = all.some((p) => p.tvlFiat > 0);
  const rest = [
    ...base.filter((p) => !tier.includes(p) && (p.tvlFiat > 0 || !funded.length)),
    ...(open.length ? all.filter((p) => p.isPrivate && (p.tvlFiat > 0 || !anyFunded)) : []),
  ];
  const ordered = [...tier, ...rest];
  const chainNote = intent.chain !== undefined && !onChain.length ? " (not on the chain you named)" : "";
  const smallNote = !eligible.length && tier[0] && tier[0].tvlFiat > 0 ? " Only small pools (under $10k TVL) have this pair." : "";
  if (tier.length === 1)
    return { kind: "one", pool: tier[0], alternatives: rest.slice(0, 3), note: chainNote || smallNote ? `${chainNote ? `Found it on another chain${chainNote}.` : ""}${smallNote}`.trim() : undefined };
  if (q.length === 1)
    return { kind: "one", pool: tier[0], alternatives: ordered.slice(1, 4), note: `Picked the largest of ${all.length} pools with ${q[0]}${chainNote}.${smallNote}` };
  const total = tier.reduce((s, p) => s + p.tvlFiat, 0);
  if (total > 0 && tier[0].tvlFiat / total > DOMINANT_TVL_SHARE) return { kind: "one", pool: tier[0], alternatives: ordered.slice(1, 4), note: `Picked the largest pool${chainNote}.${smallNote}` };
  return { kind: "choose", options: ordered.slice(0, 5) };
}

// ---------- parser interface ----------

export interface IntentResult {
  intent: ParsedIntent;
  match: PoolMatch;
}

/** Any parser (rule-based now, optionally AI later) maps text + live pools to an IntentResult. */
export type IntentParser = (text: string, pools: Pool[]) => IntentResult | Promise<IntentResult>;

export const ruleParser: IntentParser = (text, pools) => {
  const symbols = new Set(pools.flatMap((p) => [p.token0.symbol.toUpperCase(), p.token1.symbol.toUpperCase()]));
  const intent = parseText(text, symbols);
  return { intent, match: matchPool(intent, pools) };
};

/** Entry point used by the UI. Swap `parser` to add a fallback later; today it's rules only. */
export function parseIntent(text: string, pools: Pool[], parser: IntentParser = ruleParser): Promise<IntentResult> {
  return Promise.resolve(parser(text, pools));
}

// ---------- applying ranges that need bin data ----------

/** Bins whose edges cover ±pct around the oracle price (0%), for bins `widthPct` wide (percent units). */
export function binsAround(pct: number, widthPct: number): { from: number; to: number } {
  const n = Math.max(1, Math.ceil(pct / widthPct - 1e-9));
  return { from: -n, to: n - 1 };
}

export const RANGE_PRESET: Record<Exclude<RangeWord, "wider">, 80 | 90 | 95> = { narrow: 80, medium: 90, wide: 95 };

// ---------- ambiguity chips ----------

const chainName = (id: number) => (CHAINS[id]?.name ?? String(id)).replace(/ Chain$/, "");
/** "$800", "$2.3k", "$12k", "$1.2M" (one decimal under 10 of a unit, trailing ".0" dropped). */
export function compactUsd(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const unit = (x: number, u: string) => `$${(x < 10 ? x.toFixed(1) : Math.round(x).toString()).replace(/\.0$/, "")}${u}`;
  if (a >= 1e9) return unit(v / 1e9, "B");
  if (a >= 1e6) return unit(v / 1e6, "M");
  if (a >= 1e3) return unit(v / 1e3, "k");
  return fmtUsd(Math.round(v)).replace(/\.00$/, "");
}

/** "That pair has 2 pools on Robinhood" when they share a chain; the chain wording only when they differ. */
export function ambiguityTitle(options: Pool[]): string {
  const chains = [...new Set(options.map((p) => p.chainId))];
  if (chains.length === 1) return `That pair has ${options.length} pools on ${chainName(chains[0])}. Which one?`;
  return `That pair is on ${chains.length} chains (${chains.map(chainName).join(", ")}). Which pool?`;
}

/** Shown on chips (and in the summary warning) for private, deposit-allowlisted pools. */
export const ALLOWLIST_NOTE = "Deposits restricted to an allowlist";

/** "0xA9…71" */
export const shortAddress = (a: string) => `${a.slice(0, 4)}…${a.slice(-2)}`;

/** Chip text that tells same-pair pools apart: "AI/USDG · RH · TVL $2.3k · vol $12k · Unverified · 0xA9…71". */
export function poolChipLabel(p: Pool): string {
  const vol = p.analytics24h ? `vol ${compactUsd(p.analytics24h.volumeFiat)}` : "vol —";
  const curator = p.verifiedAdmin ? `${p.adminUsername ?? "curator"} ✓` : "Unverified";
  const parts = [p.pair, CHAINS[p.chainId]?.short ?? String(p.chainId), `TVL ${compactUsd(p.tvlFiat)}`, vol, curator, shortAddress(p.poolAddress)];
  if (p.isPrivate) parts.push(ALLOWLIST_NOTE);
  return parts.join(" · ");
}

// ---------- small / risky pool warning ----------

/** Deposit above this share of the pool's TVL makes the estimate unreliable (you'd move the pool). */
export const BIG_SHARE = 0.1;
const HIGH_RISK = new Set(["red", "black"]);

/**
 * Amber warning for the summary when the estimate can't be trusted: deposit > 10% of TVL, TVL < $10k, or a
 * High-Risk (or delisted) tier. e.g. "⚠ Tiny High-Risk pool ($2.3k TVL): your $200 would be ~9% of it, so these
 * estimates (≈3,000% APR) are unreliable." A private pool adds "Deposits restricted to an allowlist: …".
 * null when none applies.
 */
export function poolRiskWarning(p: Pick<Pool, "tvlFiat" | "tier"> & { isPrivate?: boolean }, deposit: number, feeApr: number | null): string | null {
  const share = p.tvlFiat > 0 ? deposit / p.tvlFiat : Infinity;
  const tiny = p.tvlFiat < MIN_ELIGIBLE_TVL;
  const big = share > BIG_SHARE;
  const risky = HIGH_RISK.has(p.tier);
  const allowlist = p.isPrivate ? `${ALLOWLIST_NOTE}: you can only deposit if the curator has allowlisted your wallet.` : null;
  if (!tiny && !big && !risky) return allowlist && `⚠ ${allowlist}`;
  const size = tiny ? "Tiny" : big ? "Small" : "";
  const tierWord = risky ? (p.tier === "black" ? "Delisted" : "High-Risk") : "";
  const what = [size, tierWord].filter(Boolean).join(" ");
  const apr = feeApr !== null && Number.isFinite(feeApr) ? ` (≈${Math.round(feeApr * 100).toLocaleString("en-US")}% APR)` : "";
  const shareText = !Number.isFinite(share) ? "the whole pool" : share >= 0.995 ? `${Math.round(share)}× its size` : `~${Math.max(1, Math.round(share * 100))}% of it`;
  const why = tiny || big ? `your ${compactUsd(deposit)} would be ${shareText}, so these estimates${apr} are unreliable` : `Metric rates it ${TIER_LABEL[p.tier]}, so these estimates${apr} may not hold`;
  return `⚠ ${what} pool (${compactUsd(p.tvlFiat)} TVL): ${why}.${allowlist ? ` ${allowlist}` : ""}`;
}

// ---------- distinct range words ----------

/**
 * A range word resolved on this pool's bins, kept distinct from the next narrower word on concentrated pools:
 * "wide" equal to "medium" → the Wider preset; "medium" equal to "narrow" → narrow ± 1 bin. `widened` is
 * true when that happened (the summary says "widened, pool is concentrated").
 */
export function distinctRange(
  word: Exclude<RangeWord, "wider">,
  data: BinData,
): { range: { kind: "preset"; share: 80 | 90 | 95 } | { kind: "manual"; from: number; to: number }; widened: boolean } {
  const same = (a: { from: number; to: number }, b: { from: number; to: number }) => a.from === b.from && a.to === b.to;
  if (word === "wide" && same(sharePreset(data, 95), sharePreset(data, 90))) return { range: { kind: "manual", ...widerRange(data) }, widened: true };
  if (word === "medium") {
    const narrow = sharePreset(data, 80);
    if (same(sharePreset(data, 90), narrow)) return { range: { kind: "manual", from: narrow.from - 1, to: narrow.to + 1 }, widened: true };
  }
  return { range: { kind: "preset", share: RANGE_PRESET[word] }, widened: false };
}
