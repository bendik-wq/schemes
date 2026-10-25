"""Bottom-up discovery: rising related queries (12 months, US) for broad business/demand seeds.
Rising queries with large % gains point at niches that are newly getting attention."""
import json, os, sys, time, random
from pytrends.request import TrendReq
OUT = sys.argv[1]
SEEDS = ["how to start a business","business ideas","side hustle","franchise","certification","license","become a","certified",
         "course","agency","consultant","inspection","compliance","audit","grant","tax credit","rebate","reimbursement",
         "CPT code","new law","small business","service near me","clinic","therapy","software for","training","contractor",
         "home services","pet","senior","kids","wedding","boat","rv","farm","restaurant","dentist","lawyer","accountant","real estate agent"]
p = TrendReq(hl='en-US', tz=0, timeout=(10, 40), requests_args={'verify': '/root/.ccr/ca-bundle.crt'})
path = os.path.join(OUT, "rising.json")
res = json.load(open(path)) if os.path.exists(path) else {}
for s in SEEDS:
    if s in res: continue
    for i in range(5):
        try:
            p.build_payload([s], timeframe='today 12-m', geo='US')
            r = p.related_queries().get(s, {})
            df = r.get("rising")
            res[s] = [] if df is None else df.head(25).to_dict("records")
            break
        except Exception as e:
            print(s, type(e).__name__, str(e)[:80], flush=True); time.sleep(30 * (i + 1))
    json.dump(res, open(path, "w"), indent=1)
    print("ok", s, len(res.get(s, [])), flush=True)
    time.sleep(8 + random.random() * 6)
print("DISCOVER DONE")
