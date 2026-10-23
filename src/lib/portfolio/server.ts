import "server-only";
import { createPublicClient, getAddress, http, pad, type Hex, type PublicClient } from "viem";
import { parseBins, type BinData } from "../calc";
import { metricFetch } from "../metric";
import { normalizePool, parsePoolPage } from "../normalize";
import { SUPPORTED_CHAINS, type Pool, type RawBinsResponse, type RawPoolPage } from "../types";
import { DATA_PROVIDER, DATA_PROVIDER_ABI, LIQUIDITY_ADDED_TOPIC, LIQUIDITY_REMOVED_TOPIC, MULTICALL3 } from "./abi";
import {
  annualizedPnl,
  calibrateScale,
  estNetUsd,
  heldDaysSince,
  userFeeApr,
  type BinValue,
  decodeLiquidityLog,
  groupPositions,
  hodlValue,
  insights,
  rangeStatus,
  valueBins,
  weightedApr,
  type BinInput,
  type LiquidityEvent,
  type PositionKey,
  type RawLog,
} from "./model";
import type { PortfolioResponse, PortfolioSummary, PositionView } from "./types";

/** Overridable for local testing against a mock; defaults to the public Metric RPC. */
const RPC = (chainId: number) => `${process.env.METRIC_RPC_BASE ?? "https://rpc.metric.xyz"}/${chainId}`;
const PERIOD = "7d";

function client(chainId: number): PublicClient {
  // batch: true folds concurrent calls into one JSON-RPC batch request (used when multicall is unavailable).
  return createPublicClient({ transport: http(RPC(chainId), { batch: { batchSize: 100 }, timeout: 15_000, retryCount: 1 }) }) as PublicClient;
}

/** Every Metric pool on a chain, including empty ones (minTvlFiat=0). */
async function chainPools(chainId: number): Promise<Map<string, Pool>> {
  const out = new Map<string, Pool>();
  let offset: number | null = 0;
  for (let page = 0; page < 10 && offset !== null; page++) {
    const r = await metricFetch(`/evm/metadata?include24h=true&count=500&sortBy=tvl&minTvlFiat=0&chainIds=${chainId}&offset=${offset}`, 300);
    if (!r.ok) {
      if (page === 0) throw new Error(r.error);
      break;
    }
    const { items, nextOffset } = parsePoolPage(r.body as RawPoolPage);
    for (const it of items) {
      const p = normalizePool(it, chainId);
      out.set(p.poolAddress.toLowerCase(), p);
    }
    offset = nextOffset;
  }
  return out;
}

async function walletLogs(c: PublicClient, wallet: Hex): Promise<LiquidityEvent[]> {
  const logs = (await c.request({
    method: "eth_getLogs",
    params: [{ fromBlock: "0x0", toBlock: "latest", topics: [[LIQUIDITY_ADDED_TOPIC, LIQUIDITY_REMOVED_TOPIC], pad(wallet).toLowerCase() as Hex] }],
  })) as RawLog[];
  return logs.map(decodeLiquidityLog).filter((e): e is LiquidityEvent => e !== null);
}

type Call = { address: Hex; abi: typeof DATA_PROVIDER_ABI; functionName: string; args: readonly unknown[] };

/**
 * Multicall3 when deployed. Calls it reports as failed — every call when Multicall3 isn't deployed on
 * the chain (viem then marks each result as a failure instead of throwing) — are retried as individual
 * eth_calls, which the transport folds into JSON-RPC batches. A call that still fails reads as null.
 */
async function readAll(c: PublicClient, calls: Call[]): Promise<(unknown | null)[]> {
  if (calls.length === 0) return [];
  let out: (unknown | null)[] = calls.map(() => null);
  let failed = calls.map((_, i) => i);
  try {
    const res = (await c.multicall({ contracts: calls as never, allowFailure: true, multicallAddress: MULTICALL3, batchSize: 4096 })) as {
      status: "success" | "failure";
      result?: unknown;
    }[];
    out = res.map((r) => (r.status === "success" ? r.result : null));
    failed = res.flatMap((r, i) => (r.status === "success" ? [] : [i]));
  } catch {
    // fall through: retry everything individually
  }
  const retried = await Promise.all(failed.map((i) => c.readContract(calls[i] as never).catch(() => null)));
  failed.forEach((i, j) => (out[i] = retried[j]));
  return out;
}

