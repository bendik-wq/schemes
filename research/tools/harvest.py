"""Google Trends harvester: interest over 5y (US) per keyword, normalised against one anchor term,
plus rising related queries for seed terms. Writes JSON incrementally so a crash keeps progress."""
import json, os, sys, time, random
from pytrends.request import TrendReq

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
ANCHOR = "med spa"
GROUPS = {
 "health": ["peptides","peptide therapy","BPC-157","retatrutide","tirzepatide","semaglutide","compounded semaglutide","GLP-1","NAD injections","IV therapy",
            "TRT clinic","testosterone replacement therapy","hormone replacement therapy","menopause","longevity clinic","red light therapy","hyperbaric oxygen therapy",
            "cold plunge","functional medicine","weight loss clinic","methylene blue","sermorelin","GHK-Cu","peptide clinic","microneedling","exosomes","stem cell therapy",
            "ketamine therapy","creatine","sauna"],
 "finance": ["buy now pay later","patient financing","customer financing","business funding","business credit","merchant cash advance","revenue based financing",
            "home improvement financing","embedded finance","credit repair","tradelines","private credit","DSCR loan","SBA loan","equipment financing","invoice factoring",
            "0% business credit cards","instant loan approval","financing for contractors","Klarna"],
 "ai": ["AI agents","AI receptionist","AI voice agent","AI automation agency","vibe coding","Claude Code","n8n","generative engine optimization","AI phone answering",
        "AI UGC","AI influencer","faceless youtube","clipping","Lovable","Cursor AI","AI SDR","AI chatbot for business","Make.com","GoHighLevel","AI video"],
 "commerce": ["TikTok Shop","Whop","Skool","dropshipping","vending machine business","laundromat","car wash business","pickleball","padel","prediction markets",
              "Kalshi","Polymarket","stablecoin","gold IRA","home battery","EV charger installation","self storage","short term rental","THC drinks","functional mushrooms",
              "kratom","home care agency","medical billing","ABA therapy","buy a business","search fund","Hyrox","matcha","golf simulator","dog daycare",
              "solar","data center","sports betting","ai companion","senior living"],
}
SEEDS = ["peptides","retatrutide","peptide clinic","patient financing","customer financing","business funding","AI receptionist","AI agents","TikTok Shop",
         "Whop","prediction markets","home care agency","red light therapy","NAD injections","longevity clinic","med spa","GLP-1","vibe coding","buy a business","hormone replacement therapy"]

def client():
    return TrendReq(hl='en-US', tz=0, timeout=(10, 40), requests_args={'verify': '/root/.ccr/ca-bundle.crt'})

def with_retry(fn, label):
    for i in range(6):
        try:
            return fn()
        except Exception as e:
            wait = 30 * (i + 1) + random.random() * 10
            print(f"[{label}] {type(e).__name__}: {str(e)[:120]} — sleeping {wait:.0f}s", flush=True)
            time.sleep(wait)
    return None

def series_stats(vals):
    n = len(vals)
    last12 = sum(vals[-13:-1]) / 12 if n >= 13 else 0          # skip the partial current week
    prev12 = sum(vals[-25:-13]) / 12 if n >= 25 else 0
    yago = sum(vals[-65:-53]) / 12 if n >= 65 else 0
    y2ago = sum(vals[-117:-105]) / 12 if n >= 117 else 0
    peak = max(vals) if vals else 0
    return {"last12": round(last12, 2), "prev12": round(prev12, 2), "year_ago": round(yago, 2), "two_years_ago": round(y2ago, 2),
            "peak": peak, "at_peak_pct": round(100 * last12 / peak, 1) if peak else 0,
            "yoy": round(last12 / yago, 2) if yago else None, "two_year": round(last12 / y2ago, 2) if y2ago else None,
            "qoq": round(last12 / prev12, 2) if prev12 else None}

iot_path = os.path.join(OUT, "interest.json")
data = json.load(open(iot_path)) if os.path.exists(iot_path) else {}
p = client()
for group, terms in GROUPS.items():
    for i in range(0, len(terms), 4):
        chunk = [t for t in terms[i:i + 4] if t not in data]
        if not chunk:
            continue
        kw = [ANCHOR] + chunk
        def run():
            p.build_payload(kw, timeframe='today 5-y', geo='US')
            return p.interest_over_time()
        df = with_retry(run, ",".join(chunk))
        if df is None or df.empty:
            for t in chunk: data[t] = {"group": group, "error": "no data"}
        else:
            anchor = list(df[ANCHOR])
            amax = max(anchor) or 1
            for t in chunk:
                vals = list(df[t])
                # Express every term relative to the anchor's peak so groups are comparable.
                scale = 100 / amax
                rel = [round(v * scale, 2) for v in vals]
                data[t] = {"group": group, "stats": series_stats(vals), "rel_last12": series_stats(rel)["last12"],
                           "dates": [str(d.date()) for d in df.index][-60:], "series_tail": vals[-60:]}
        json.dump(data, open(iot_path, "w"), indent=1)
        print("done", chunk, flush=True)
        time.sleep(8 + random.random() * 6)

rq_path = os.path.join(OUT, "related.json")
rel = json.load(open(rq_path)) if os.path.exists(rq_path) else {}
for s in SEEDS:
    if s in rel:
        continue
    def run():
        p.build_payload([s], timeframe='today 12-m', geo='US')
        r = p.related_queries().get(s, {})
        out = {}
        for k in ("rising", "top"):
            df = r.get(k)
            out[k] = [] if df is None else df.head(25).to_dict("records")
        return out
    res = with_retry(run, "related " + s)
    rel[s] = res or {"error": "failed"}
    json.dump(rel, open(rq_path, "w"), indent=1)
    print("related", s, flush=True)
    time.sleep(8 + random.random() * 6)
print("ALL DONE", flush=True)
