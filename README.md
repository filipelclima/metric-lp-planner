# Binwise: LP planner for Metric pools

An unofficial fee calculator and bin planner for liquidity providers on [Metric](https://metric.xyz).
Metric pools are "active pools": liquidity sits in percentage **bins** around an oracle reference price.
Think *Poolfish (uniswap.fish) for Metric*.

> Unofficial community tool, not affiliated with Metric. Not financial advice.

## Features

- Searchable pool list across **Ethereum (1)**, **BNB Chain (56)** and **Robinhood Chain (4663)**, showing TVL, APR and tier badge.
  - Sortable Pair / Chain / TVL / APR headers (click again to flip; ▲▼ shows the direction). Pools without an APR show "—" and always sort last.
  - APR period 24h (`analytics24h.aprBps`) or **7d** (`aprBps7d`); TVL filter Any / **≥$10k** / ≥$100k / ≥$1M; chain filter.
  - Search combines with the filters; the list says "Showing X of Y pools".
  - **Inactive pools** (no 7d volume and TVL < $10k) are hidden unless "Show inactive pools" is on. `/metadata` has no 7d volume, so "no 7d volume" = 7d fee APR 0/missing and no 24h volume.
  - Remembered in the page URL (`psort`, `pdir`, `papr`, `ptvl`, `pchain`, `pinactive`; only non-defaults, never in share links) and in localStorage. A URL with picker params wins over storage.
- **"No trades" warnings** wherever a pool without trading can appear. The badge rule is in `src/lib/activity.ts`: 24h volume 0 → "No trades"; 7d fee APR 0/missing too → "No trades 7d".
  - Badges on rows in the pool picker and Top pools; Top pools' highlight cards skip these pools.
  - Compare replaces a no-trade column with a warning card ("Use 30d data" if 30d has volume, "Change pool") and leaves it out of highlights, verdicts, the APR chart and the share card.
  - Portfolio shows the pill "No trades: earning nothing" and an insight when the pool had no trades in the 7d window.
- **No trades** (planner): when the data window has 0 volume, the hero shows "No trades in the last 7d: this pool earned no fees, so there's nothing to estimate." with buttons for longer data periods that do have volume and "Pick another pool". Presets then show "Presets need trading volume" instead of coverage.
- Deposit (USD), duration (30/60/90 days or custom) and data period (24h / **7d** / 30d).
- Ranges:
  - **Auto presets**: the smallest contiguous bin range around the current bin that covers 80/90/95% of the period's volume.
    Each button shows the range it gives and the volume it really covers (e.g. "#-2…#0 / 96%"); when a concentrated pool makes several presets match, a note says so. **Wider** = the 95% range + 2 bins each side (within the pool's bins); it's stored as a manual range.
  - **Bin inputs** accept `+1`, `1`, `-2` and `−2`, reject other characters with an inline hint (keeping the last valid value), clamp to the pool's bins with a visible note, and have −/+ steppers and the bin's % edge underneath.
  - **You'll need** shows each token's USD value and the total ("price n/a" when Metric has no price).
  - **Manual**: drag on the histogram, or type start and end bins.
- Distributions:
  - **Uniform**: equal USD per bin.
  - **Curve**: triangular weights peaking at the active bin.
  - **Fee-weighted**: proportional to each bin's daily fees divided by its liquidity.
- Output:
  - Fees per day, 30d, 60d, 90d and custom, with simple and auto-compounding lines, plus a historical net column.
  - An estimated NET APR for your range from each bin's `pnlAprBps` (historical, can be negative).
  - Your APR next to the pool's APR.
  - A copyable **bin plan**, plus a per-bin table with edges, USD, token amounts, your share, fees per day and bin APR.
  - **Tokens needed**: bins below the active bin hold token1 only, bins above hold token0 only, and the active bin is split by its reserve ratio.
- Histogram of pool liquidity per bin, with your range and your liquidity, an oracle (0%) marker, an active-bin marker, and a Volume/APR overlay.
- Risk panel:
  - Tier with reason codes in plain English, price provider status, and whether the curator is verified.
  - Net 7d APR (fees + price moves, from `tradingPnlAprBps7d`) next to the fee APR. Trading PnL already includes fees ("includes Edge"), so the two are never added.
  - A prominent warning for red-tier pools.
- Results-first layout: a sticky config column (with distribution and data period under "Advanced"), a result hero (headline fees, fee vs net APR, projection chart, visual bin ruler with a copyable plan, tokens needed), the liquidity histogram, and a collapsible bin details table. Hovering a bar highlights its table row and vice versa. Risk details open in a side drawer from the status pills.
- **Share card**: `/api/og` renders a 1200×630 PNG of the plan from the same URL params (Next.js `ImageResponse`). It's used as the page's OG/Twitter image, so shared links preview the result, and the Share menu offers Copy link, Download image and Post on X.
  - Built for crawlers: the route runs on the edge, and the Metric lookups share a 2s deadline. If Metric is slow or down, it still returns a 200 PNG with the plan and "Open to see live estimates".
  - Live cards are cached with `public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800`. Plan-only fallbacks are cached for 60s, so live numbers replace them quickly.
  - `htmlLimitedBots: /.*/` keeps og/twitter tags in `<head>` for every user agent. Bump `OG_VERSION` in `src/app/page.tsx` to make X refetch cached images.
  - **Snapshots**: clicking Share freezes the numbers on screen into the link:
    - `sf` est. fees (USD), `sa` fee APR %, `sn` net APR %, `sd` date, plus optional `sp` pair and `sw` bin width.
    - `/api/og` renders those exact values with no Metric call, and shows "as of …". The tweet text is built from the same formatted values.
    - The page itself still recalculates live when opened.
    - Snapshot params are strictly validated in `src/lib/share.ts`: numbers only, bounded ranges, real dates no later than today, token-symbol pairs. Any invalid value voids the snapshot, so the image can't be made to render arbitrary text.
  - Every Share click adds a random `s=<6 chars>` so X treats it as a new URL. It is excluded from the og:image URL, which is canonical (normalized plan params, then snapshot params, then `v`).
  - Opening the Share menu pre-warms that exact image URL, so Vercel's edge has it cached before X asks for it.
  - `npm run check-share -- https://your-deploy` simulates X's crawler: it checks the tags are in `<head>`, the image URL is absolute, and `/api/og` returns 200 `image/png` at 1200×630 for both HEAD and GET.
- Motion: count-up numbers, staggered hero entrance, growing bars and an animated range overlay (framer-motion). All of it is disabled under `prefers-reduced-motion`.
- Shareable URL, e.g. `?chain=56&pool=0x..&amount=1000&days=30&from=-8&to=7&strategy=uniform&period=7d`. A `preset=80|90|95` parameter keeps an auto preset live.

## Compare ranges (`/compare`)

Up to three ranges (A, B, C) side by side for the same deposit, duration and data period. Open it from the planner's "Compare ranges" link; it starts with Narrow 80%, Medium 90% and Wide 95% of the window's volume.

- Each scenario has its own start/end bin (or a preset) and distribution. "Different pool (same deposit)" compares pool vs pool.
- **Distinct ranges**: in concentrated pools the presets can collapse (e.g. the 90% preset already covers 95% of volume). A 90/95% preset must come out strictly wider than the previous smaller preset; otherwise it's that range widened by 1 bin (90%) or 2 bins (95%) on each side, so the defaults become A = 80%, B = A ± 1, C = B ± 2. A preset still equal to an earlier range is widened by 1 bin per side until distinct, and labeled e.g. "Wide (+2 bins each side)". Manual ranges are never moved: a duplicate shows "Same range as B" instead of a repeated verdict.
- **Table** (best value per row highlighted when values differ): range, volume covered, your share of liquidity, fee APR, est. fees (simple and compounded), net APR (historical) and net $, price drag (fee − net APR), tokens needed, idle bins, and a one-line verdict.
  - A bin is **idle** when it traded less than 0.1% of the window's volume.
  - Verdicts: highest fees (with a warning when it also covers the least volume), safest (most volume covered), best net, net negative, idle bins; "Balanced" otherwise.
- **Charts**: the pool's liquidity histogram with one colored overlay per scenario (A teal, B violet, C amber), and fee vs net APR as grouped bars. Hovering a legend item, bar or table column highlights that scenario. On mobile, scenarios are cards you swipe or switch with tabs.
- **URL**: `/compare?chain=56&pool=0x..&amount=1000&days=30&period=7d&cmp=-3:1:u,-5:3:u,-8:6:c`. Entries are `<from>:<to>:<strategy>` or `p<80|90|95>:<strategy>` (u/c/f), optionally followed by `:<chainId>:<0xpool>`. Invalid entries are dropped.
- **Share comparison** freezes the columns into the link (`cp, cc, cdays, sd, ca1..3, cb, cf, cn, ce, cq`), validated like the other snapshots, and renders a 2–3 column card.
- Logic lives in `src/lib/compare.ts` (pure, reuses `calc.ts`).

## Top pools (`/pools`)

Every Metric pool ranked by **net APR (7d)**. `tradingPnlAprBps7d` is fees + price moves and already includes fees, so the two are never added.

- **Data**: `/api/pools-ranking` pulls `/evm/metadata?include24h=true&minTvlFiat=0` per chain, all chains in parallel.
  - It fetches the first page, then the remaining pages in parallel from the reported `total`.
  - Each request has a 20s timeout and is retried twice with backoff.
  - A chain that still fails falls back to that server's last good rows (`staleChains`); only a chain with no fallback is reported in `failedChains`.
  - Complete results are cached `s-maxage=300, stale-while-revalidate=86400`. Incomplete ones are `no-store`, so a cold-start failure is never cached at the edge.
  - The page retries once silently before showing an error banner.
- **Columns** (all sortable, default net APR descending):
  - pair with a chain badge, tier, TVL, 24h volume;
  - fee APR and net APR, each with a bar;
  - **price drag** = fee APR − net APR (how much price moves ate);
  - **vol / TVL** = 24h volume ÷ TVL.
- **Filters** (kept in the URL):
  - chain;
  - tier: hide High Risk (default), Best Practices only, or all;
  - min TVL, default $25k, so tiny pools with absurd APRs stay out;
  - only verified curators;
  - **Show all**: also paused pools, private (deposit-whitelisted) pools and pools whose price feed isn't healthy.
- **Price-driven chip**: on rows where net APR > 1.5 × fee APR. Most of the 7d return came from price moves, not fees, and may not repeat.
- **Highlights**:
  - best net APR (fee-driven): only pools with net APR ≤ fee APR;
  - "highest fees but negative net" (the trap);
  - most efficient (vol / TVL), excluding pools with negative net APR.
- **Links**: every row and highlight has **Plan** (opens the planner with that pool) and **Open on Metric ↗**.
- **Copy weekly top 5**: a ready-to-paste X post built from the current filters.
- **Share result**: freezes the top 5 into the link (`tp1..5`, `tn1..5`, `tf1..5`, optional `tch`, `sd`). They're validated like the other snapshots in `src/lib/share.ts`, and `/api/og` renders them as a ranked card.
- Ranking, filters, highlights and the post text are pure functions in `src/lib/ranking.ts`, tested in `tests/ranking.test.ts`.

## Portfolio (`/portfolio?wallet=0x…`)

Paste any wallet to see its Metric LP positions. It's read-only: no wallet connection, no signatures, and only public onchain data plus Metric's public API.

- **Discovery**: `eth_getLogs` on `https://rpc.metric.xyz/{chainId}` from block 0.
  - No address filter. Topics: `[[LiquidityAdded, LiquidityRemoved], wallet]`.
  - Logs from pools that aren't in `/evm/metadata?minTvlFiat=0` are dropped.
  - A position is `(pool, salt)`, covering every bin it ever touched.
- **Current state**: read through the Data Provider `0x83d66c5934b1525ee82e6e772c76c7acc778bbb7`.
  - Calls: `positionBinShares`, `binTotalShares` and `binState`.
  - They go through Multicall3. Any call it reports as failed, including all of them on a chain without Multicall3, is retried as plain `eth_call`s in JSON-RPC batches.
  - Chains run in parallel. If one chain fails, it's reported and the others still load.
- **Value**: per bin, `positionBinShares / binTotalShares × (token0.reserveFiat + token1.reserveFiat)`, using `/analytics/bins?period=7d`.
- **Est. fees since deposit (from 7d rates)**: `Σ value_b × (aprBps_b / 10000) × heldDays / 365`.
  - `value_b = share_b × (reserveFiat0_b + reserveFiat1_b)`, with shares at the current block.
  - `heldDays` runs from the first deposit's block timestamp, capped at the 7d window. When the position is older than 7d, the label reads "last 7d".
  - Using Metric's own per-bin rate (fees ÷ the bin's 7d *average* liquidity) avoids undercounting when bin liquidity grew during the window. Current share × window fees would undercount there, because the current share is below the average share.
  - Caveat: if the growth was mostly your own fresh deposit, the average-liquidity rate can overstate.
- **Your fee APR (7d)**: `Σ value_b × aprBps_b / Σ value_b`. It's consistent with the fee estimate (fees = APR × value × days / 365).
- **Bins' 7d net APR (pool)**: the same weighting with `pnlAprBps` (bins without it are skipped), shown with the $ it implies over your time held. Pool history, not your result.
- **Your result**: PnL vs HODL in $, plus annualized (`PnL / HODL value / days held × 365`, shown after 1 day).
- **PnL vs HODL**: current value minus the worth of the net deposited tokens.
  - Net deposited = Σ|Δ| from `LiquidityAdded` − Σ|Δ| from `LiquidityRemoved`, per token, in "scaled" units.
  - **Scale, determined empirically at runtime**: `binState` balances use the same scaled units, and analytics gives the same bins' `reserveFiat`. So `reserveFiat / balanceScaled` is a USD rate per scaled unit, with no assumption about token decimals.
  - The median rate across your bins is used. It counts as calibrated when all bins agree within 2%, and the implied exponent (`scaled = amount × 10^exp`) is reported.
  - If a token has no balance in any of your bins, or the rates disagree, scaled amounts are assumed to be 18-decimal fixed point and the PnL is labelled **approx.**
- **Status**: In range, Edge of range (active bin at the lowest or highest bin you hold), or Out of range — earning nothing.
- **Insights**: out of range, edge of range, idle bins (< 2% fee APR over 7d), net APR below −50% in a bin, and holding would have been worth more. "Curator fee changed since deposit" isn't shown, because the public reads don't expose historical fee settings.
- **Share card**: `/api/og?pv=…&pp=…&pa=…&pc=…&sd=…` shows totals only. The wallet is never part of the image URL.
- `/api/positions?wallet=&chain=` is cached for 30s (`s-maxage=30`).

Environment variables (all optional):

| Var | Purpose |
| --- | --- |
| `NEXT_PUBLIC_EXAMPLE_WALLET` | Wallet behind the "Try an example" button. The button is hidden when unset. Keep it out of the repo. |
| `METRIC_API_BASE`, `METRIC_RPC_BASE` | Point the server at a local mock instead of `api.metric.xyz` / `rpc.metric.xyz` (testing only). |

## Setup

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # Vitest unit tests (src/lib)
npm run build    # production build
```

Deploy on Vercel by importing the repo. No environment variables are needed.

## Data sources

All data comes from the public Metric API (`https://api.metric.xyz/public/v1`), which needs no auth. Every call goes through Next.js route handlers in `src/app/api/*`. This avoids CORS and adds caching.

| Route | Upstream | Cache |
| --- | --- | --- |
| `/api/pools` | `/evm/metadata?include24h=true&count=500&sortBy=tvl&chainIds={id}`, one request per supported chain; pages with `offset=nextOffset` until `null`; envelope `{ data, total, nextOffset }` | 300s |
| `/api/pools/{chain}/{pool}` | `/evm/{chain}/{pool}/metadata?contract_version=v1&include24h=true` | 300s |
| `/api/pools/{chain}/{pool}/bins?period=` | `/evm/{chain}/{pool}/analytics/bins?contract_version=v1&period=` (**undocumented**, used by app.metric.xyz) | 60s |
| `/api/chains` | `/chains` → `{ chains: [{ type, chainId, name }] }` (keyed on `chainId`; name casing varies) | 300s |

Error handling:
- An upstream `429` is passed through with `retryAfter`, and the UI shows a Retry button.
- If the bins endpoint fails, the estimate falls back to pool-level data, labelled **"pool-level (no per-bin data)"**: `analytics24h.feesFiat` (per day of its window) shared pro-rata against `analytics24h.tvlFiat`.
- A pool's chainId always comes from the request (`chainIds` filter or URL path), never from its `chain` field.
- Optional pool fields (`aprBps7d`, `tradingPnlAprBps7d`, `pauseLevel`, `curBinIdx`, `extensionDetails`, `tvlFiat`, `analytics24h`) are omitted when absent.
- `token*FiatPrice` can be `null`. Token amounts for that token are then shown as unavailable.
- `bin` and `swapCount` in the bins response are strings, and are parsed to numbers.
- Tiers are `green` (Best Practices), `yellow` (Neutral), `red` (High Risk), `black` (Delisted by Metric) and `unclassified`. Red and black pools get a prominent warning, and pools with `depositWhitelistingEnabled` show "Private" instead of a tier.
- Very large integers such as `priceProviderCooldownSecs = 2^64−1` are parsed with BigInt, and anything ≥ 2^53 is shown as "never".

Docs: <https://docs.metric.xyz/llms-full.txt>

## Fee model

Everything is in `src/lib/calc.ts`, as pure functions with tests in `tests/`.

- **Window**: `windowDays = (toTs − fromTs) / 86400`. The window is capped at the pool's age (e.g. `30d` and `all` both gave 14.02 days for a young pool), so the code never assumes 7 or 30.
- **Bin edges**: bin `i` spans `[i·w, (i+1)·w]` with `w = lengthE6 / 1e6` (100 → 0.01%), and its mid is `(i + 0.5)·w`. So `#-8 = -0.075%` and `#7 = +0.075%`, matching the official app.
- **Per bin**:
  - `fees_b = token0.lpFeesFiat + token1.lpFeesFiat`
  - `liq_b = token0.avgLiquidityFiat + token1.avgLiquidityFiat`, or the reserves if that sum is 0
  - `dailyFees_b = fees_b / windowDays`
- **Your fees**: `userDaily = Σ_b dailyFees_b × U_b / (liq_b + U_b)`, where `U_b` is your USD in bin b.
- **APR**: `userDaily × 365 / deposit`. Bin APR = `dailyFees_b × 365 / (liq_b + U_b)`.
- **Net (historical)**: `pnlAprBps` is Metric's trading PnL APR per bin, which already includes fees.
  - Per bin, `netDaily_b = (pnlAprBps_b / 10000) × liq_b / 365`.
  - For your position, `userNet = Σ netDaily_b × U_b / (liq_b + U_b)` and `netAPR = userNet × 365 / deposit`.
  - Bins with `pnlAprBps = null` are skipped (they count as 0, and the UI says how many were skipped). The net figure is simple, with no compounding, and can be negative.
- **Compounding**: `r = userDaily / deposit`, `value = D × (1 + r)^days − D`.
- **Sanity check**: as `U_b → 0`, `dailyFees_b × 365 / liq_b` should equal Metric's `aprBps / 10000`.
  - `tests/calc.test.ts` checks this on synthetic data.
  - `tests/fixtures.test.ts` checks it to within 1% on **real** SKHYB/USDT (BSC) data in `tests/fixtures/`: a 24h `/analytics/bins` excerpt, plus 7d per-bin totals. `npm run fixtures` downloads full, current responses next to them.

Estimates assume past volume and liquidity continue and that the price stays in your range. **Fees ≠ profit**: price moves can outweigh earned fees.

## Project layout

```
src/lib/calc.ts        fee model, presets, distributions, formatting (pure)
src/lib/normalize.ts   API → Pool normalization (exact Metric response shapes, typed in types.ts)
src/lib/num.ts         safe number / BigInt parsing
src/lib/risk.ts        tier + reason-code copy
src/lib/urlState.ts    shareable URL state
src/lib/plan.ts        URL state + API data → range and estimate (shared by the page and /api/og)
src/lib/usePlanner.ts  client hook: URL sync, data fetching, derived estimate
src/app/api/**         proxy route handlers + /api/og share image
src/lib/rangeInputs.ts bin input parsing/clamping, preset summaries, Wider, tokens needed (pure)
src/lib/poolList.ts    pool picker: sort, filters, APR period, URL/localStorage prefs (pure)
src/lib/activity.ts    "No trades" badge rule (pure)
src/lib/noTrades.ts    empty state for windows with no trades (pure)
src/lib/compare.ts     compare ranges: metrics, best per row, verdicts, cmp URL encoding (pure)
src/lib/ranking.ts     top pools: rows, filters, sorting, highlights, weekly post (pure)
src/lib/portfolio/     portfolio: ABIs, pure model (decoding, positions, value, HODL, status, insights), server loader
src/components/**      UI (Planner, ConfigPanel, Hero, Histogram, BinDetails, Risk, ShareMenu, PoolPicker, compare/*, portfolio/*)
```
