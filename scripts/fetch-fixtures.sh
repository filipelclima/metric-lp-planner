#!/usr/bin/env bash
# Downloads real Metric API responses into tests/fixtures for the aprBps sanity test.
set -euo pipefail
B=https://api.metric.xyz/public/v1
CHAIN=${1:-56}
POOL=${2:-0xee90641E7c3b4d6338Ab7f1c23Dfb979FAb5f096}
OUT="$(dirname "$0")/../tests/fixtures"
mkdir -p "$OUT"
for P in 24h 7d 30d; do
  curl -fsS "$B/evm/$CHAIN/$POOL/analytics/bins?contract_version=v1&period=$P" -o "$OUT/$CHAIN-$POOL-$P.bins.json"
done
curl -fsS "$B/evm/$CHAIN/$POOL/metadata?contract_version=v1&include24h=true" -o "$OUT/$CHAIN-$POOL.metadata.json"
echo "Saved fixtures to $OUT"
