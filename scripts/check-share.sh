#!/usr/bin/env bash
# Simulates X's crawler against a deploy: page meta tags in <head> + /api/og as Twitterbot.
# Usage: scripts/check-share.sh [base-url]   (default https://metric-lp-planner.vercel.app)
set -uo pipefail
BASE=${1:-https://metric-lp-planner.vercel.app}
UA="Twitterbot/1.0"
PAGE="$BASE/?chain=56&pool=0xee90641E7c3b4d6338Ab7f1c23Dfb979FAb5f096&amount=1000&days=30&from=-3&to=1&t=$(date +%s)"
fail=0

html=$(curl -s -A "$UA" -w '\n__STATUS__%{http_code}' "$PAGE")
status=${html##*__STATUS__}; html=${html%__STATUS__*}
head=${html%%</head>*}
echo "page: HTTP $status"
[ "$status" = 200 ] || fail=1
for tag in 'property="og:image"' 'property="og:image:width"' 'property="og:image:height"' 'property="og:image:type"' \
           'name="twitter:card"' 'name="twitter:image"' 'name="twitter:image:alt"' 'name="twitter:site"' 'name="twitter:creator"'; do
  if grep -q "<meta $tag" <<<"$head"; then echo "  ok   $tag in <head>"; else echo "  FAIL $tag not in <head>"; fail=1; fi
done
img=$(grep -o '<meta name="twitter:image" content="[^"]*"' <<<"$head" | head -1 | sed 's/.*content="//; s/"$//; s/&amp;/\&/g')
echo "twitter:image: $img"
case "$img" in https://*|http://*) ;; *) echo "  FAIL image URL is not absolute"; fail=1 ;; esac
grep -q '[?&]t=' <<<"$img" && { echo "  FAIL volatile param leaked into image URL"; fail=1; }

for method in HEAD GET; do
  if [ $method = HEAD ]; then out=$(curl -sI -A "$UA" "$img"); else out=$(curl -s -A "$UA" -D - -o /tmp/binwise-og.png "$img"); fi
  code=$(awk 'NR==1{print $2}' <<<"$out"); ctype=$(grep -i '^content-type:' <<<"$out" | tr -d '\r' | cut -d' ' -f2)
  cc=$(grep -i '^cache-control:' <<<"$out" | tr -d '\r' | cut -d' ' -f2-)
  echo "og $method: HTTP $code $ctype | cache-control: $cc"
  [ "$code" = 200 ] && [ "$ctype" = image/png ] || fail=1
done
file /tmp/binwise-og.png 2>/dev/null | grep -q "1200 x 630" && echo "  ok   PNG 1200x630" || { echo "  FAIL not a 1200x630 PNG"; fail=1; }

[ $fail = 0 ] && echo "ALL CHECKS PASSED" || echo "SOME CHECKS FAILED"
exit $fail
