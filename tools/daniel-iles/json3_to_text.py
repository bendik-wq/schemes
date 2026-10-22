"""Convert YouTube json3 caption files into timestamped plain-text transcripts.

Usage: python3 json3_to_text.py <subs_dir> <list.tsv> <out_dir>
list.tsv rows: video_id<TAB>duration_seconds<TAB>title
Writes one <id>.md per video, with a [mm:ss] stamp roughly every 30 seconds.
"""
import json, os, sys, glob

subs_dir, list_path, out_dir = sys.argv[1:4]
os.makedirs(out_dir, exist_ok=True)
meta = {}
for line in open(list_path, encoding="utf-8"):
    vid, dur, title = line.rstrip("\n").split("\t", 2)
    meta[vid] = (dur, title)

def stamp(ms):
    s = ms // 1000
    return f"{s//3600}:{s%3600//60:02d}:{s%60:02d}" if s >= 3600 else f"{s//60}:{s%60:02d}"

for vid, (dur, title) in meta.items():
    files = sorted(glob.glob(os.path.join(subs_dir, f"{vid}.*.json3")))
    # prefer manual English, then auto-generated
    if not files:
        continue
    data = json.load(open(files[0], encoding="utf-8"))
    chunks, cur, cur_start, last_stamp = [], [], None, -30000
    for ev in data.get("events", []):
        segs = ev.get("segs")
        if not segs:
            continue
        t = ev.get("tStartMs", 0)
        text = "".join(s.get("utf8", "") for s in segs).replace("\n", " ").strip()
        if not text:
            continue
        if t - last_stamp >= 30000 and cur:
            chunks.append((cur_start, " ".join(cur)))
            cur, cur_start = [], None
        if cur_start is None:
            cur_start, last_stamp = t, t
        cur.append(text)
    if cur:
        chunks.append((cur_start, " ".join(cur)))
    url = f"https://www.youtube.com/watch?v={vid}"
    with open(os.path.join(out_dir, f"{vid}.md"), "w", encoding="utf-8") as f:
        f.write(f"# {title}\n\n{url} · {int(dur)//60} min · auto-generated captions\n\n")
        for ms, txt in chunks:
            f.write(f"[{stamp(ms)}]({url}&t={ms//1000}s) {' '.join(txt.split())}\n\n")
print("done")
