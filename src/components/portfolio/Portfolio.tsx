"use client";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { fmtApr, fmtUsd } from "@/lib/calc";
import { chainName } from "@/lib/normalize";
import type { PortfolioResponse } from "@/lib/portfolio/types";
import { freezePortfolioSnapshot, formatPortfolioSnapshot, makeShareId, portfolioOgQuery, portfolioShareText, portfolioSnapshotParams, today } from "@/lib/share";
import { CHAINS } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { ShareMenu, type ShareLinks } from "../ShareMenu";
import { Card, CountUp, ErrorNote, InfoTip, Segmented, Skeleton, inputCls } from "../ui";
import PositionCard, { APR_TIP, FEES_TIP, NET_TIP, PoolStat, ResultRow } from "./PositionCard";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const RATE_LABEL = { "24h": "24h", "7d": "7d", mixed: "24h/7d" } as const;
/** Optional demo wallet, configured per deploy (never committed). */
const EXAMPLE_WALLET = process.env.NEXT_PUBLIC_EXAMPLE_WALLET;

const stagger: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const rise: Variants = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" } } };

export default function Portfolio() {
  const router = useRouter();
  const params = useSearchParams();
  const wallet = params.get("wallet") ?? "";
  const chainParam = params.get("chain");
  const chain = chainParam && CHAINS[Number(chainParam)] ? Number(chainParam) : null;
  const valid = ADDRESS.test(wallet);
  const res = useApi<PortfolioResponse>(valid ? `/api/positions?wallet=${wallet}${chain ? `&chain=${chain}` : ""}` : null);

  const go = (w: string, c: number | null) => {
    const q = new URLSearchParams();
    if (w) q.set("wallet", w);
    if (c) q.set("chain", String(c));
    router.replace(`/portfolio${q.size ? `?${q}` : ""}`, { scroll: false });
  };

  // Drop share-snapshot params once the page is open: it always shows live data.
  useEffect(() => {
    if (params.has("pv") || params.has("s")) go(wallet, chain);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <WalletBar wallet={wallet} chain={chain} onSubmit={go} />
      {!wallet && <Intro />}
      {wallet && !valid && <ErrorNote message="That doesn't look like a wallet address (0x followed by 40 hex characters)." />}
      {valid && res.loading && !res.data && <PortfolioSkeleton />}
      {valid && res.error && !res.data && <ErrorNote message={res.error} retryAfter={res.retryAfter} onRetry={res.retry} />}
      {valid && res.data && <Results data={res.data} onRetry={res.retry} />}
    </div>
  );
}

function WalletBar({ wallet, chain, onSubmit }: { wallet: string; chain: number | null; onSubmit: (w: string, c: number | null) => void }) {
  const [text, setText] = useState(wallet);
  useEffect(() => setText(wallet), [wallet]);
  const submit = () => onSubmit(text.trim(), chain);
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <form
          className="flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste any wallet address (0x…)"
            aria-label="Wallet address"
            spellCheck={false}
            autoComplete="off"
            className={`${inputCls} py-2.5`}
          />
          <button type="submit" className="shrink-0 rounded-lg bg-accent px-4 text-sm font-semibold text-bg transition hover:brightness-110">
            View
          </button>
        </form>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<number | "all">
            size="sm"
            value={chain ?? "all"}
            onChange={(v) => onSubmit(wallet, v === "all" ? null : v)}
            options={[{ value: "all" as const, label: "All chains" }, ...Object.entries(CHAINS).map(([id, c]) => ({ value: Number(id), label: c.short, title: c.name }))]}
          />
          {EXAMPLE_WALLET && ADDRESS.test(EXAMPLE_WALLET) && (
            <button
              type="button"
              onClick={() => onSubmit(EXAMPLE_WALLET, chain)}
              className="rounded-lg bg-surface-2 px-3 py-1.5 text-xs text-muted transition hover:bg-surface-3 hover:text-text"
            >
              Try an example
            </button>
          )}
        </div>
      </div>
      <p className="mt-2.5 flex items-center gap-1.5 text-[11px] text-faint">
        Read-only: public onchain data and Metric&apos;s public API. No wallet connection, no signatures.
      </p>
    </Card>
  );
}

function Intro() {
  return (
    <Card className="flex min-h-[320px] flex-col items-center justify-center p-10 text-center">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your Metric LP positions, at a glance.</h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
        Paste any wallet to see its positions across Ethereum, BNB Chain and Robinhood Chain: value, fees, PnL vs holding, and which bins are idle
        or out of range.
      </p>
    </Card>
  );
}

