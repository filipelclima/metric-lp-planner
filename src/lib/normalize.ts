import { safeInt, toNum, toNumOrNull } from "./num";
import { CHAINS, Pool, Tier } from "./types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const CHAIN_NAMES: Record<string, number> = {
  ethereum: 1, eth: 1, mainnet: 1,
  bnb: 56, bsc: 56, "bnb chain": 56, binance: 56,
  robinhood: 4663, "robinhood chain": 4663,
};

export function parseChainId(v: unknown): number | null {
  if (isObj(v)) return parseChainId(v.chainId ?? v.id ?? v.name);
  const n = toNumOrNull(v);
  if (n !== null) return n;
  if (typeof v === "string") return CHAIN_NAMES[v.toLowerCase()] ?? null;
  return null;
}

export function parseTier(v: unknown): Tier {
  if (typeof v !== "string") return "unknown";
  const s = v.toLowerCase();
  if (s.includes("green")) return "green";
  if (s.includes("yellow") || s.includes("amber")) return "yellow";
  if (s.includes("red")) return "red";
  return "unknown";
}

/** Unwraps `{ data: {...} }`-style envelopes. */
export function unwrap(v: unknown): unknown {
  if (isObj(v) && isObj(v.data) && !("poolAddress" in v)) return v.data;
  return v;
}

/** Extracts the array of pools and the next offset from a list page, whatever the envelope. */
export function parsePoolPage(body: unknown): { items: unknown[]; nextOffset: number | null } {
  if (Array.isArray(body)) return { items: body, nextOffset: null };
  if (!isObj(body)) return { items: [], nextOffset: null };
  const items =
    [body.pools, body.items, body.results, body.data, body.metadata].find(Array.isArray) ??
    (isObj(body.data) ? [body.data.pools, body.data.items].find(Array.isArray) : undefined) ??
    [];
  const next = body.nextOffset ?? (isObj(body.data) ? body.data.nextOffset : undefined);
  return { items: items as unknown[], nextOffset: toNumOrNull(next) };
}

function pick(o: Obj, ...keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
}

/** Looks for a 24h field on the pool body, then inside a nested 24h analytics object. */
function find24h(o: Obj, keys: string[], nestedKeys: string[]): number | null {
  const direct = toNumOrNull(pick(o, ...keys));
  if (direct !== null) return direct;
  for (const nk of ["analytics24h", "stats24h", "data24h", "last24h", "metrics24h"]) {
    const n = o[nk];
    if (isObj(n)) {
      const v = toNumOrNull(pick(n, ...keys, ...nestedKeys));
      if (v !== null) return v;
    }
  }
  return null;
}

function token(o: Obj, i: 0 | 1): Pool["token0"] {
  const t = `token${i}`;
  const nested = isObj(o[t]) ? (o[t] as Obj) : {};
  return {
    address: String((typeof o[t] === "string" ? o[t] : pick(nested, "address")) ?? ""),
    symbol: String(pick(o, `${t}Symbol`) ?? pick(nested, "symbol") ?? `TOKEN${i}`),
    decimals: toNum(pick(o, `${t}Decimals`) ?? pick(nested, "decimals"), 18),
    logoUrl: (pick(o, `${t}LogoUrl`) ?? pick(nested, "logoUrl")) as string | undefined,
    fiatPrice: toNum(pick(o, `${t}FiatPrice`) ?? pick(nested, "fiatPrice")),
  };
}

export function normalizePool(raw: unknown, chainHint?: number): Pool | null {
  const o = unwrap(raw);
  if (!isObj(o)) return null;
  const poolAddress = String(pick(o, "poolAddress", "pool", "address") ?? "");
  const chainId = parseChainId(pick(o, "chainId", "chain")) ?? chainHint ?? null;
  if (!poolAddress || chainId === null) return null;
  const t0 = token(o, 0);
  const t1 = token(o, 1);
  const cls = isObj(o.classificationSummary) ? o.classificationSummary : {};
  const tierRaw = (pick(cls, "tierQualification", "tier") as string | undefined) ?? null;
  const reasons = cls.reasonCodes;
  return {
    chainId,
    poolAddress,
    pair: String(pick(o, "pair") ?? `${t0.symbol}/${t1.symbol}`),
    token0: t0,
    token1: t1,
    tvlFiat: toNum(pick(o, "tvlFiat", "tvl")),
    aprBps7d: toNumOrNull(o.aprBps7d),
    tradingPnlAprBps7d: toNumOrNull(o.tradingPnlAprBps7d),
    curBinIdx: toNum(o.curBinIdx),
    tier: parseTier(tierRaw),
    tierRaw,
    reasonCodes: Array.isArray(reasons) ? reasons.map(String) : [],
    verifiedAdmin: o.verifiedAdmin === true || o.verifiedAdmin === "true",
    adminUsername: (o.adminUsername as string | null | undefined) ?? null,
    priceProviderStatus: o.priceProviderStatus == null ? null : String(o.priceProviderStatus),
    priceProviderCooldown: safeInt(o.priceProviderCooldownSecs),
    pauseLevel: toNumOrNull(o.pauseLevel),
    spreadAdminFeeE6: toNumOrNull(o.spreadAdminFeeE6),
    spreadProtocolFeeE6: toNumOrNull(o.spreadProtocolFeeE6),
    lpFees24hFiat: find24h(
      o,
      ["lpFees24hFiat", "lpFeesFiat24h", "fees24hFiat", "feesFiat24h", "lpFees24h"],
      ["lpFeesFiat", "feesFiat"],
    ),
    volume24hFiat: find24h(o, ["volume24hFiat", "volumeFiat24h", "volume24h"], ["volumeFiat"]),
  };
}

export const chainName = (id: number) => CHAINS[id]?.name ?? `Chain ${id}`;
