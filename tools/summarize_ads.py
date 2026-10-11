import json,sys,collections,datetime
for f in sys.argv[1:]:
    d=json.load(open(f)); ads=d.get("output") or []
    print("\n#####", f, len(ads))
    g=collections.defaultdict(list)
    for a in ads: g[a["snapshot"].get("page_name") or a.get("page_name")].append(a)
    for page,lst in sorted(g.items(), key=lambda x:-len(x[1])):
        starts=[a.get("start_date") for a in lst if a.get("start_date")]
        old=min(starts) if starts else None
        days=(datetime.datetime.now().timestamp()-old)/86400 if old else -1
        s=lst[0]["snapshot"]; body=(s.get("body") or {}).get("text") if isinstance(s.get("body"),dict) else s.get("body")
        if not body and s.get("cards"): body=s["cards"][0].get("body")
        coll=max(a.get("collation_count") or 1 for a in lst)
        print(f"- {page} | ads={len(lst)} maxdup={coll} oldest={days:.0f}d | {s.get('link_url')} | {s.get('cta_text')} | likes={s.get('page_like_count')}")
        print("   ", (body or s.get("title") or "")[:260].replace("\n"," "))