async function chainPositions(chainId: number, wallet: Hex): Promise<{ positions: PositionView[]; closed: number }> {
  const c = client(chainId);
  const events = await walletLogs(c, wallet);
  if (events.length === 0) return { positions: [], closed: 0 };

  const pools = await chainPools(chainId);
  const keys = groupPositions(events, new Set(pools.keys()));
  if (keys.length === 0) return { positions: [], closed: 0 };

  // Onchain reads: user shares per (position, bin); total shares + balances per (pool, bin).
  const shareCalls: Call[] = [];
  const binKeys = new Map<string, { pool: string; bin: number }>();
  for (const k of keys)
    for (const bin of k.bins) {
      shareCalls.push({ address: DATA_PROVIDER, abi: DATA_PROVIDER_ABI, functionName: "positionBinShares", args: [k.pool, wallet, k.salt, bin] });
      binKeys.set(`${k.pool}:${bin}`, { pool: k.pool, bin });
    }
  const binList = [...binKeys.values()];
  const binCalls: Call[] = binList.flatMap(({ pool, bin }) => [
    { address: DATA_PROVIDER, abi: DATA_PROVIDER_ABI, functionName: "binTotalShares", args: [pool, bin] },
    { address: DATA_PROVIDER, abi: DATA_PROVIDER_ABI, functionName: "binState", args: [pool, bin] },
  ]);

  const poolAddrs = [...new Set(keys.map((k) => k.pool))];
  const firstBlocks = [...new Set(keys.map((k) => k.firstBlock))];
  const [reads, analytics, blocks] = await Promise.all([
    readAll(c, [...shareCalls, ...binCalls]),
    Promise.all(
      poolAddrs.map(async (p) => {
        const r = await metricFetch(`/evm/${chainId}/${pools.get(p)!.poolAddress}/analytics/bins?contract_version=v1&period=${PERIOD}`, 60);
        if (!r.ok) return [p, null] as const;
        try {
          return [p, parseBins(r.body as RawBinsResponse)] as const;
        } catch {
          return [p, null] as const;
        }
      }),
    ),
    Promise.all(firstBlocks.map((n) => c.getBlock({ blockNumber: n }).then((b) => [n, Number(b.timestamp)] as const).catch(() => [n, null] as const))),
  ]);

  const userShares = new Map<string, bigint>();
  let i = 0;
  for (const k of keys) for (const bin of k.bins) userShares.set(`${k.pool}:${k.salt}:${bin}`, (reads[i++] as bigint | null) ?? 0n);
  const binOnchain = new Map<string, { total: bigint; b0: bigint; b1: bigint; lengthE6: number | null }>();
  for (const { pool, bin } of binList) {
    const total = (reads[i++] as bigint | null) ?? 0n;
    const st = reads[i++] as readonly [bigint, bigint, number, number, number] | null;
    binOnchain.set(`${pool}:${bin}`, { total, b0: st?.[0] ?? 0n, b1: st?.[1] ?? 0n, lengthE6: st ? Number(st[2]) : null });
  }
  const bins7d = new Map<string, BinData | null>(analytics);
  const blockTs = new Map<bigint, number | null>(blocks);
  const now = Date.now() / 1000;

  const positions: PositionView[] = [];
  let closed = 0;
  for (const k of keys) {
    const view = buildView(chainId, k, pools.get(k.pool)!, bins7d.get(k.pool) ?? null, userShares, binOnchain, blockTs.get(k.firstBlock) ?? null, now);
    if (view.valueUsd > 0 || view.bins.some((b) => b.share > 0)) positions.push(view);
    else closed++;
  }
  return { positions, closed };
}

