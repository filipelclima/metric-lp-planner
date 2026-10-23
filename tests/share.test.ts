import { describe, expect, it } from "vitest";
import {
  formatSnapshot,
  makeShareId,
  ogImageQuery,
  parseSnapshot,
  rawRange,
  shareText,
  snapshotParams,
  snapshotRangeText,
  type Snapshot,
} from "@/lib/share";
import { readState } from "@/lib/urlState";

const NOW = Date.UTC(2026, 9, 23, 12);
const q = (s: string) => new URLSearchParams(s);
const valid = "sf=210.09&sa=255.61&sn=-11.49&sd=2026-10-23&sp=SKHYB/USDT&sw=100";

describe("parseSnapshot", () => {
  it("accepts a well-formed snapshot", () => {
    expect(parseSnapshot(q(valid), NOW)).toEqual({
      fees: 210.09,
      feeApr: 255.61,
      netApr: -11.49,
      date: "2026-10-23",
      pair: "SKHYB/USDT",
      binWidthE6: 100,
    });
    expect(parseSnapshot(q("sf=1&sa=2&sd=2026-10-22"), NOW)).toMatchObject({ netApr: null, pair: null, binWidthE6: null });
  });

  it("requires sf, sa and sd", () => {
    expect(parseSnapshot(q("sa=2&sd=2026-10-23"), NOW)).toBeNull();
    expect(parseSnapshot(q("sf=1&sd=2026-10-23"), NOW)).toBeNull();
    expect(parseSnapshot(q("sf=1&sa=2"), NOW)).toBeNull();
  });

  it("rejects text, exponents, huge or over-long numbers", () => {
    for (const bad of ["abc", "1e9", "Infinity", "NaN", "0x10", "1,000", " 1", "12345678901", "1.23456", "99999999999.5"]) {
      expect(parseSnapshot(q(`sf=${encodeURIComponent(bad)}&sa=2&sd=2026-10-23`), NOW), bad).toBeNull();
    }
    expect(parseSnapshot(q("sf=1&sa=2000000&sd=2026-10-23"), NOW)).toBeNull(); // > 1e6 %
    expect(parseSnapshot(q("sf=1&sa=2&sn=oops&sd=2026-10-23"), NOW)).toBeNull(); // an invalid optional voids it
  });

  it("rejects impossible, ancient and future dates", () => {
    for (const d of ["2026-02-31", "2026-13-01", "2023-12-31", "2026-10-26", "26-10-23", "2026-10-23T00:00"]) {
      expect(parseSnapshot(q(`sf=1&sa=2&sd=${d}`), NOW), d).toBeNull();
    }
    expect(parseSnapshot(q("sf=1&sa=2&sd=2026-10-24"), NOW)).not.toBeNull(); // timezone slack
  });

  it("only allows token-symbol pairs and integer bin widths", () => {
    for (const p of ["<script>", "Send me ETH/now please", "A/B/C", "SKHYB", "SKHYB/USDT ", "A".repeat(13) + "/B", "ÉTH/USDT"]) {
      expect(parseSnapshot(q(`sf=1&sa=2&sd=2026-10-23&sp=${encodeURIComponent(p)}`), NOW), p).toBeNull();
    }
    expect(parseSnapshot(q("sf=1&sa=2&sd=2026-10-23&sw=100.5"), NOW)).toBeNull();
    expect(parseSnapshot(q("sf=1&sa=2&sd=2026-10-23&sw=0"), NOW)).toBeNull();
  });
});

describe("serialization and formatting", () => {
  const snap: Snapshot = { fees: 210.0912, feeApr: 255.6149, netApr: -11.4931, date: "2026-10-23", pair: "SKHYB/USDT", binWidthE6: 100 };

  it("rounds to 2 decimals in a fixed order and round-trips", () => {
    const s = snapshotParams(snap).toString();
    expect(s).toBe("sf=210.09&sa=255.61&sn=-11.49&sd=2026-10-23&sp=SKHYB%2FUSDT&sw=100");
    expect(parseSnapshot(q(s), NOW)).toEqual({ ...snap, fees: 210.09, feeApr: 255.61, netApr: -11.49 });
  });

  it("card and tweet use the same strings", () => {
    const f = formatSnapshot(snap);
    expect(f).toEqual({ fees: "+$210.09", feeApr: "255.61%", netApr: "-11.49%", asOf: "Oct 23, 2026" });
    const text = shareText(snap, 30);
    for (const v of [f.fees, f.feeApr, f.netApr!, f.asOf, "SKHYB/USDT", "30d"]) expect(text).toContain(v);
  });

  it("labels the range from the uniform bin width", () => {
    expect(snapshotRangeText({ from: -3, to: 1 }, 100)).toBe("#-3 (-0.025%) → #1 (+0.015%) · 5 bins");
    expect(snapshotRangeText({ from: -3, to: 1 }, null)).toBe("bins #-3 → #1 · 5 bins");
  });

  it("makes 6-char [a-z0-9] share ids", () => {
    expect(makeShareId()).toMatch(/^[a-z0-9]{6}$/);
    expect(makeShareId(() => new Uint8Array([0, 1, 25, 26, 35, 36]))).toBe("abz09a");
  });
});

