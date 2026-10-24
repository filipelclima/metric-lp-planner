"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmtUsd, projectFees, type BinData } from "@/lib/calc";
import {
  RANGE_PRESET,
  ambiguityTitle,
  binsAround,
  distinctRange,
  parseIntent,
  poolChipLabel,
  poolRiskWarning,
  understoodAnything,
  type ParsedIntent,
  type RangeWord,
} from "@/lib/intent";
import { activePreset, tokenNeeds, widerRange } from "@/lib/rangeInputs";
import { CHAINS, type Pool } from "@/lib/types";
import type { PlannerModel } from "@/lib/usePlanner";
import type { PlannerState } from "@/lib/urlState";
import { InfoTip, TierBadge, inputCls } from "./ui";

type Outcome =
  | { kind: "applied"; prev: PlannerState; notes: string[]; word?: RangeWord; widened?: boolean }
  | { kind: "choose"; intent: ParsedIntent; options: Pool[] }
  | { kind: "notFound"; intent: ParsedIntent; query: string; suggestions: Pool[] }
  | { kind: "nothing"; unknown: string[] };

/** A range that needs the (new) pool's bins before it can be turned into bin numbers. */
type Pending = { kind: "wider" } | { kind: "around"; pct: number } | { kind: "word"; word: Exclude<RangeWord, "wider"> };

const RANGE_LABEL: Record<string, string> = { "80": "narrow", "90": "medium", "95": "wide", wider: "wider", manual: "custom" };
const binWidthPct = (d: BinData) => d.defaultLengthE6 / 1e4;

/**
 * "Describe your plan": free text → planner form, with a rule-based parser (lib/intent.ts). No AI, no API
 * keys. It only fills the form; every number in the summary comes from the planner's own estimate.
 */
