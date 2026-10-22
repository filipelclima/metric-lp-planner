"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { parseBins } from "./calc";
import { computeEstimate, resolveRange } from "./plan";
import type { Pool, RawBinsResponse } from "./types";
import { readState, writeState, type PlannerState } from "./urlState";
import { useApi } from "./useApi";

/** All page state: URL-synced inputs, API data and the derived estimate. */
export function usePlanner() {
  const router = useRouter();
  const params = useSearchParams();
  const [s, setS] = useState<PlannerState>(() => readState(new URLSearchParams(params.toString())));
  const set = (patch: Partial<PlannerState>) => setS((p) => ({ ...p, ...patch }));

  const list = useApi<{ pools: Pool[] }>("/api/pools");
  const base = s.chain !== null && s.pool ? `/api/pools/${s.chain}/${s.pool}` : null;
  const meta = useApi<{ pool: Pool }>(base);
  const bins = useApi<RawBinsResponse>(base && `${base}/bins?period=${s.period}`);

  const listed = useMemo(
    () => list.data?.pools.find((p) => p.chainId === s.chain && p.poolAddress.toLowerCase() === s.pool?.toLowerCase()) ?? null,
    [list.data, s.chain, s.pool],
  );
  const pool = meta.data?.pool ?? listed;

  const binData = useMemo(() => {
    if (!bins.data) return null;
    try {
      return parseBins(bins.data);
    } catch {
      return null;
    }
  }, [bins.data]);
  const curBinIdx = binData?.curBinIdx ?? pool?.curBinIdx ?? 0;
  const range = useMemo(() => resolveRange(s, binData, curBinIdx), [s, binData, curBinIdx]);
  const estimate = useMemo(() => computeEstimate(s, pool, binData, range, !!bins.error), [s, pool, binData, range, bins.error]);

  const qs = writeState(s, range);
  useEffect(() => {
    if (qs !== params.toString()) router.replace(`?${qs}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);

  const selectPool = (p: Pool) => set({ chain: p.chainId, pool: p.poolAddress, range: { kind: "preset", share: 90 } });

  return { s, set, qs, list, meta, bins, pool, binData, curBinIdx, range, estimate, selectPool };
}

export type PlannerModel = ReturnType<typeof usePlanner>;
