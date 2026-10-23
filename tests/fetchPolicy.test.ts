import { describe, expect, it } from "vitest";
import { remainingOffsets, withRetry } from "@/lib/fetchPolicy";

describe("withRetry", () => {
  it("retries failures (null or throw) twice with 3× backoff, then gives up", async () => {
    const waits: number[] = [];
    let calls = 0;
    const r = await withRetry(
      async () => {
        calls++;
        if (calls === 1) throw new Error("cold start");
        return null;
      },
      { retries: 2, baseMs: 400, sleep: async (ms) => void waits.push(ms) },
    );
    expect(r).toBeNull();
    expect(calls).toBe(3);
    expect(waits).toEqual([400, 1200]);
  });

  it("returns as soon as an attempt succeeds", async () => {
    let calls = 0;
    const r = await withRetry(async () => (++calls === 2 ? "ok" : null), { sleep: async () => {} });
    expect(r).toBe("ok");
    expect(calls).toBe(2);
  });
});

describe("remainingOffsets", () => {
  it("plans the remaining pages for parallel fetching", () => {
    expect(remainingOffsets(100, 100, 227)).toEqual([100, 200]);
    expect(remainingOffsets(500, null, 227)).toEqual([]);
    expect(remainingOffsets(100, 100, 100)).toEqual([]);
    expect(remainingOffsets(100, 100, undefined)).toBeNull(); // no total: follow nextOffset instead
    expect(remainingOffsets(10, 10, 1_000_000, 5)).toHaveLength(4); // page cap
  });
});
