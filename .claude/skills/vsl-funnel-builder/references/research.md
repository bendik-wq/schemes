# Research playbook

## Meta Ads Library (Monid)
```bash
npm i -g @monid-ai/cli && monid keys add -k "$MONID_API_KEY" -l main   # key from the user, never committed
tools/ads_scan.sh US "<query>" 40      # writes ads-data/<slug>.json + summary per advertiser
```
Signals: many active variants (scaling), oldest active ad 30+ days (profitable), several countries (validated), new creatives in the last 14 days (pushing now). `start_date` filters are ignored by the scraper, so read `start_date` per ad instead.

## Google Trends (Monid / DataForSEO)
```bash
monid run -p dataforseo -e /keywords/google-trends-explore \
  -i '{"keywords":["telehealth","kw1","kw2","kw3","kw4"],"location_code":2840,"time_range":"past_5_years"}' -w 150 -j
```
- Max 5 keywords. Keep one anchor (e.g. "telehealth") in every call to compare across calls.
- `language_code` and `item_types` return a 400 on this wrapper; leave them out.
- Metrics: last 13 weeks vs the same period last year (YoY), and vs the first 52 weeks (5-year growth).
- Cost $0.011/call. Check `monid balance` first.

## Sentiment
Use one general-purpose agent with web search for the top themes: drivers, backlash, regulatory catalysts with dates, where money is made. Mark unverified claims.

## Teardown of a reference offer
Playwright screenshot of the homepage + h1/h2/button text; Trustpilot/Reddit for price and complaints; note structure, guarantee, funnel steps.
