"use client";
import { useCallback, useEffect, useState } from "react";

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  status: number | null;
  retryAfter: number | null;
  loading: boolean;
  retry: () => void;
}

export function useApi<T>(url: string | null): ApiState<T> {
  const [nonce, setNonce] = useState(0);
  const [s, setS] = useState<Omit<ApiState<T>, "retry">>({ data: null, error: null, status: null, retryAfter: null, loading: !!url });

  useEffect(() => {
    if (!url) {
      setS({ data: null, error: null, status: null, retryAfter: null, loading: false });
      return;
    }
    const ctrl = new AbortController();
    setS((p) => ({ ...p, loading: true, error: null }));
    fetch(url, { signal: ctrl.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok)
          setS({ data: null, error: body.error ?? `Request failed (${res.status}).`, status: res.status, retryAfter: body.retryAfter ?? null, loading: false });
        else setS({ data: body as T, error: null, status: res.status, retryAfter: null, loading: false });
      })
      .catch((e) => {
        if (e.name !== "AbortError") setS({ data: null, error: "Network error.", status: null, retryAfter: null, loading: false });
      });
    return () => ctrl.abort();
  }, [url, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { ...s, retry };
}
