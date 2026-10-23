"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { fmtUsd } from "@/lib/calc";
import { usePlanner } from "@/lib/usePlanner";
import BinDetails from "./BinDetails";
import ConfigPanel from "./ConfigPanel";
import Hero from "./Hero";
import Histogram from "./Histogram";
import { RiskDrawer } from "./Risk";
import { HowItWorks, PoolStats } from "./SideCards";
import { Card, Collapsible, Skeleton, TokenLogo } from "./ui";

export default function Planner() {
  const m = usePlanner();
  const { s, pool, binData, range, estimate, bins } = m;
  const [riskOpen, setRiskOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const hasBins = !!(pool && binData && range && estimate?.source === "bins");

  return (
    <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start">
      {/* Desktop: sticky config column */}
      <aside className="hidden space-y-3 lg:sticky lg:top-4 lg:z-20 lg:block">
        <Card className="p-5">
          <ConfigPanel m={m} />
        </Card>
        {pool && <PoolStats pool={pool} />}
        <HowItWorks pool={pool} />
      </aside>

      <section className="min-w-0 space-y-3">
        {/* Mobile, before a pool is chosen: config inline above the empty hero */}
        {!s.pool && (
          <Card className="p-4 lg:hidden">
            <ConfigPanel m={m} />
          </Card>
        )}

        <Hero m={m} onOpenRisk={() => setRiskOpen(true)} />

        {pool && (
          <Card className="p-5">
            {hasBins ? (
              <Histogram
                data={binData!}
                from={range!.from}
                to={range!.to}
                estimate={estimate!}
                onRange={(from, to) => m.set({ range: { kind: "manual", from, to } })}
                hovered={hovered}
                onHover={setHovered}
              />
            ) : bins.loading || !estimate ? (
              <ChartSkeleton />
            ) : (
              <p className="py-10 text-center text-sm text-muted">No per-bin data, so the histogram is unavailable for this pool right now.</p>
            )}
          </Card>
        )}

        {hasBins && (
          <Card className="px-5 py-4">
            <Collapsible
              title="Bin details"
              open={detailsOpen}
              onToggle={() => setDetailsOpen((o) => !o)}
              right={<span className="num text-[11px] text-faint">{estimate!.positions.length} bins</span>}
            >
              <BinDetails pool={pool!} data={binData!} estimate={estimate!} hovered={hovered} onHover={setHovered} />
            </Collapsible>
          </Card>
        )}

        {/* Mobile: side cards after the results */}
        <div className="space-y-3 lg:hidden">
          {pool && <PoolStats pool={pool} />}
          <HowItWorks pool={pool} />
        </div>
      </section>

      {pool && <RiskDrawer pool={pool} open={riskOpen} onClose={() => setRiskOpen(false)} />}

      {/* Mobile: config lives in a bottom sheet once a pool is chosen */}
      {s.pool && (
        <>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="fixed inset-x-3 bottom-3 z-30 flex items-center justify-between gap-3 rounded-2xl bg-surface-3/95 px-4 py-3 text-left shadow-2xl shadow-black/60 backdrop-blur lg:hidden"
          >
            <span className="flex min-w-0 items-center gap-2 text-sm">
              {pool && (
                <span className="flex -space-x-1.5">
                  <TokenLogo src={pool.token0.logoUrl} symbol={pool.token0.symbol} />
                  <TokenLogo src={pool.token1.logoUrl} symbol={pool.token1.symbol} />
                </span>
              )}
              <span className="truncate font-medium">{pool?.pair ?? "Pool"}</span>
              <span className="num whitespace-nowrap text-muted">
                {fmtUsd(s.amount, { compact: true })} · {s.days}d
              </span>
            </span>
            <span className="shrink-0 rounded-lg bg-accent/15 px-3 py-1 text-xs font-medium text-accent">Edit</span>
          </button>
          <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)}>
            <ConfigPanel m={m} />
          </BottomSheet>
        </>
      )}
    </div>
  );
}

function ChartSkeleton() {
  const heights = [18, 24, 30, 38, 46, 56, 68, 82, 96, 82, 70, 58, 48, 40, 32, 26, 20, 16];
  return (
    <div aria-busy="true" aria-label="Loading chart">
      <Skeleton className="mb-4 h-4 w-40" />
      <div className="flex h-52 items-end gap-1">
        {heights.map((h, i) => (
          <Skeleton key={i} className="flex-1 rounded-sm" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  );
}

function BottomSheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/60 lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Edit position"
            className="fixed inset-x-0 bottom-0 z-50 max-h-[88vh] overflow-y-auto rounded-t-3xl bg-surface px-4 pb-8 pt-3 shadow-2xl lg:hidden"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 40 }}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-faint/50" />
            {children}
            <button onClick={onClose} className="mt-6 w-full rounded-xl bg-accent py-3 text-sm font-semibold text-bg">
              Show result
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
