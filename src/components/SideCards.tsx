import { curatorName } from "@/lib/intent";
import { fmtUsd } from "@/lib/calc";
import { chainName } from "@/lib/normalize";
import type { Pool } from "@/lib/types";
import { Card, ChainBadge, InfoTip, SectionLabel } from "./ui";

export const metricPoolUrl = (p: Pick<Pool, "chainId" | "poolAddress">) => `https://app.metric.xyz/pool/${p.chainId}/${p.poolAddress}`;

/** Compact pool facts: TVL, 24h volume and fees, curator, chain. */
export function PoolStats({ pool }: { pool: Pool }) {
  const a = pool.analytics24h;
  return (
    <Card className="p-5">
      <SectionLabel right={<ChainBadge chainId={pool.chainId} />}>Pool stats</SectionLabel>
      <dl className="grid grid-cols-3 gap-3">
        <Stat label="TVL" value={fmtUsd(pool.tvlFiat, { compact: true })} />
        <Stat label="24h volume" value={a ? fmtUsd(a.volumeFiat, { compact: true }) : "—"} />
        <Stat label="24h fees" value={a ? fmtUsd(a.feesFiat, { compact: true }) : "—"} />
      </dl>
      <dl className="mt-3 space-y-1.5 text-[13px]">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-faint">Curator</dt>
          <dd className="truncate text-right">
            {pool.adminUsername ?? <span className="num text-muted" title={pool.admin ?? undefined}>{curatorName(pool)}</span>}
            {pool.verifiedAdmin ? <span className="ml-1.5 text-good">✓</span> : <span className="ml-1.5 text-xs text-warn">unverified</span>}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-faint">Chain</dt>
          <dd>{chainName(pool.chainId)}</dd>
        </div>
      </dl>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.08em] text-faint">{label}</dt>
      <dd className="num mt-0.5 text-[15px]">{value}</dd>
    </div>
  );
}

/** Three steps from plan to position, with a link to the pool on app.metric.xyz. */
export function HowItWorks({ pool }: { pool: Pool | null }) {
  const steps = ["Pick a pool & amount", "Choose a range", "Fill these bins on app.metric.xyz"];
  return (
    <Card className="p-5">
      <SectionLabel
        right={
          <InfoTip side="bottom">
            Binwise only plans. You add liquidity yourself on Metric, bin by bin, using the start/end bins and token amounts from the plan.
          </InfoTip>
        }
      >
        How it works
      </SectionLabel>
      <ol className="space-y-2">
        {steps.map((t, i) => (
          <li key={t} className="flex items-center gap-3 text-[13px] text-muted">
            <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs text-text">{i + 1}</span>
            {t}
          </li>
        ))}
      </ol>
      {pool && (
        <a
          href={metricPoolUrl(pool)}
          target="_blank"
          rel="noreferrer"
          className="mt-4 flex items-center justify-between rounded-lg bg-accent/10 px-3 py-2 text-[13px] font-medium text-accent transition hover:bg-accent/20"
        >
          Open {pool.pair} on app.metric.xyz
          <span aria-hidden>↗</span>
        </a>
      )}
    </Card>
  );
}