describe("ogImageQuery", () => {
  it("is identical from the client's state and from the shared URL on the server, without the share id", () => {
    const pageQs = "chain=56&pool=0xee90641E7c3b4d6338Ab7f1c23Dfb979FAb5f096&amount=1000&days=30&from=-3&to=1&preset=90&strategy=uniform&period=7d";
    const snap = parseSnapshot(q(valid), NOW)!;
    const client = ogImageQuery(readState(q(pageQs)), { from: -3, to: 1 }, snap);
    const shared = q(`${pageQs}&${valid}&s=ab12cd&utm_source=x`);
    const server = ogImageQuery(readState(shared), rawRange(shared), parseSnapshot(shared, NOW));
    expect(server).toBe(client);
    expect(server).not.toContain("s=ab12cd");
    expect(server).not.toContain("utm_source");
    expect(server.endsWith("&v=2")).toBe(true);
  });
});

describe("freezeSnapshot", () => {
  it("rounds live values and returns exactly what /api/og will parse", async () => {
    const { freezeSnapshot } = await import("@/lib/share");
    const f = freezeSnapshot({ fees: 210.0949, feeApr: 255.6149, netApr: -11.4949, date: "2026-10-23", pair: "SKHYB/USDT", binWidthE6: 100 }, NOW)!;
    expect(f).toEqual({ fees: 210.09, feeApr: 255.61, netApr: -11.49, date: "2026-10-23", pair: "SKHYB/USDT", binWidthE6: 100 });
    expect(parseSnapshot(snapshotParams(f), NOW)).toEqual(f);
  });

  it("drops optional fields that would not validate instead of failing the share", async () => {
    const { freezeSnapshot } = await import("@/lib/share");
    const f = freezeSnapshot({ fees: 1, feeApr: 2, netApr: Number.NaN, date: "2026-10-23", pair: "WEIRD TOKEN/USDT", binWidthE6: 100 }, NOW)!;
    expect(f).toEqual({ fees: 1, feeApr: 2, netApr: null, date: "2026-10-23", pair: null, binWidthE6: null });
    expect(freezeSnapshot({ fees: 1e12, feeApr: 2, netApr: null, date: "2026-10-23", pair: null, binWidthE6: null }, NOW)).toBeNull();
  });
});

describe("portfolio snapshots", () => {
  it("parses, round-trips and never needs the wallet", async () => {
    const m = await import("@/lib/share");
    const raw = { value: 1234.567, pnl: -45.678, pnlApprox: true, feeApr: 42.123, count: 3, date: "2026-10-23" };
    const f = m.freezePortfolioSnapshot(raw, NOW)!;
    expect(f).toEqual({ value: 1234.57, pnl: -45.68, pnlApprox: true, feeApr: 42.12, count: 3, date: "2026-10-23" });
    const qs = m.portfolioOgQuery(f);
    expect(qs).toBe("pv=1234.57&pp=-45.68&px=1&pa=42.12&pc=3&sd=2026-10-23&v=2");
    expect(qs).not.toMatch(/0x|wallet/);
    expect(m.parsePortfolioSnapshot(q(qs), NOW)).toEqual(f);
    expect(m.portfolioOgQuery(null)).toBe("kind=portfolio&v=2");
  });

  it("formats card and tweet from the same strings", async () => {
    const m = await import("@/lib/share");
    const s = { value: 1234.57, pnl: -45.68, pnlApprox: true, feeApr: 42.12, count: 1, date: "2026-10-23" };
    const f = m.formatPortfolioSnapshot(s);
    expect(f).toEqual({ value: "$1,234.57", pnl: "−$45.68 (approx.)", feeApr: "42.12%", count: "1 position", asOf: "Oct 23, 2026" });
    const t = m.portfolioShareText(s);
    for (const v of [f.value, f.pnl!, f.feeApr!, f.count, f.asOf]) expect(t).toContain(v);
  });

  it("rejects text, negative or fractional counts, bad flags and out-of-range values", async () => {
    const m = await import("@/lib/share");
    for (const bad of ["pv=abc&pc=1&sd=2026-10-23", "pv=1&pc=-1&sd=2026-10-23", "pv=1&pc=1.5&sd=2026-10-23", "pv=1&pc=1&sd=2026-10-23&px=yes", "pv=-5&pc=1&sd=2026-10-23", "pv=1&pc=1&sd=2026-10-23&pp=1e5", "pv=1&pc=5000&sd=2026-10-23"]) {
      expect(m.parsePortfolioSnapshot(q(bad), NOW), bad).toBeNull();
    }
  });
});
