"""Validate candidate niches: 5-year US Google Trends per keyword (anchor-normalised) + YouTube recency/views."""
import json, os, sys, time, random, re, statistics, urllib.parse
import requests
from pytrends.request import TrendReq
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
ANCHOR = "pool service"
TERMS = ["fire extinguisher inspection","backflow testing","hood cleaning","infrared thermography","permanent christmas lights",
 "dryer vent cleaning","fire door inspection","HOA management","senior move manager","estate cleanout",
 "scholarship granting organization","education freedom tax credit","microschool","education savings account","school voucher",
 "fortified roof","wildfire mitigation","roof grant","ICHRA","assumable mortgage",
 "english proficiency truck drivers","tariff refund","duty drawback","sell land to data center","data center lease land",
 "direct primary care","remote patient monitoring","website accessibility","Medicaid work requirements","cost segregation",
 "AI policy","Claude certification","AI training for employees","EPR packaging","rural health transformation",
 "home inspection","sewer camera inspection","heat pump","EPA 608 certification","AI accountant"]
YT = ["how to start a fire extinguisher inspection business","backflow testing business","hood cleaning business","permanent christmas lights business",
 "scholarship granting organization","federal scholarship tax credit","microschool","texas education freedom accounts","fortified roof grant","wildfire mitigation business",
 "ICHRA","assumable mortgage","english proficiency test truck drivers","tariff refund","data center land lease","direct primary care",
 "remote patient monitoring business","Claude certified architect","AI policy for employees","cost segregation","dryer vent cleaning business","senior move manager"]
def stats(vals):
    n=len(vals); l=sum(vals[-13:-1])/12; ya=sum(vals[-65:-53])/12 if n>=65 else 0; y2=sum(vals[-117:-105])/12 if n>=117 else 0
    pk=max(vals) if vals else 0
    return {"last12":round(l,2),"yoy":round(l/ya,2) if ya else None,"two_year":round(l/y2,2) if y2 else None,"at_peak_pct":round(100*l/pk,1) if pk else 0}
p = TrendReq(hl='en-US', tz=0, timeout=(10,40), requests_args={'verify':'/root/.ccr/ca-bundle.crt'})
path=os.path.join(OUT,"trends.json"); data=json.load(open(path)) if os.path.exists(path) else {}
for i in range(0,len(TERMS),4):
    chunk=[t for t in TERMS[i:i+4] if t not in data]
    if not chunk: continue
    for a in range(5):
        try:
            p.build_payload([ANCHOR]+chunk,timeframe='today 5-y',geo='US'); df=p.interest_over_time(); break
        except Exception as e:
            print("retry",chunk,str(e)[:80],flush=True); time.sleep(30*(a+1)); df=None
    if df is None or df.empty:
        for t in chunk: data[t]={"error":"no data"}
    else:
        amax=max(df[ANCHOR]) or 1
        for t in chunk:
            v=list(df[t]); s=stats(v); s["size_vs_anchor"]=round(s["last12"]*100/amax,1); data[t]=s
    json.dump(data,open(path,"w"),indent=1); print("trends",chunk,flush=True); time.sleep(9+random.random()*6)
H={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36","Accept-Language":"en-US,en;q=0.9"}
def pv(s):
    if not s: return None
    m=re.search(r"([\d.,]+)\s*([KkMm]?)",s.replace(",",""))
    return int(float(m.group(1))*{"k":1e3,"m":1e6}.get(m.group(2).lower(),1)) if m else None
def age(s):
    if not s: return None
    m=re.search(r"(\d+)\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?|mo|y|w|d|h)\b",s)
    if not m: return None
    n=int(m.group(1));u=m.group(2)
    return n*30 if u.startswith("mo") else n*365 if u.startswith("y") else n*7 if u.startswith("w") else n if u.startswith("d") else 0
def walk(o,acc):
    if isinstance(o,dict):
        if "videoRenderer" in o:
            v=o["videoRenderer"]; acc.append({"title":"".join(r.get("text","") for r in v.get("title",{}).get("runs",[])),
              "views":pv((v.get("viewCountText") or {}).get("simpleText")),"age":age((v.get("publishedTimeText") or {}).get("simpleText"))})
        for x in o.values(): walk(x,acc)
    elif isinstance(o,list):
        for x in o: walk(x,acc)
yt={}
for q in YT:
    html=requests.get("https://www.youtube.com/results?"+urllib.parse.urlencode({"search_query":q,"hl":"en","gl":"US"}),headers=H,timeout=30,verify="/root/.ccr/ca-bundle.crt").text
    m=re.search(r"var ytInitialData = (\{.*?\});</script>",html,re.S); acc=[]
    if m: walk(json.loads(m.group(1)),acc)
    rec=[v for v in acc if v["age"] is not None and v["age"]<=365 and v["views"]]
    yt[q]={"n":len(acc),"recent_12m":len(rec),"sum_views_recent":sum(v["views"] for v in rec),"max_recent":max([v["views"] for v in rec] or [0]),
           "top":sorted(rec,key=lambda v:-v["views"])[:3]}
    print("yt",q,yt[q]["recent_12m"],yt[q]["sum_views_recent"],flush=True); time.sleep(2)
json.dump(yt,open(os.path.join(OUT,"youtube.json"),"w"),indent=1); print("VALIDATE DONE")
