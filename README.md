# Binwise: LP planner for Metric pools

An unofficial fee calculator and bin planner for liquidity providers on [Metric](https://metric.xyz).
Metric pools are "active pools": liquidity sits in percentage **bins** around an oracle reference price.
Think *Poolfish (uniswap.fish) for Metric*.

> Unofficial community tool, not affiliated with Metric. Not financial advice.

## Features

- Searchable pool list across **Ethereum (1)**, **BNB Chain (56)** and **Robinhood Chain (4663)**, showing TVL, 7d APR and tier badge.
- Deposit (USD), duration (30/60/90 days or custom) and data period (24h / **7d** / 30d).
- Ranges:
  - **Auto presets**: the smallest contiguous bin range around the current bin that covers 80/90/95% of the period's volume.
  - **Manual**: drag on the histogram, or type start and end bins.
- Distributions:
  - **Uniform**: equal USD per bin.
  - **Curve**: triangular weights peaking at the active bin.
  - **Fee-weighted**: proportional to each bin's daily fees divided by its liquidity.
- Output:
  - Fees per day, 30d, 60d, 90d and custom, with simple and auto-compounding lines.
  - Your APR next to the pool's APR.
  - A copyable **bin plan**, plus a per-bin table with edges, USD, token amounts, your share, fees per day and bin APR.
  - **Tokens needed**: bins below the active bin hold token1 only, bins above hold token0 only, and the active bin is split by its reserve ratio.
- Histogram of pool liquidity per bin, with your range and your liquidity, an oracle (0%) marker, an active-bin marker, and a Volume/APR overlay.
- Risk panel:
  - Tier with reason codes in plain English, price provider status, and whether the curator is verified.
  - 7d fee APR next to 7d trading PnL APR.
  - A prominent warning for red-tier pools.
- Shareable URL, e.g. `?chain=56&pool=0x..&amount=1000&days=30&from=-8&to=7&strategy=uniform&period=7d`. A `preset=80|90|95` parameter keeps an auto preset live.

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
| `/api/pools` | `/evm/metadata?include24h=true&count=500&sortBy=tvl` (follows `nextOffset`) | 300s |
| `/api/pools/{chain}/{pool}` | `/evm/{chain}/{pool}/metadata?contract_version=v1&include24h=true` | 300s |
| `/api/pools/{chain}/{pool}/bins?period=` | `/evm/{chain}/{pool}/analytics/bins?contract_version=v1&period=` (**undocumented**, used by app.metric.xyz) | 60s |
| `/api/price/{chain}/{token}` | `/evm/{chain}/tokens/{token}/fiat-price` (used only when metadata has no price) | 60s |
| `/api/chains` | `/chains` | 300s |

Error handling:
- An upstream `429` is passed through with `retryAfter`, and the UI shows a Retry button.
- If the bins endpoint fails, the estimate falls back to pool-level data. It is labelled **"pool-level (no per-bin data)"** and uses the pool's 24h LP fees when present, otherwise the 7d fee APR × TVL, shared pro-rata with TVL.
- Very large integers such as `priceProviderCooldownSecs = 2^64−1` are parsed with BigInt, and anything ≥ 2^53 is shown as "never".

Docs: <https://docs.metric.xyz/llms-full.txt>

## Fee model

Everything is in `src/lib/calc.ts`, as pure functions with tests in `tests/`.

- **Window**: `windowDays = (toTs − fromTs) / 86400`. It can be shorter than the requested period for young pools, so the code never assumes 7 or 30.
- **Bin edges**: cumulative sums of `lengthE6` (100 = 0.01%), with bin 0 starting at 0%. Bins are not assumed to have equal width. Mid = (low + high) / 2.
- **Per bin**:
  - `fees_b = token0.lpFeesFiat + token1.lpFeesFiat`
  - `liq_b = token0.avgLiquidityFiat + token1.avgLiquidityFiat`, or the reserves if that sum is 0
  - `dailyFees_b = fees_b / windowDays`
- **Your fees**: `userDaily = Σ_b dailyFees_b × U_b / (liq_b + U_b)`, where `U_b` is your USD in bin b.
- **APR**: `userDaily × 365 / deposit`. Bin APR = `dailyFees_b × 365 / (liq_b + U_b)`.
- **Compounding**: `r = userDaily / deposit`, `value = D × (1 + r)^days − D`.
- **Sanity check**: as `U_b → 0`, `dailyFees_b × 365 / liq_b` should equal Metric's `aprBps / 10000`.
  - `tests/calc.test.ts` checks this on synthetic data.
  - `tests/fixtures.test.ts` checks it on **real** responses to within 1%. Run `npm run fixtures` first to download them into `tests/fixtures/`. The test is skipped when no fixtures are present.

Estimates assume past volume and liquidity continue and that the price stays in your range. **Fees ≠ profit**: price moves can outweigh earned fees.

## Project layout

```
src/lib/calc.ts        fee model, presets, distributions, formatting (pure)
src/lib/normalize.ts   API → Pool normalization (tolerant of field/envelope variations)
src/lib/num.ts         safe number / BigInt parsing
src/lib/risk.ts        tier + reason-code copy
src/lib/urlState.ts    shareable URL state
src/app/api/**         proxy route handlers
src/components/**      thin UI (Planner, PoolPicker, Histogram, BinPlan, RiskPanel)
```