function Results({ data, onRetry }: { data: PortfolioResponse; onRetry: () => void }) {
  const reduced = useReducedMotion();
  return (
    <motion.div className="space-y-4" variants={stagger} initial={reduced ? false : "hidden"} animate="show">
      {data.errors.length > 0 && (
        <motion.div variants={rise}>
          <ErrorNote message={`Couldn't load ${data.errors.map((e) => chainName(e.chainId)).join(", ")} — results may be incomplete.`} onRetry={onRetry} />
        </motion.div>
      )}

      {data.positions.length === 0 ? (
        <motion.div variants={rise}>
          <Card className="flex min-h-[260px] flex-col items-center justify-center p-10 text-center">
            <h2 className="text-xl font-semibold tracking-tight">No open Metric LP positions</h2>
            <p className="mt-2 max-w-sm text-sm text-muted">
              {data.closed > 0
                ? `This wallet had ${data.closed} position${data.closed === 1 ? "" : "s"}, all fully withdrawn.`
                : "This wallet hasn't added liquidity to a Metric pool on the selected chains."}
            </p>
            <Link href="/" className="mt-5 rounded-lg bg-accent/15 px-3 py-1.5 text-[13px] font-medium text-accent hover:bg-accent/25">
              Plan a position →
            </Link>
          </Card>
        </motion.div>
      ) : (
        <>
          <motion.div variants={rise}>
            <SummaryHero data={data} />
          </motion.div>
          {data.positions.map((p) => (
            <motion.div key={`${p.chainId}-${p.pool}-${p.salt}`} variants={rise}>
              <PositionCard p={p} />
            </motion.div>
          ))}
          {data.closed > 0 && (
            <p className="text-center text-xs text-faint">
              + {data.closed} closed position{data.closed === 1 ? "" : "s"} (fully withdrawn)
            </p>
          )}
        </>
      )}
      <p className="text-center text-[11px] text-faint">
        Values use Metric&apos;s current bin reserves; fees and APRs use 7d bin rates (24h for positions younger than 2 days). Updated{" "}
        {new Date(data.generatedAt).toLocaleTimeString()} · Fees ≠ profit.
      </p>
    </motion.div>
  );
}

function SummaryHero({ data }: { data: PortfolioResponse }) {
  const s = data.summary;
  const build = (): ShareLinks => {
    const snap = freezePortfolioSnapshot({
      value: s.valueUsd,
      pnl: s.pnlUsd,
      pnlApprox: s.pnlApprox,
      feeApr: s.yourFeeApr === null ? null : s.yourFeeApr * 100,
      count: s.count,
      date: today(),
    });
    const origin = window.location.origin;
    const page = new URLSearchParams({ wallet: data.wallet });
    return {
      link: `${origin}/portfolio?${page}${snap ? `&${portfolioSnapshotParams(snap)}` : ""}&s=${makeShareId()}`,
      image: `${origin}/api/og?${portfolioOgQuery(snap)}`,
      text: snap ? portfolioShareText(snap) : "My Metric LP portfolio on Binwise",
      asOf: snap ? formatPortfolioSnapshot(snap).asOf : null,
      fileName: "binwise-portfolio.png",
    };
  };
  return (
    <Card glow={s.pnlUsd === null ? "none" : s.pnlUsd >= 0 ? "good" : "bad"} className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-faint">
            Total value · {s.count} position{s.count === 1 ? "" : "s"}
          </div>
          <CountUp value={s.valueUsd} format={(v) => fmtUsd(v)} className="mt-1 block text-4xl font-semibold tracking-tight sm:text-5xl" />
        </div>
        <ShareMenu build={build} />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-4">
        <HeroStat
          label={`Est. fees since deposit (from ${RATE_LABEL[s.ratePeriod]} rates)`}
          tip={FEES_TIP}
        >
          <CountUp value={s.feesUsd} format={(v) => fmtUsd(v)} />
        </HeroStat>
        <HeroStat label={`Your fee APR (${RATE_LABEL[s.ratePeriod]})`} tip={APR_TIP}>
          <span className="num text-accent">{fmtApr(s.yourFeeApr)}</span>
        </HeroStat>
      </div>
      <ResultRow
        pnlUsd={s.pnlUsd}
        pnlApprox={s.pnlApprox}
        annualized={s.pnlAnnualized}
        tip="Current value minus what the net deposited tokens would be worth today; annualized over the (HODL-weighted) time held, shown after 1 day. Approximate when deposit units can't be calibrated against onchain bin balances."
      />
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-faint">
        <PoolStat label={`Bins' ${RATE_LABEL[s.ratePeriod]} net APR (pool)`} value={s.binsNetApr} estUsd={s.estNetUsd} signed tip={NET_TIP} />
      </div>
    </Card>
  );
}

function HeroStat({ label, tip, children }: { label: string; tip: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-faint">
        {label}
        <InfoTip>{tip}</InfoTip>
      </div>
      <div className="mt-1 text-2xl font-semibold">{children}</div>
    </div>
  );
}

function PortfolioSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading positions">
      <Card className="space-y-4 p-6">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-12 w-56" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      </Card>
      {[0, 1].map((i) => (
        <Card key={i} className="space-y-4 p-5">
          <Skeleton className="h-6 w-64" />
          <div className="grid grid-cols-5 gap-4">
            {[0, 1, 2, 3, 4].map((j) => (
              <Skeleton key={j} className="h-10" />
            ))}
          </div>
          <Skeleton className="h-6" />
          <Skeleton className="h-4 w-3/4" />
        </Card>
      ))}
    </div>
  );
}
