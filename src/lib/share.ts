/**
 * Share snapshots: the exact numbers a user saw, frozen into the shared link so the card, the
 * tweet text and the preview always match and /api/og can render without calling Metric.
 *
 * URL params (all strictly validated; any invalid param voids the whole snapshot):
 *   sf  est. fees over the plan's duration, USD          e.g. 210.09
 *   sa  fee APR, percent                                 e.g. 255.61
 *   sn  net APR (historical), percent — optional         e.g. -11.49
 *   sd  snapshot date, YYYY-MM-DD                        e.g. 2026-10-23
 *   sp  pool pair (token symbols only) — optional        e.g. SKHYB/USDT
 *   sw  bin width (lengthE6) when uniform — optional     e.g. 100
 *   s   per-share id that makes each shared link unique (never part of the image URL)
 */
import { fmtApr, fmtPlanPct, fmtUsd } from "./calc";
import { writeState, type PlannerState } from "./urlState";

export interface Snapshot {
  fees: number;
  feeApr: number;
  netApr: number | null;
  date: string;
  pair: string | null;
  binWidthE6: number | null;
}

export const SHARE_ID_KEY = "s";
export const SNAPSHOT_KEYS = ["sf", "sa", "sn", "sd", "sp", "sw"] as const;
/** Bump to make X / Slack refetch share images they cached (including cached failures). */
export const OG_VERSION = "2";

const MAX_LEN = 24;
const NUM = /^-?\d{1,10}(\.\d{1,4})?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PAIR = /^[A-Za-z0-9.+_-]{1,12}\/[A-Za-z0-9.+_-]{1,12}$/;
const MIN_DATE = Date.UTC(2024, 0, 1);

type Params = { get(key: string): string | null };

