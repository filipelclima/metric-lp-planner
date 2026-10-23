import { describe, expect, it } from "vitest";
import { freezeTopSnapshot, parseTopSnapshot, topOgQuery, topSnapshotParams } from "@/lib/share";

const NOW = Date.UTC(2026, 9, 23, 12);
const q = (s: string) => new URLSearchParams(s);

describe("top-pools snapshot", () => {
  it("round-trips up to 5 rows with chain scope", () => {
    const f = freezeTopSnapshot(
      {
        rows: [
          { pair: "NVDAB/USDT", netApr: 60.1234, feeApr: 108.004 },
          { pair: "SKHYB/USDT", netApr: -3.5, feeApr: null },
        ],
        chainId: 56,
        date: "2026-10-23",
      },
      NOW,
    )!;
    expect(f.rows).toEqual([
      { pair: "NVDAB/USDT", netApr: 60.12, feeApr: 108 },
      { pair: "SKHYB/USDT", netApr: -3.5, feeApr: null },
    ]);
    const qs = topOgQuery(f);
    expect(qs).toBe("tp1=NVDAB%2FUSDT&tn1=60.12&tf1=108.00&tp2=SKHYB%2FUSDT&tn2=-3.50&tch=56&sd=2026-10-23&v=2");
    expect(parseTopSnapshot(q(qs), NOW)).toEqual(f);
    expect(topOgQuery(null)).toBe("kind=pools&v=2");
  });

  it("rejects arbitrary text, gaps, bad numbers, chains and dates", () => {
    const ok = "tp1=A%2FB&tn1=1&sd=2026-10-23";
    expect(parseTopSnapshot(q(ok), NOW)).not.toBeNull();
    for (const bad of [
      "tp1=FREE%20MONEY%2FNOW&tn1=1&sd=2026-10-23",
      "tp1=A%2FB&tn1=abc&sd=2026-10-23",
      "tp1=A%2FB&tn1=1e5&sd=2026-10-23",
      "tp1=A%2FB&sd=2026-10-23",
      "tp1=A%2FB&tn1=1&tp3=C%2FD&tn3=2&sd=2026-10-23",
      "tp1=A%2FB&tn1=1&tn2=5&sd=2026-10-23",
      "tp1=A%2FB&tn1=1&tch=137&sd=2026-10-23",
      "tp1=A%2FB&tn1=1&sd=2099-01-01",
      "tp1=A%2FB&tn1=1&tf1=x&sd=2026-10-23",
    ]) {
      expect(parseTopSnapshot(q(bad), NOW), bad).toBeNull();
    }
  });

  it("freeze drops rows with unusual symbols and keeps at most 5", () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ pair: i === 0 ? "WEIRD TOKEN/USDT" : `T${i}/USDT`, netApr: 10 - i, feeApr: 20 }));
    const f = freezeTopSnapshot({ rows, chainId: null, date: "2026-10-23" }, NOW)!;
    expect(f.rows.map((r) => r.pair)).toEqual(["T1/USDT", "T2/USDT", "T3/USDT", "T4/USDT", "T5/USDT"]);
    expect(topSnapshotParams(f).has("tch")).toBe(false);
  });
});
