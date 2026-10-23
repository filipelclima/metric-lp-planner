# Changelog

One entry per task, newest first. Each entry lists what changed, what couldn't be tested, and decisions worth reviewing. See `CLAUDE.md` for the rule.

## Entries

### 2026-10-23 · `bfccd0a` · Portfolio: 24h rates for young positions
- **Changed:**
  - Positions held less than 2 days take fee and net APR from the 24h bin analytics, applied over the whole holding time (capped at 2 days); otherwise 7d.
  - 24h analytics are fetched only for pools with young positions, falling back to 7d if that request fails.
  - Labels follow the window: "(from 24h rates)", "Your fee APR (24h)", "Bins' 24h net APR (pool)", the strip hint and insights.
- **Couldn't test:** The live wallet (Metric RPC and API are blocked in the sandbox). Verified with unit tests and a local mock at a 28.5h deposit age; the mock serves the same data for 24h and 7d, so the real 24h numbers are unchecked.
- **Review:**
  - The 2-day threshold.
  - A position between 1 and 2 days old applies the last 24h rate to its whole holding time, which may differ from what it earned on day one.
  - The summary labels its rates "24h/7d" when positions mix windows.

### 2026-10-23 · `9ca462f` · Portfolio: fees and net from each bin's 7d APR
- **Changed:**
  - Est. fees = Σ value_b × aprBps_b/1e4 × heldDays/365, with heldDays capped at 7d. It previously used current share × window fees.
  - Your fee APR is the value-weighted aprBps, consistent with the fee estimate.
  - The net estimate uses pnlAprBps the same way, skipping nulls, and is shown next to "Bins' 7d net APR (pool)".
  - Removed the "Bins' 7d fee APR (pool)" stat, since it now equals your fee APR.
  - The label switches to "Est. fees (last 7d)" when a position is older than 7d.
  - Tooltips now say "based on each bin's 7d APR".
- **Couldn't test:** The live wallet (`rpc.metric.xyz` and `api.metric.xyz` are blocked in the sandbox). Verified only with unit tests and a local mock. Expected live result: ≈ $1.5 fees on the CRCLB/USDT wallet.
- **Review:**
  - The bin APR divides by 7d average liquidity. If the liquidity growth was mostly this wallet's own fresh deposit into thin bins, the estimate overstates.
  - Bins without aprBps count as 0% for fees.
  - Positions older than 7d show only the last 7d of fees.

### 2026-10-23 · `a919b6c` · Changelog and CLAUDE.md
- **Changed:** Added `CHANGELOG.md`, with a backfill of earlier work below, and `CLAUDE.md` with the rule to append an entry after every task and push it with the code.
- **Couldn't test:** Nothing (docs only).
- **Review:** Workflow is two commits per task (code, then a changelog entry citing the code commit's hash), pushed together. The backfilled entries were reconstructed from the commit history and session notes.

### 2026-10-23 · `34aaa84` · Portfolio: consistent fees/APR, "Your result"
- **Changed:**
  - Est. fees since deposit (from 7d rates), with the deposit age shown.
  - "Your fee APR" at the current share, consistent with the fee estimate by construction.
  - The bins' 7d fee/net APR moved to a secondary "(pool)" row.
  - A "Your result" row: PnL vs HODL in $ and annualized after 1 day.
- **Couldn't test:** Live data (`api.metric.xyz` and `rpc.metric.xyz` are blocked in the sandbox). Verified against a local mock only.
- **Review:**
  - The live $0.31 fee estimate likely stays. The old 300% APR was the bins' APR on 7d average liquidity, which overstates a fresh position in thin bins.
  - app.metric.xyz's "Edge ≈ $2" isn't reconciled.
  - Option not taken: use the 24h window for the most recent day.

### 2026-10-23 · `97d3e83` · Portfolio page
- **Changed:** `/portfolio?wallet=` and `/api/positions`:
  - Positions from `eth_getLogs`, Data Provider reads (Multicall3 with batched fallback) and 7d analytics.
  - Value, fees, HODL/PnL, status, insights, bin strip.
  - A portfolio share card that never shows the wallet.
  - Header nav.
- **Couldn't test:** Live RPC and API (blocked); end-to-end only against a synthetic mock.
- **Review:**
  - The "scaled" unit is calibrated at runtime from `binState` vs `reserveFiat`, falling back to 1e18 and "approx.".
  - "Try an example" needs `NEXT_PUBLIC_EXAMPLE_WALLET`.
  - No curator-fee-change insight (not detectable).
  - The TS target was raised to ES2020.
  - Optional `METRIC_*_BASE` env overrides were added for testing.

### 2026-10-23 · `cefeafe` · Snapshot sharing
- **Changed:**
  - Share freezes the on-screen numbers into the link (`sf/sa/sn/sd/sp/sw`) with a unique `s` id.
  - `/api/og` renders snapshots without calling Metric.
  - The share menu pre-warms the image.
  - Strict validation of snapshot params.
- **Couldn't test:** On X itself; verified with a local production build and a Twitterbot user agent.
- **Review:** The bin percentages on the card assume uniform bin width (`sw`). The removed `pair` param was an arbitrary-text vector.

### 2026-10-23 · `565074e` / `debc73f` · Crawler-proof share image
- **Changed:**
  - Edge `/api/og` with a 2s budget and an always-200 PNG.
  - Long cache for live cards, 60s for fallbacks.
  - `htmlLimitedBots` so meta tags render in `<head>`.
  - A canonical image URL, `twitter:site`/`creator`, `robots.txt` and `npm run check-share`.
- **Couldn't test:** The live deploy (`vercel.app` blocked in the sandbox).
- **Review:** Fallback cards are cached for only 60s, on purpose.

### 2026-10-22 · `174bdf2` → `b3b5f9e` · Redesign and polish
- **Changed:**
  - Results-first layout with a hero, projection chart, bin ruler and risk drawer.
  - framer-motion and Geist fonts.
  - Net shown as a dotted line in the projection.
  - Pool stats and How it works cards.
- **Couldn't test:** Live data; synthetic mocks only.
- **Review:** The bottom sheet has no swipe-to-close.

### 2026-10-22 · `1562c64` → `a0f0627` · Planner
- **Changed:**
  - The initial Binwise planner: per-bin fee model, presets, strategies, histogram, bin plan, risk panel and URL state.
  - Matched to the real API shapes, with the aprBps check on real fixtures.
  - Net (trading PnL) APR replaces "fees + PnL".
- **Couldn't test:** The live API at the time (blocked); real fixtures were supplied manually.
- **Review:** The black tier shows the same warning as red.
