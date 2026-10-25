"""YouTube search signal: for each query, parse the first page of results (ytInitialData) and
summarise views and upload recency. Recent = published within ~6 months."""
import json, re, sys, time, random, statistics, urllib.parse
import requests

OUT = sys.argv[1]
QUERIES = [
 "peptides","peptide business","start a peptide company","research peptides","peptide clinic","retatrutide","GLP-1 business","med spa business",
 "TRT clinic business","IV therapy business","longevity clinic","red light therapy business","hyperbaric chamber business","NAD+ injections",
 "patient financing","customer financing for business","offer financing to customers","business funding agency","business credit","credit repair business",
 "0% business credit cards","buy now pay later for business","DSCR loan","private credit",
 "AI receptionist","AI voice agent business","AI automation agency","AI agents business","vibe coding","claude code","generative engine optimization",
 "AI UGC","clipping agency","TikTok Shop agency","Whop business","Skool community","home care agency business","ABA therapy business",
 "laundromat business","car wash business","vending machine business","buy a business","self storage business","padel business",
 "prediction markets","Kalshi","home battery business","EV charger installation business","THC drinks","matcha business",
]
H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
     "Accept-Language": "en-US,en;q=0.9"}

def parse_views(s):
    if not s: return None
    s = s.replace(",", "").lower()
    m = re.search(r"([\d.]+)\s*([km]?)", s)
    if not m: return None
    n = float(m.group(1)); n *= {"k": 1e3, "m": 1e6}.get(m.group(2), 1)
    return int(n)

def age_days(s):
    if not s: return None
    m = re.search(r"(\d+)\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?|mo|y|w|d|h|m|s)\b", s)
    if not m: return None
    n = int(m.group(1)); u = m.group(2)
    if u.startswith("mo") or u.startswith("month"): return n * 30
    if u.startswith("y"): return n * 365
    if u.startswith("w"): return n * 7
    if u.startswith("d"): return n
    return 0

def walk(o, acc):
    if isinstance(o, dict):
        if "videoRenderer" in o:
            v = o["videoRenderer"]
            title = "".join(r.get("text", "") for r in v.get("title", {}).get("runs", []))
            views = v.get("viewCountText", {}).get("simpleText") or "".join(r.get("text", "") for r in v.get("viewCountText", {}).get("runs", []))
            pub = v.get("publishedTimeText", {}).get("simpleText")
            ch = "".join(r.get("text", "") for r in v.get("ownerText", {}).get("runs", []))
            acc.append({"title": title, "views": parse_views(views), "age_days": age_days(pub), "channel": ch, "id": v.get("videoId")})
        for x in o.values(): walk(x, acc)
    elif isinstance(o, list):
        for x in o: walk(x, acc)

res = {}
for q in QUERIES:
    url = "https://www.youtube.com/results?" + urllib.parse.urlencode({"search_query": q, "hl": "en", "gl": "US"})
    try:
        html = requests.get(url, headers=H, timeout=30, verify="/root/.ccr/ca-bundle.crt").text
        m = re.search(r"var ytInitialData = (\{.*?\});</script>", html, re.S)
        acc = []
        if m: walk(json.loads(m.group(1)), acc)
        recent = [v for v in acc if v["age_days"] is not None and v["age_days"] <= 180 and v["views"]]
        allv = [v["views"] for v in acc if v["views"]]
        res[q] = {"n": len(acc), "recent_n": len(recent),
                  "median_views_recent": int(statistics.median([v["views"] for v in recent])) if recent else 0,
                  "sum_views_recent": sum(v["views"] for v in recent),
                  "median_views_all": int(statistics.median(allv)) if allv else 0,
                  "top_recent": sorted(recent, key=lambda v: -v["views"])[:5]}
        print(q, res[q]["n"], res[q]["recent_n"], res[q]["median_views_recent"], flush=True)
    except Exception as e:
        res[q] = {"error": str(e)[:200]}; print(q, "ERR", e, flush=True)
    json.dump(res, open(OUT + "/youtube.json", "w"), indent=1)
    time.sleep(2 + random.random() * 2)
print("YT DONE")
