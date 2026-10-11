#!/usr/bin/env bash
# Søk i Meta Ads Library via Monid og oppsummer per annonsør.
# Krever: npm i -g @monid-ai/cli && monid keys add -k "$MONID_API_KEY" -l main
# Bruk:   tools/ads_scan.sh <LAND> "<søkeord>" [antall]
#         tools/ads_scan.sh NO "flere kunder" 40
# Kostnad: ca. $0.00075 per annonse (40 annonser ≈ $0.03).
set -euo pipefail
export NO_COLOR=1
country=$1; q=$2; n=${3:-40}
out=${OUT_DIR:-./ads-data}; mkdir -p "$out"
slug=$(echo "${country}_${q}" | tr ' /' '__')
url="https://www.facebook.com/ads/library/?active_status=active&ad_type=all&media_type=all&search_type=keyword_unordered&sort_data[mode]=total_impressions&sort_data[direction]=desc&country=${country}&q=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' "$q")"
run_id=$(monid run -p apify -e /curious_coder/facebook-ads-library-scraper \
  -i "{\"urls\":[{\"url\":\"$url\"}],\"limitPerSource\":$n,\"count\":$n}" -j | python3 -c 'import sys,json;print(json.load(sys.stdin)["runId"])')
monid runs get -r "$run_id" -w 180 -j > "$out/$slug.json"
python3 "$(dirname "$0")/summarize_ads.py" "$out/$slug.json"
