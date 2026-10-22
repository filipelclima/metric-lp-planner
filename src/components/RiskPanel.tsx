import { bpsToFraction, fmtApr } from "@/lib/calc";
import { providerHealth, reasonText, TIER_LABEL } from "@/lib/risk";
import type { Pool } from "@/lib/types";
import { Panel, TierBadge } from "./ui";

const HEALTH_DOT = { ok: "bg-good", warn: "bg-warn", bad: "bg-bad", unknown: "bg-muted" } as const;

export function RedTierBanner({ pool }: { pool: Pool }) {
  if (pool.tier !== "red") return null;
  return (
    <div role="alert" className="rounded-2xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">
      <div className="font-semibold">⚠ This pool is classified red.</div>
      <div className="mt-0.5 text-bad/90">
        Metric flags it as high risk
        {pool.reasonCodes.length > 0 && <>: {pool.reasonCodes.map(reasonText).join(" ")}</>} Fee estimates here may be far from what you earn, and
        you can lose a large part of your deposit.
      </div>
    </div>
  );
}

export default function RiskPanel({ pool }: { pool: Pool }) {
  const health = providerHealth(pool.priceProviderStatus);
  const feeApr = bpsToFraction(pool.aprBps7d);
  const pnlApr = bpsToFraction(pool.tradingPnlAprBps7d);
  const cooldown = pool.priceProviderCooldown;

  return (
    <Panel title="Risk">
      <dl className="space-y-3 text-sm">
        <Row label="Pool tier">
          <span className="flex items-center gap-2">
            <TierBadge tier={pool.tier} />
            <span className="text-muted">{TIER_LABEL[pool.tier]}</span>
          </span>
        </Row>
        {pool.reasonCodes.length > 0 && (
          <ul className="space-y-1 rounded-lg bg-panel-2 px-3 py-2 text-xs text-muted">
            {pool.reasonCodes.map((c) => (
              <li key={c} title={c}>
                • {reasonText(c)}
              </li>
            ))}
          </ul>
        )}
        <Row label="Price provider">
          <span className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${HEALTH_DOT[health]}`} />
            {pool.priceProviderStatus ?? "Unknown"}
          </span>
        </Row>
        {(cooldown.never || cooldown.value !== null) && (
          <Row label="Provider cooldown">{cooldown.never ? "Never" : `${cooldown.value}s`}</Row>
        )}
        <Row label="Curator">
          {pool.verifiedAdmin ? (
            <span className="text-good">✓ Verified{pool.adminUsername ? ` · ${pool.adminUsername}` : ""}</span>
          ) : (
            <span className="text-warn">Not verified{pool.adminUsername ? ` · ${pool.adminUsername}` : ""}</span>
          )}
        </Row>
        {pool.pauseLevel !== null && pool.pauseLevel > 0 && (
          <Row label="Paused">
            <span className="text-bad">Level {pool.pauseLevel}</span>
          </Row>
        )}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Stat label="7d fee APR" value={fmtApr(feeApr)} tone="text-accent" />
          <Stat
            label="7d trading PnL APR"
            value={fmtApr(pnlApr)}
            tone={pnlApr === null ? "text-muted" : pnlApr < 0 ? "text-bad" : "text-good"}
          />
        </div>
        {feeApr !== null && pnlApr !== null && (
          <p className="text-xs text-muted">
            Fee APR + trading PnL APR ≈ <span className={feeApr + pnlApr < 0 ? "text-bad" : "text-text"}>{fmtApr(feeApr + pnlApr)}</span> over the
            last 7 days.
          </p>
        )}
      </dl>
      <p className="mt-4 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
        Fees ≠ profit. Price moves can outweigh earned fees; you can lose your deposit. Estimates use past data.
      </p>
    </Panel>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-lg bg-panel-2 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`num text-lg font-medium ${tone}`}>{value}</div>
    </div>
  );
}