function buildView(
  chainId: number,
  k: PositionKey,
  pool: Pool,
  data: BinData | null,
  userShares: Map<string, bigint>,
  onchain: Map<string, { total: bigint; b0: bigint; b1: bigint; lengthE6: number | null }>,
  firstTs: number | null,
  now: number,
): PositionView {
  const inputs: BinInput[] = k.bins.map((idx) => {
    const oc = onchain.get(`${k.pool}:${idx}`);
    const a = data ? data.bins[idx - data.minIdx] : undefined;
    const inSpan = data && idx >= data.minIdx && idx <= data.maxIdx;
    return {
      idx,
      userShares: userShares.get(`${k.pool}:${k.salt}:${idx}`) ?? 0n,
      totalShares: oc?.total ?? 0n,
      balance0Scaled: oc?.b0 ?? 0n,
      balance1Scaled: oc?.b1 ?? 0n,
      reserve0Fiat: inSpan && a ? a.reserve0Fiat : 0,
      reserve1Fiat: inSpan && a ? a.reserve1Fiat : 0,
      lpFeesFiat: inSpan && a ? a.feesFiat : 0,
      aprBps: inSpan && a?.hasData ? a.aprBps : null,
      pnlAprBps: inSpan && a?.hasData ? a.pnlAprBps : null,
    };
  });
  // Same 7d window for fees and APRs; age from the first deposit's block timestamp, to the second.
  const windowDays = data?.windowDays ?? 7;
  const ageDays = heldDaysSince(firstTs, now);
  const vb = valueBins(inputs, windowDays, ageDays);
  const valueUsd = vb.reduce((s, b) => s + b.valueUsd, 0);
  const feesUsd = vb.reduce((s, b) => s + b.feesUsd, 0);
  const cal = calibrateScale(inputs, pool.token0.fiatPrice, pool.token1.fiatPrice);
  const hodl = hodlValue(k.net0Scaled, k.net1Scaled, cal, pool.token0.fiatPrice, pool.token1.fiatPrice);
  const held = vb.filter((b) => b.share > 0).map((b) => b.idx);
  const curBinIdx = data?.curBinIdx ?? pool.curBinIdx;
  const status = rangeStatus(held, curBinIdx);
  const pnlUsd = hodl.usd === null ? null : valueUsd - hodl.usd;
  return {
    chainId,
    pool: pool.poolAddress,
    pair: pool.pair,
    token0: { symbol: pool.token0.symbol, logoUrl: pool.token0.logoUrl },
    token1: { symbol: pool.token1.symbol, logoUrl: pool.token1.logoUrl },
    tier: pool.tier,
    isPrivate: pool.isPrivate,
    salt: k.salt.toString(),
    curBinIdx,
    bins: vb.map((b) => {
      const w = onchain.get(`${k.pool}:${b.idx}`)?.lengthE6 ?? data?.defaultLengthE6 ?? 100;
      return { ...b, midPct: ((b.idx + 0.5) * w) / 1e4 };
    }),
    range: held.length ? { from: Math.min(...held), to: Math.max(...held) } : null,
    valueUsd,
    feesUsd,
    hodlUsd: hodl.usd,
    pnlUsd,
    pnlApprox: hodl.approx,
    pnlAnnualized: annualizedPnl(pnlUsd, hodl.usd, ageDays),
    yourFeeApr: userFeeApr(vb),
    binsNetApr: weightedApr(vb, (b) => b.pnlAprBps),
    estNetUsd: estNetUsd(vb),
    heldDays: ageDays,
    status,
    insights: insights({ bins: vb, curBinIdx, status, pnlUsd, pnlApprox: hodl.approx }),
    firstDepositTs: firstTs,
    windowDays,
    scale: { confirmed: cal.confirmed, impliedExp0: cal.impliedExp0, impliedExp1: cal.impliedExp1 },
  };
}

export function summarize(positions: PositionView[]): PortfolioSummary {
  const all: BinValue[] = positions.flatMap((p) => p.bins);
  const sum = (f: (p: PositionView) => number) => positions.reduce((s, p) => s + f(p), 0);
  const withPnl = positions.filter((p) => p.pnlUsd !== null && p.hodlUsd !== null);
  const pnlUsd = withPnl.length ? withPnl.reduce((s, p) => s + p.pnlUsd!, 0) : null;
  const hodlUsd = withPnl.length ? withPnl.reduce((s, p) => s + p.hodlUsd!, 0) : null;
  // HODL-weighted holding time across positions with a known age.
  const aged = withPnl.filter((p) => p.heldDays !== null && p.hodlUsd! > 0);
  const w = aged.reduce((s, p) => s + p.hodlUsd!, 0);
  const heldDays = w > 0 ? aged.reduce((s, p) => s + p.hodlUsd! * p.heldDays!, 0) / w : null;
  return {
    valueUsd: sum((p) => p.valueUsd),
    feesUsd: sum((p) => p.feesUsd),
    hodlUsd,
    pnlUsd,
    pnlApprox: positions.some((p) => p.pnlApprox || p.pnlUsd === null),
    pnlAnnualized: annualizedPnl(pnlUsd, hodlUsd, heldDays),
    yourFeeApr: userFeeApr(all),
    binsNetApr: weightedApr(all, (b) => b.pnlAprBps),
    estNetUsd: positions.some((p) => p.estNetUsd !== null) ? sum((p) => p.estNetUsd ?? 0) : null,
    heldDays,
    count: positions.length,
  };
}

/** Read-only: wallet address in, positions out. Chains run in parallel; a failing chain is reported, not fatal. */
export async function loadPortfolio(walletInput: string, chain: number | null): Promise<PortfolioResponse> {
  const wallet = getAddress(walletInput) as Hex;
  const chains = chain !== null ? [chain] : SUPPORTED_CHAINS;
  const results = await Promise.allSettled(chains.map((id) => chainPositions(id, wallet)));
  const positions: PositionView[] = [];
  const errors: PortfolioResponse["errors"] = [];
  let closed = 0;
  results.forEach((r, j) => {
    if (r.status === "fulfilled") {
      positions.push(...r.value.positions);
      closed += r.value.closed;
    } else errors.push({ chainId: chains[j], message: r.reason instanceof Error ? r.reason.message.split("\n")[0] : "Request failed" });
  });
  positions.sort((a, b) => b.valueUsd - a.valueUsd);
  return { wallet, positions, closed, summary: summarize(positions), errors, generatedAt: Date.now() };
}