function num(raw: string, min: number, max: number): number | null {
  if (raw.length > MAX_LEN || !NUM.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function date(raw: string, now: number): string | null {
  const m = raw.length === 10 ? DATE.exec(raw) : null;
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(t);
  // Reject impossible dates (2026-02-31) and anything outside [2024-01-01, now + 2 days].
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return t >= MIN_DATE && t <= now + 2 * 86400_000 ? raw : null;
}

/** Returns the snapshot if every present snapshot param is valid and the required ones exist; else null. */
export function parseSnapshot(q: Params, now = Date.now()): Snapshot | null {
  const sf = q.get("sf");
  const sa = q.get("sa");
  const sd = q.get("sd");
  if (sf === null || sa === null || sd === null) return null;
  const fees = num(sf, -1e9, 1e9);
  const feeApr = num(sa, -1e6, 1e6);
  const day = date(sd, now);
  if (fees === null || feeApr === null || day === null) return null;

  const sn = q.get("sn");
  const netApr = sn === null ? null : num(sn, -1e6, 1e6);
  if (sn !== null && netApr === null) return null;

  const sp = q.get("sp");
  if (sp !== null && (sp.length > 25 || !PAIR.test(sp))) return null;

  const sw = q.get("sw");
  const width = sw === null ? null : num(sw, 1, 1_000_000);
  if (sw !== null && (width === null || !Number.isInteger(width))) return null;

  return { fees, feeApr, netApr, date: day, pair: sp, binWidthE6: width };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Snapshot params in a fixed order, values rounded to 2 decimals (what the card and tweet show). */
export function snapshotParams(s: Snapshot): URLSearchParams {
  const q = new URLSearchParams();
  q.set("sf", r2(s.fees).toFixed(2));
  q.set("sa", r2(s.feeApr).toFixed(2));
  if (s.netApr !== null) q.set("sn", r2(s.netApr).toFixed(2));
  q.set("sd", s.date);
  if (s.pair) q.set("sp", s.pair);
  if (s.binWidthE6 !== null) q.set("sw", String(s.binWidthE6));
  return q;
}

/**
 * Canonical og:image query for a plan: plan params (normalized, fixed order), then snapshot params,
 * then v. The share id is deliberately excluded so every share of the same numbers hits one cache entry.
 */
export function ogImageQuery(s: PlannerState, range: { from: number; to: number } | null, snap: Snapshot | null): string {
  const parts = [writeState(s, range)];
  if (snap) parts.push(snapshotParams(snap).toString());
  parts.push(`v=${OG_VERSION}`);
  return parts.join("&");
}

/** from/to as written in a URL (both integers), for rebuilding the same og query on the server. */
export function rawRange(q: Params): { from: number; to: number } | null {
  const f = q.get("from");
  const t = q.get("to");
  if (f === null || t === null || !/^-?\d{1,6}$/.test(f) || !/^-?\d{1,6}$/.test(t)) return null;
  return { from: Math.min(+f, +t), to: Math.max(+f, +t) };
}

/** 6 random [a-z0-9] chars. */
export function makeShareId(rand: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(rand(6), (b) => abc[b % abc.length]).join("");
}

/** Local calendar date as YYYY-MM-DD. */
export function today(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Display strings shared by the card and the tweet so they always match. */
export function formatSnapshot(s: Snapshot) {
  const fees = r2(s.fees);
  const net = s.netApr === null ? null : r2(s.netApr);
  return {
    fees: `${fees < 0 ? "−" : "+"}${fmtUsd(Math.abs(fees))}`,
    feeApr: fmtApr(r2(s.feeApr) / 100),
    netApr: net === null ? null : fmtApr(net / 100),
    asOf: new Date(`${s.date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }),
  };
}

/** Plan range label from a snapshot's uniform bin width, e.g. "#-3 (-0.025%) → #1 (+0.015%) · 5 bins". */
export function snapshotRangeText(range: { from: number; to: number }, widthE6: number | null): string {
  const n = range.to - range.from + 1;
  if (widthE6 === null) return `bins #${range.from} → #${range.to} · ${n} bins`;
  const mid = (i: number) => fmtPlanPct(((i + 0.5) * widthE6) / 1e4);
  return `#${range.from} (${mid(range.from)}) → #${range.to} (${mid(range.to)}) · ${n} bins`;
}

/** Tweet text built from the same formatted values as the card. */
export function shareText(s: Snapshot, days: number): string {
  const f = formatSnapshot(s);
  const pool = s.pair ?? "a Metric pool";
  const net = f.netApr === null ? "" : ` · net APR ${f.netApr} (historical)`;
  return `My LP plan for ${pool} on Binwise: est. ${f.fees} fees in ${days}d · fee APR ${f.feeApr}${net} (as of ${f.asOf})`;
}

/**
 * Freezes live values into a snapshot that is guaranteed to pass parseSnapshot (what /api/og will
 * accept): rounds to 2 decimals and drops optional fields that don't validate (e.g. an unusual pair
 * symbol). Returns null if even the required numbers are out of range.
 */
export function freezeSnapshot(raw: Snapshot, now = Date.now()): Snapshot | null {
  const tries: Snapshot[] = [raw, { ...raw, pair: null }, { ...raw, pair: null, binWidthE6: null }, { ...raw, pair: null, binWidthE6: null, netApr: null }];
  for (const t of tries) {
    if (![t.fees, t.feeApr, t.netApr ?? 0].every(Number.isFinite)) continue;
    const parsed = parseSnapshot(snapshotParams(t), now);
    if (parsed) return parsed;
  }
  return null;
}

// ---------- portfolio snapshots ----------

/**
 * Portfolio share snapshot. Never contains the wallet address: the card shows totals only.
 *   pv total value USD · pp PnL vs HODL USD (optional) · px "1" if PnL is approximate
 *   pa value-weighted fee APR % (optional) · pc number of positions · sd date
 */
export interface PortfolioSnapshot {
  value: number;
  pnl: number | null;
  pnlApprox: boolean;
  feeApr: number | null;
  count: number;
  date: string;
}

export const PORTFOLIO_SNAPSHOT_KEYS = ["pv", "pp", "px", "pa", "pc", "sd"] as const;

export function parsePortfolioSnapshot(q: Params, now = Date.now()): PortfolioSnapshot | null {
  const pv = q.get("pv");
  const pc = q.get("pc");
  const sd = q.get("sd");
  if (pv === null || pc === null || sd === null) return null;
  const value = num(pv, 0, 1e10);
  const count = num(pc, 0, 1000);
  const day = date(sd, now);
  if (value === null || count === null || !Number.isInteger(count) || day === null) return null;
  const pp = q.get("pp");
  const pnl = pp === null ? null : num(pp, -1e10, 1e10);
  if (pp !== null && pnl === null) return null;
  const pa = q.get("pa");
  const feeApr = pa === null ? null : num(pa, -1e6, 1e6);
  if (pa !== null && feeApr === null) return null;
  const px = q.get("px");
  if (px !== null && px !== "1") return null;
  return { value, pnl, pnlApprox: px === "1", feeApr, count, date: day };
}

export function portfolioSnapshotParams(s: PortfolioSnapshot): URLSearchParams {
  const q = new URLSearchParams();
  q.set("pv", r2(s.value).toFixed(2));
  if (s.pnl !== null) q.set("pp", r2(s.pnl).toFixed(2));
  if (s.pnlApprox && s.pnl !== null) q.set("px", "1");
  if (s.feeApr !== null) q.set("pa", r2(s.feeApr).toFixed(2));
  q.set("pc", String(s.count));
  q.set("sd", s.date);
  return q;
}

/** Rounds and validates like freezeSnapshot; drops optional fields that don't validate. */
export function freezePortfolioSnapshot(raw: PortfolioSnapshot, now = Date.now()): PortfolioSnapshot | null {
  const tries: PortfolioSnapshot[] = [raw, { ...raw, feeApr: null }, { ...raw, feeApr: null, pnl: null, pnlApprox: false }];
  for (const t of tries) {
    if (![t.value, t.pnl ?? 0, t.feeApr ?? 0].every(Number.isFinite)) continue;
    const parsed = parsePortfolioSnapshot(portfolioSnapshotParams(t), now);
    if (parsed) return parsed;
  }
  return null;
}

export function formatPortfolioSnapshot(s: PortfolioSnapshot) {
  const pnl = s.pnl === null ? null : r2(s.pnl);
  return {
    value: fmtUsd(r2(s.value)),
    pnl: pnl === null ? null : `${pnl < 0 ? "−" : "+"}${fmtUsd(Math.abs(pnl))}${s.pnlApprox ? " (approx.)" : ""}`,
    feeApr: s.feeApr === null ? null : fmtApr(r2(s.feeApr) / 100),
    count: `${s.count} position${s.count === 1 ? "" : "s"}`,
    asOf: new Date(`${s.date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }),
  };
}

export function portfolioShareText(s: PortfolioSnapshot): string {
  const f = formatPortfolioSnapshot(s);
  const parts = [`${f.value} across ${f.count}`];
  if (f.pnl) parts.push(`PnL vs HODL ${f.pnl}`);
  if (f.feeApr) parts.push(`fee APR ${f.feeApr}`);
  return `My Metric LP portfolio on Binwise: ${parts.join(" · ")} (as of ${f.asOf})`;
}

/** og:image query for the portfolio page: snapshot totals only (never the wallet), else the generic card. */
export function portfolioOgQuery(snap: PortfolioSnapshot | null): string {
  return snap ? `${portfolioSnapshotParams(snap)}&v=${OG_VERSION}` : `kind=portfolio&v=${OG_VERSION}`;
}

// ---------- top pools snapshots ----------

/**
 * Top-pools share snapshot (the /pools card): up to 5 rows, each pair + net APR % + fee APR %, plus date
 * and an optional chain scope. Params: tp1..tp5 (pair), tn1..tn5 (net %), tf1..tf5 (fee %, optional),
 * tch (chain id, optional), sd. Rows must be contiguous from 1; anything invalid voids the snapshot.
 */
export interface TopSnapshot {
  rows: { pair: string; netApr: number; feeApr: number | null }[];
  chainId: number | null;
  date: string;
}

const TOP_CHAINS = [1, 56, 4663];

export function parseTopSnapshot(q: Params, now = Date.now()): TopSnapshot | null {
  const sd = q.get("sd");
  const day = sd === null ? null : date(sd, now);
  if (day === null || q.get("tp1") === null) return null;
  const rows: TopSnapshot["rows"] = [];
  for (let i = 1; i <= 5; i++) {
    const pair = q.get(`tp${i}`);
    const tn = q.get(`tn${i}`);
    const tf = q.get(`tf${i}`);
    if (pair === null) {
      if (tn !== null || tf !== null) return null;
      // rows must be contiguous: nothing may follow a gap
      for (let j = i + 1; j <= 5; j++) if (q.get(`tp${j}`) !== null) return null;
      break;
    }
    if (pair.length > 25 || !PAIR.test(pair) || tn === null) return null;
    const netApr = num(tn, -1e6, 1e6);
    const feeApr = tf === null ? null : num(tf, -1e6, 1e6);
    if (netApr === null || (tf !== null && feeApr === null)) return null;
    rows.push({ pair, netApr, feeApr });
  }
  const tch = q.get("tch");
  const chainId = tch === null ? null : Number(tch);
  if (tch !== null && (!/^\d+$/.test(tch) || !TOP_CHAINS.includes(chainId!))) return null;
  return { rows, chainId, date: day };
}

export function topSnapshotParams(s: TopSnapshot): URLSearchParams {
  const q = new URLSearchParams();
  s.rows.slice(0, 5).forEach((r, i) => {
    q.set(`tp${i + 1}`, r.pair);
    q.set(`tn${i + 1}`, r2(r.netApr).toFixed(2));
    if (r.feeApr !== null) q.set(`tf${i + 1}`, r2(r.feeApr).toFixed(2));
  });
  if (s.chainId !== null) q.set("tch", String(s.chainId));
  q.set("sd", s.date);
  return q;
}

/** Rounds and validates; drops rows whose pair doesn't validate (e.g. unusual symbols). */
export function freezeTopSnapshot(raw: TopSnapshot, now = Date.now()): TopSnapshot | null {
  const rows = raw.rows
    .filter((r) => Number.isFinite(r.netApr) && (r.feeApr === null || Number.isFinite(r.feeApr)) && PAIR.test(r.pair) && r.pair.length <= 25)
    .slice(0, 5);
  if (rows.length === 0) return null;
  return parseTopSnapshot(topSnapshotParams({ ...raw, rows }), now);
}

/** og:image query for /pools: the top-5 snapshot, else the generic card. */
export function topOgQuery(snap: TopSnapshot | null): string {
  return snap ? `${topSnapshotParams(snap)}&v=${OG_VERSION}` : `kind=pools&v=${OG_VERSION}`;
}

// ---------- compare snapshots ----------

/**
 * Compare-ranges snapshot (the /compare card): 1–3 columns, each a bin range + fee APR % + net APR %
 * (optional) + est. fees $ for the duration, optionally with its own pool pair. Plus pool pair, chain,
 * duration and date. Params: cp, cc, cdays, sd, and per column i: ca{i}, cb{i}, cf{i}, cn{i}, ce{i}, cq{i}.
 */
export interface CompareSnapshot {
  pair: string | null;
  chainId: number | null;
  days: number;
  date: string;
  cols: { from: number; to: number; feeApr: number; netApr: number | null; fees: number; pair: string | null }[];
}

const BIN = /^-?\d{1,6}$/;

export function parseCompareSnapshot(q: Params, now = Date.now()): CompareSnapshot | null {
  const sd = q.get("sd");
  const day = sd === null ? null : date(sd, now);
  const cdays = q.get("cdays");
  if (day === null || cdays === null || q.get("ca1") === null) return null;
  const days = num(cdays, 1, 3650);
  if (days === null || !Number.isInteger(days)) return null;
  const pairOk = (p: string | null) => p === null || (p.length <= 25 && PAIR.test(p));
  const cp = q.get("cp");
  if (!pairOk(cp)) return null;
  const cc = q.get("cc");
  if (cc !== null && (!/^\d+$/.test(cc) || !TOP_CHAINS.includes(Number(cc)))) return null;
  const cols: CompareSnapshot["cols"] = [];
  for (let i = 1; i <= 3; i++) {
    const ca = q.get(`ca${i}`);
    if (ca === null) {
      for (let j = i; j <= 3; j++) if (["ca", "cb", "cf", "cn", "ce", "cq"].some((k) => q.get(`${k}${j}`) !== null)) return null;
      break;
    }
    const cb = q.get(`cb${i}`);
    const cf = q.get(`cf${i}`);
    const cn = q.get(`cn${i}`);
    const ce = q.get(`ce${i}`);
    const cq = q.get(`cq${i}`);
    if (cb === null || cf === null || ce === null || !BIN.test(ca) || !BIN.test(cb) || !pairOk(cq)) return null;
    const feeApr = num(cf, -1e6, 1e6);
    const netApr = cn === null ? null : num(cn, -1e6, 1e6);
    const fees = num(ce, -1e9, 1e9);
    if (feeApr === null || fees === null || (cn !== null && netApr === null)) return null;
    const a = Number(ca);
    const b = Number(cb);
    cols.push({ from: Math.min(a, b), to: Math.max(a, b), feeApr, netApr, fees, pair: cq });
  }
  return { pair: cp, chainId: cc === null ? null : Number(cc), days, date: day, cols };
}

export function compareSnapshotParams(s: CompareSnapshot): URLSearchParams {
  const q = new URLSearchParams();
  if (s.pair) q.set("cp", s.pair);
  if (s.chainId !== null) q.set("cc", String(s.chainId));
  q.set("cdays", String(s.days));
  s.cols.slice(0, 3).forEach((c, i) => {
    const n = i + 1;
    q.set(`ca${n}`, String(c.from));
    q.set(`cb${n}`, String(c.to));
    q.set(`cf${n}`, r2(c.feeApr).toFixed(2));
    if (c.netApr !== null) q.set(`cn${n}`, r2(c.netApr).toFixed(2));
    q.set(`ce${n}`, r2(c.fees).toFixed(2));
    if (c.pair) q.set(`cq${n}`, c.pair);
  });
  q.set("sd", s.date);
  return q;
}

/** Rounds and validates; drops pair labels that don't validate and non-finite optional values. */
export function freezeCompareSnapshot(raw: CompareSnapshot, now = Date.now()): CompareSnapshot | null {
  const okPair = (p: string | null) => (p !== null && p.length <= 25 && PAIR.test(p) ? p : null);
  const cols = raw.cols
    .filter((c) => Number.isFinite(c.feeApr) && Number.isFinite(c.fees))
    .slice(0, 3)
    .map((c) => ({ ...c, netApr: c.netApr !== null && Number.isFinite(c.netApr) ? c.netApr : null, pair: okPair(c.pair) }));
  if (cols.length === 0) return null;
  return parseCompareSnapshot(compareSnapshotParams({ ...raw, pair: okPair(raw.pair), cols }), now);
}

export function compareOgQuery(snap: CompareSnapshot | null): string {
  return snap ? `${compareSnapshotParams(snap)}&v=${OG_VERSION}` : `kind=compare&v=${OG_VERSION}`;
}
