/**
 * Fetches JSON with a hard deadline. Never throws: returns null on timeout, network error,
 * non-2xx status or invalid JSON. Works on the edge and Node runtimes.
 */
export async function fetchJsonWithTimeout<T>(
  url: string,
  ms: number,
  init: RequestInit & { next?: { revalidate?: number } } = {},
): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...init, headers: { accept: "application/json", ...init.headers }, signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
