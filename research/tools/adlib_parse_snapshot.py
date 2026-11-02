import json,re,sys,html as H
def walk(o,acc):
  if isinstance(o,dict):
    if 'ad_archive_id' in o and 'snapshot' in o: acc.append(o)
    for v in o.values(): walk(v,acc)
  elif isinstance(o,list):
    for v in o: walk(v,acc)
src=open(sys.argv[1]).read(); acc=[]
for m in re.finditer(r'<script type="application/json"[^>]*>(.*?)</script>',src,re.S):
  t=m.group(1)
  if 'ad_archive_id' not in t: continue
  try: walk(json.loads(t),acc)
  except Exception as e: print('parse err',e,file=sys.stderr)
out=[]; seen=set()
for a in acc:
  if a['ad_archive_id'] in seen: continue
  seen.add(a['ad_archive_id']); s=a.get('snapshot') or {}
  vids=[v.get('video_hd_url') or v.get('video_sd_url') for v in (s.get('videos') or [])]
  for c in (s.get('cards') or []):
    if c.get('video_hd_url') or c.get('video_sd_url'): vids.append(c.get('video_hd_url') or c.get('video_sd_url'))
  body=(s.get('body') or {}).get('text') if isinstance(s.get('body'),dict) else s.get('body')
  out.append(dict(id=a['ad_archive_id'],page=s.get('page_name') or a.get('page_name'),page_id=a.get('page_id'),
    start=a.get('start_date'),end=a.get('end_date'),active=a.get('is_active'),collation=a.get('collation_count'),
    platforms=a.get('publisher_platform'),title=s.get('title'),body=body,cta=s.get('cta_text'),link=s.get('link_url'),
    caption=s.get('caption'),display=s.get('display_format'),videos=[v for v in vids if v],
    images=[i.get('original_image_url') for i in (s.get('images') or []) if i.get('original_image_url')],
    impressions=a.get('impressions_with_index'),reach=a.get('reach_estimate'),spend=a.get('spend')))
json.dump(out,open(sys.argv[2],'w'),indent=1); print(len(out),'ads',sum(1 for o in out if o['videos']),'with video')
