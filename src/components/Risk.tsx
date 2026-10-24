"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import { bpsToFraction, fmtApr } from "@/lib/calc";
import { PROVIDER_LABEL, providerHealth, reasonText, TIER_LABEL } from "@/lib/risk";
import type { Pool, Tier } from "@/lib/types";
import { InfoTip, TierBadge } from "./ui";

const TIER_DOT: Record<Tier, string> = { green: "bg-good", yellow: "bg-warn", red: "bg-bad", black: "bg-bad", unclassified: "bg-faint" };
const HEALTH_DOT = { ok: "bg-good", bad: "bg-bad", unknown: "bg-faint" } as const;
const pctE6 = (e6: number) => `${(e6 / 1e4).toFixed(2).replace(/\.?0+$/, "")}%`;
export const isHighRisk = (p: Pool) => p.tier === "red" || p.tier === "black";

/** Compact status row: "● Best Practices · ✓ Verified curator · ● Healthy feed". Clicking opens the drawer. */
export function RiskPills({ pool, onOpen }: { pool: Pool; onOpen: () => void }) {
  const health = providerHealth(pool.priceProviderStatus);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-full px-3 py-1 text-xs transition ${
        isHighRisk(pool) ? "bg-bad/10 text-bad hover:bg-bad/15" : "bg-surface-2 text-muted hover:bg-surface-3 hover:text-text"
      }`}
    >
      <span className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${pool.isPrivate ? "bg-accent" : TIER_DOT[pool.tier]}`} />
        {pool.isPrivate ? "Private" : TIER_LABEL[pool.tier]}
      </span>
      <span className="text-faint">·</span>
      <span className={pool.verifiedAdmin ? "" : "text-warn"}>{pool.verifiedAdmin ? "✓ Verified curator" : "Unverified curator"}</span>
      <span className="text-faint">·</span>
      <span className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${HEALTH_DOT[health]}`} />
        {health === "ok" ? "Healthy feed" : `Feed: ${PROVIDER_LABEL[pool.priceProviderStatus].toLowerCase()}`}
      </span>
      {pool.reasonCodes.length > 0 && (
        <>
          <span className="text-faint">·</span>
          <span>
            {pool.reasonCodes.length} flag{pool.reasonCodes.length === 1 ? "" : "s"}
          </span>
        </>
      )}
      <span aria-hidden className="text-faint transition group-hover:translate-x-0.5">›</span>
      <span className="sr-only">: open risk details</span>
    </button>
  );
}

/** One-line prominent alert for red / black (delisted) pools. */
export function RiskAlert({ pool, onOpen }: { pool: Pool; onOpen: () => void }) {
  if (!isHighRisk(pool)) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-bad/10 px-3.5 py-2 text-sm text-bad">
      <span>
        <strong className="font-semibold">⚠ {pool.tier === "red" ? "High Risk pool." : "Delisted by Metric."}</strong> Estimates may be far from what
        you earn, and you can lose a large part of your deposit.
      </span>
      <button onClick={onOpen} className="text-xs underline underline-offset-2">
        Why?
      </button>
    </div>
  );
}

export function RiskDrawer({ pool, open, onClose }: { pool: Pool; open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open, onClose]);

  const health = providerHealth(pool.priceProviderStatus);
  const feeApr = bpsToFraction(pool.aprBps7d);
  const netApr = bpsToFraction(pool.tradingPnlAprBps7d);
  const cooldown = pool.priceProviderCooldown;
  const sl = pool.stopLoss;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="Risk details"
            className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto bg-surface p-6 shadow-2xl shadow-black/60"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
          >
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight">Risk · {pool.pair}</h2>
              <button onClick={onClose} aria-label="Close" className="rounded-lg px-2 py-1 text-muted hover:bg-surface-2 hover:text-text">
                ✕
              </button>
            </div>

            <dl className="space-y-3.5 text-sm">
              <Row label="Pool tier">
                <TierBadge tier={pool.tier} isPrivate={pool.isPrivate} />
              </Row>
              {pool.isPrivate && <Row label="Metric tier">{TIER_LABEL[pool.tier]}</Row>}
              {pool.reasonCodes.length > 0 && (
                <ul className="space-y-1.5 rounded-xl bg-surface-2 px-3.5 py-3 text-[13px] text-muted">
                  {pool.reasonCodes.map((c) => (
                    <li key={c} title={c} className="flex gap-2">
                      <span className="text-warn">•</span>
                      {reasonText(c)}
                    </li>
                  ))}
                </ul>
              )}
              <Row label="Price provider">
                <span className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${HEALTH_DOT[health]}`} />
                  {PROVIDER_LABEL[pool.priceProviderStatus]}
                </span>
              </Row>
              {(cooldown.never || cooldown.value !== null) && <Row label="Provider cooldown">{cooldown.never ? "Never" : `${cooldown.value}s`}</Row>}
              <Row label="Curator">
                <span className={pool.verifiedAdmin ? "text-good" : "text-warn"}>
                  {pool.verifiedAdmin ? "✓ Verified" : "Not verified"}
                  {pool.adminUsername ? ` · ${pool.adminUsername}` : ""}
                </span>
              </Row>
              <Row label="StopLoss">
                {sl ? (
                  <span className="num text-[13px]" title={`Timelock ${sl.timelockSecs}s`}>
                    max drawdown {pctE6(sl.drawdownE6)} · decay {((sl.decayPerSecondE18 * 86400) / 1e16).toFixed(2)}%/day
                  </span>
                ) : (
                  <span className="text-warn">None</span>
                )}
              </Row>
              <Row label="Spread fee (curator / protocol)">
                <span className="num">
                  {pctE6(pool.spreadAdminFeeE6)} / {pctE6(pool.spreadProtocolFeeE6)}
                </span>
              </Row>
              {pool.pauseLevel > 0 && (
                <Row label="Paused">
                  <span className="text-bad">Level {pool.pauseLevel}</span>
                </Row>
              )}
            </dl>

            {/* Trading PnL already includes fees ("includes Edge"), so it is the net figure — never add the two. */}
            <div className="mt-6 grid grid-cols-2 gap-3">
              <Stat
                label={
                  <>
                    Net 7d APR{" "}
                    <InfoTip side="bottom">Net = what LPs actually made after the pool&apos;s token mix changed. Fees alone overstate returns.</InfoTip>
                  </>
                }
                value={fmtApr(netApr)}
                tone={netApr === null ? "text-muted" : netApr < 0 ? "text-bad" : "text-good"}
                sub="fees + price moves"
              />
              <Stat label="Fee APR" value={fmtApr(feeApr)} tone="text-accent" sub="7d, fees only" />
            </div>

            <p className="mt-6 rounded-xl bg-warn/10 px-4 py-3 text-[13px] leading-relaxed text-warn">
              Fees ≠ profit. Price moves can outweigh earned fees; you can lose your deposit. Estimates use past data.
            </p>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
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

function Stat({ label, value, tone, sub }: { label: React.ReactNode; value: string; tone: string; sub: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-4 py-3">
      <div className="flex items-center gap-1 text-xs uppercase tracking-[0.08em] text-faint">{label}</div>
      <div className={`num mt-1 text-2xl font-medium ${tone}`}>{value}</div>
      <div className="mt-0.5 text-xs text-faint">{sub}</div>
    </div>
  );
}
