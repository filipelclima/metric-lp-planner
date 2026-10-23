"use client";
import { useCallback, useEffect, useState } from "react";

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Fetches a list of JSON URLs (deduped) and keeps each result; `retry` refetches the failed ones. */
export function useApis<T>(urls: string[]): { get: (url: string) => Loaded<T>; retry: () => void } {
  const unique = [...new Set(urls)].sort();
  const key = unique.join("|");
  const [map, setMap] = useState<Record<string, Loaded<T>>>({});
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    for (const u of key ? key.split("|") : []) {
      setMap((m) => (m[u]?.data && !m[u].error ? m : { ...m, [u]: { data: m[u]?.data ?? null, error: null, loading: true } }));
      fetch(u, { signal: ctrl.signal })
        .then(async (res) => {
          const body = await res.json().catch(() => ({}));
          setMap((m) => ({
            ...m,
            [u]: res.ok ? { data: body as T, error: null, loading: false } : { data: null, error: body.error ?? `Request failed (${res.status}).`, loading: false },
          }));
        })
        .catch((e) => {
          if (e.name !== "AbortError") setMap((m) => ({ ...m, [u]: { data: null, error: "Network error.", loading: false } }));
        });
    }
    return () => ctrl.abort();
  }, [key, nonce]);

  const get = useCallback((u: string): Loaded<T> => map[u] ?? { data: null, error: null, loading: true }, [map]);
  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { get, retry };
}