export default function DescribePlan({ m }: { m: PlannerModel }) {
  const [text, setText] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const sawLoading = useRef(false);
  const pools = useMemo(() => m.list.data?.pools ?? [], [m.list.data]);

  // Apply a pending Wider / ±x% range once the new pool's bins have been (re)fetched.
  useEffect(() => {
    if (!pending) return;
    if (m.bins.loading) {
      sawLoading.current = true;
      return;
    }
    if (!sawLoading.current) return;
    if (!m.binData) {
      // Bins failed to load: keep the placeholder preset rather than waiting forever.
      setPending(null);
      sawLoading.current = false;
      return;
    }
    const d = m.binData;
    if (pending.kind === "word") {
      const r = distinctRange(pending.word, d);
      if (r.widened) {
        m.set({ range: r.range });
        setOutcome((o) => (o?.kind === "applied" ? { ...o, widened: true } : o));
      }
    } else m.set({ range: { kind: "manual", ...(pending.kind === "wider" ? widerRange(d) : binsAround(pending.pct, binWidthPct(d))) } });
    setPending(null);
    sawLoading.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, m.bins.loading, m.binData]);

  const apply = (intent: ParsedIntent, pool: Pool | null, extraNotes: string[] = []) => {
    const prev = m.s;
    const notes = [...extraNotes, ...intent.notes];
    const patch: Partial<PlannerState> = {};
    const poolChanged = !!pool && (pool.chainId !== prev.chain || pool.poolAddress.toLowerCase() !== prev.pool?.toLowerCase());
    if (pool && poolChanged) Object.assign(patch, { chain: pool.chainId, pool: pool.poolAddress });
    if (intent.amount !== undefined) patch.amount = intent.amount;
    else notes.push(`No amount found, so the deposit stays at ${fmtUsd(prev.amount)}.`);
    if (intent.days !== undefined) patch.days = intent.days;
    if (intent.distribution) patch.strategy = intent.distribution;
    if (intent.period) patch.period = intent.period;
    if (intent.chain !== undefined && !intent.pairQuery) notes.push("Name a pool to switch chains; the chain alone was ignored.");

    // Range: explicit bins > preset words > Wider / ±x% (need bin data) > keep (or 90% for a new pool).
    const sameData = !poolChanged && (!intent.period || intent.period === prev.period) && !!m.binData && !m.bins.loading;
    let wait: Pending | null = null;
    let widened = false;
    if (intent.bins) patch.range = { kind: "manual", ...intent.bins };
    else if (intent.range && intent.range !== "wider") {
      // Kept distinct from the next narrower word on concentrated pools (needs this pool's bins).
      if (sameData) {
        const r = distinctRange(intent.range, m.binData!);
        patch.range = r.range;
        widened = r.widened;
      } else {
        patch.range = { kind: "preset", share: RANGE_PRESET[intent.range] };
        if (intent.range !== "narrow") wait = { kind: "word", word: intent.range };
      }
    }
    else if (intent.range === "wider") {
      if (sameData) patch.range = { kind: "manual", ...widerRange(m.binData!) };
      else wait = { kind: "wider" };
    } else if (intent.aroundPct !== undefined) {
      if (sameData) patch.range = { kind: "manual", ...binsAround(intent.aroundPct, binWidthPct(m.binData!)) };
      else wait = { kind: "around", pct: intent.aroundPct };
    } else if (poolChanged) patch.range = { kind: "preset", share: 90 };
    if (wait && !patch.range) patch.range = { kind: "preset", share: 95 }; // placeholder until the bins arrive

    sawLoading.current = false;
    setPending(wait);
    m.set(patch);
    setOutcome({ kind: "applied", prev, notes, word: intent.range, widened });
  };

  const submit = async (value = text) => {
    const t = value.trim();
    if (!t) return;
    const { intent, match } = await parseIntent(t, pools);
    if (!understoodAnything(intent)) return setOutcome({ kind: "nothing", unknown: intent.unknown });
    if (match.kind === "choose") return setOutcome({ kind: "choose", intent, options: match.options });
    if (match.kind === "notFound") return setOutcome({ kind: "notFound", intent, query: match.query, suggestions: match.suggestions });
    if (match.kind === "one") return apply(intent, match.pool, match.note ? [match.note] : []);
    if (!m.s.pool) return setOutcome({ kind: "notFound", intent, query: "", suggestions: [...pools].sort((a, b) => b.tvlFiat - a.tvlFiat).slice(0, 3) });
    apply(intent, null);
  };

  const undo = () => {
    if (outcome?.kind !== "applied") return;
    setPending(null);
    m.set(outcome.prev);
    setOutcome(null);
  };

  const examples = useMemo(() => {
    const top = [...pools].filter((p) => p.tvlFiat > 0).sort((a, b) => b.tvlFiat - a.tvlFiat);
    const a = top[0]?.pair ?? "AI/USDG";
    const b = top[1]?.token0.symbol ?? "SKHYB";
    const c = top[2]?.pair ?? "WETH/USDC";
    return [`Deposit $200 on ${a} with a medium range for 60 days`, `1.5k on ${b}, wide range, 3 months`, `Depositar 500 dólares en ${c}, rango estrecho, 30 días`];
  }, [pools]);

  return (
    <div className="rounded-2xl bg-surface p-4 sm:p-5">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="sr-only" htmlFor="describe-plan">
          Describe your plan
        </label>
        <input
          id="describe-plan"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Deposit $200 on AI/USDG with a medium range for 60 days"
          className={`${inputCls.replace(" num", "")} flex-1 py-2.5`}
          autoComplete="off"
        />
        <div className="flex items-center gap-2">
          <button type="submit" disabled={!text.trim()} className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-bg transition hover:brightness-110 disabled:opacity-40">
            Fill planner
          </button>
          <InfoTip side="bottom">
            <span className="block font-medium text-text">How to write it</span>
            <span className="mt-1 block">
              Amount: $200, 200 dollars, 1.5k, 2,000 · Pool: AI/USDG, AI-USDG, &quot;on SKHYB&quot; · Chain: on BNB / Ethereum / Robinhood · Range: narrow (80%), medium (90%), wide (95%), very wide / max (Wider), &quot;#-3 to #2&quot;, &quot;±0.1%&quot; · Duration: 60 days, 2 months, a quarter, 1 week, a year · Distribution: even, curve, by fees · Data: &quot;using 24h data&quot;, &quot;based on last week&quot;.
            </span>
            <span className="mt-1 block">Also in Portuguese, Spanish, French, Turkish, Chinese, Vietnamese and Russian. Rule-based (no AI): it only fills the form.</span>
          </InfoTip>
        </div>
      </form>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {examples.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => {
              setText(ex);
              void submit(ex);
            }}
            className="max-w-full truncate rounded-full bg-surface-2 px-2.5 py-1 text-[11px] text-muted transition hover:bg-surface-3 hover:text-text"
          >
            {ex}
          </button>
        ))}
      </div>

      <AnimatePresence initial={false}>
        {outcome && (
          <motion.div key={outcome.kind} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-3 text-sm" role="status">
            {outcome.kind === "applied" && <Summary m={m} notes={outcome.notes} word={outcome.word} widened={!!outcome.widened} pending={!!pending} onUndo={undo} />}
            {outcome.kind === "choose" && (
              <Choices title={ambiguityTitle(outcome.options)} pools={outcome.options} onPick={(p) => apply(outcome.intent, p)} />
            )}
            {outcome.kind === "notFound" && (
              <Choices
                title={outcome.query ? `Couldn't find ${outcome.query}. Did you mean:` : "Which pool? Name a pair, or pick one:"}
                pools={outcome.suggestions}
                onPick={(p) => apply(outcome.intent, p)}
              />
            )}
            {outcome.kind === "nothing" && (
              <p className="text-warn">
                Couldn&apos;t understand that{outcome.unknown.length ? ` (didn't recognise: ${outcome.unknown.slice(0, 6).join(", ")})` : ""}. Try one of the examples above.
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Choices({ title, pools, onPick }: { title: string; pools: Pool[]; onPick: (p: Pool) => void }) {
  return (
    <div>
      <p className="text-warn">{title}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {pools.map((p) => (
          <button
            key={`${p.chainId}:${p.poolAddress}`}
            type="button"
            onClick={() => onPick(p)}
            className="num inline-flex max-w-full items-center gap-2 truncate rounded-full bg-surface-2 px-3 py-1 text-xs text-text ring-1 ring-line transition hover:ring-accent/50"
          >
            <TierBadge tier={p.tier} isPrivate={p.isPrivate} />
            <span>{poolChipLabel(p)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** "Done: $200 on AI/USDG (RH) · medium range #-3 → #1 · 60 days. You'll need ≈ … · est. fees $12.30", live from the planner. */
function Summary({
  m,
  notes,
  word,
  widened,
  pending,
  onUndo,
}: {
  m: PlannerModel;
  notes: string[];
  word?: RangeWord;
  widened: boolean;
  pending: boolean;
  onUndo: () => void;
}) {
  const { s, pool, range, estimate, binData } = m;
  // Wait for the pool and its bins; if bins fail, finish with what the planner has (pool-level estimate or none).
  const ready = !!pool && !pending && !m.bins.loading && !m.meta.loading;
  let line = "Filling the planner…";
  let warning: string | null = null;
  if (ready) {
    const label = widened && word ? word : RANGE_LABEL[String(activePreset(s.range, binData))];
    const rangeText = range ? `${label} range #${range.from} → #${range.to}${widened ? " (widened, pool is concentrated)" : ""}` : `${label} range (no per-bin data)`;
    let tail = "No estimate for this pool right now.";
    if (estimate) {
      const needs = tokenNeeds(estimate, pool.token0, pool.token1)
        .parts.map((p) => (p.amount !== null ? `${p.amount} ${p.symbol} (${p.usd})` : `${p.usd} of ${p.symbol} (price n/a)`))
        .join(" + ");
      const fees = projectFees(estimate.dailyFees, estimate.deposit, s.days).simple;
      tail = `${needs ? `You'll need ≈ ${needs} · ` : ""}est. fees ${fmtUsd(fees)}`;
    }
    warning = poolRiskWarning(pool, s.amount, estimate?.apr ?? null);
    line = `Done: ${fmtUsd(s.amount)} on ${pool.pair} (${CHAINS[pool.chainId]?.short ?? pool.chainId}) · ${rangeText} · ${s.days} days. ${tail}`;
  }
  return (
    <div className="rounded-xl bg-accent/8 px-3 py-2 ring-1 ring-accent/25">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-[13px] tabular-nums text-text">{line}</p>
        <button type="button" onClick={onUndo} className="shrink-0 rounded-lg bg-surface-2 px-2.5 py-1 text-xs text-text transition hover:bg-surface-3">
          Undo
        </button>
      </div>
      {warning && <p className="mt-1 text-[12px] font-medium text-warn">{warning}</p>}
      {notes.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[12px] text-muted">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
