#!/usr/bin/env bash
# Rebuild the image bank from its manifest (eval/bank/bank.json).
#
# The bank's actual .jpg files are gitignored (20+ MB of CC images don't
# belong in git history); this script re-downloads them from Wikimedia
# Commons using the titles + attribution recorded in the manifest. Run it
# after a fresh clone if you need the images locally.
#
#   ./scripts/devtest/fetch-bank.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BANK="$ROOT/eval/bank"
MANIFEST="$BANK/bank.json"
API="https://commons.wikimedia.org/w/api.php"
UA="BinocularBankFetch/1.0 (workshop inventory testing)"

[ -f "$MANIFEST" ] || { echo "no manifest at $MANIFEST"; exit 1; }
command -v jq >/dev/null || { echo "jq required"; exit 1; }

total=$(jq '.images | length' "$MANIFEST"); ok=0
echo "rebuilding $total images into $BANK ..."
jq -r '.images[] | "\(.id)\t\(.title)"' "$MANIFEST" | while IFS=$'\t' read -r id title; do
  [ -f "$BANK/$id" ] && { ok=$((ok+1)); continue; }
  thumb=$(curl -sG "$API" -A "$UA" \
    --data-urlencode "action=query" --data-urlencode "format=json" \
    --data-urlencode "prop=imageinfo" --data-urlencode "iiprop=url" \
    --data-urlencode "iiurlwidth=1024" --data-urlencode "titles=File:$title" \
    | jq -r '.query.pages[]?.imageinfo[0]?.thumburl // empty')
  if [ -n "$thumb" ] && curl -s -A "$UA" -o "$BANK/$id" "$thumb" && [ -s "$BANK/$id" ]; then
    ok=$((ok+1)); printf "\r  %s ... %d/%d" "$id" "$ok" "$total"
  else
    rm -f "$BANK/$id"; echo "  MISS: $id ($title)"
  fi
  sleep 0.2
done
echo; echo "done."
