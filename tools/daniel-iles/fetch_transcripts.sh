#!/usr/bin/env bash
# Pull verbatim (auto-caption) transcripts for every long-form video on
# Daniel Iles' YouTube channel and turn them into timestamped Markdown.
# Needs: python3, pip install yt-dlp
# Output: ./transcripts/<video_id>.md and ./transcripts/ALL.md (everything in one file)
set -euo pipefail
cd "$(dirname "$0")"
CHANNEL="https://www.youtube.com/channel/UCTt7n8GFS6x_Tc_nAzSiK8Q/videos"
mkdir -p subs transcripts

# 1. Refresh the video list (id, seconds, title)
yt-dlp --flat-playlist --print "%(id)s	%(duration)s	%(title)s" "$CHANNEL" > videos.tsv
echo "Videos on channel: $(wc -l < videos.tsv)"

# 2. Download English captions, retrying any that hit rate limits
for attempt in 1 2 3; do
  : > todo.txt
  while IFS=$'\t' read -r id _; do
    ls "subs/$id".*.json3 >/dev/null 2>&1 || echo "https://www.youtube.com/watch?v=$id" >> todo.txt
  done < videos.tsv
  [ -s todo.txt ] || break
  echo "Attempt $attempt: $(wc -l < todo.txt) to fetch"
  yt-dlp --skip-download --ignore-no-formats-error --write-auto-subs --write-subs \
    --sub-langs "en" --sub-format json3 \
    --extractor-args "youtube:player_client=web_embedded,default" \
    --sleep-requests 3 --sleep-subtitles 5 \
    -o "subs/%(id)s.%(ext)s" -a todo.txt || true
done
rm -f todo.txt

# 3. Convert to Markdown, then stitch one combined file in channel order
python3 json3_to_text.py subs videos.tsv transcripts
: > transcripts/ALL.md
while IFS=$'\t' read -r id _; do
  [ -f "transcripts/$id.md" ] && { cat "transcripts/$id.md"; echo; echo "---"; echo; } >> transcripts/ALL.md
done < videos.tsv
echo "Done: $(ls transcripts | grep -vc ALL.md) transcripts -> transcripts/ALL.md"
