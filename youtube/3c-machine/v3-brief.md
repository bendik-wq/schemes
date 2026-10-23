# V3 brief: pure, standalone scripts

The user wants **only the script**: the words Josh says on camera, nothing else, laid out so it is easy to read and film. Each video must stand completely on its own.

Input: `youtube/3c-machine/v3-in/<NN-MM>.md` (five episodes, already stripped to spoken text). Output: `youtube/3c-machine/v3/<NN-MM>.md`.

## 1. Make every video standalone

Remove every reference to other videos, the series or its structure, and rewrite the sentence so it still reads naturally:
- "Next episode: …", "That's next episode", "That was episode 2", "Episode 22 goes line by line", "from episode 4", "in Act 3", "Season 2", "this series", "this channel", "earlier in the series", "the five-stage map lit up on Capital". Delete hand-offs to the next video entirely.
- If a sentence relied on another episode for a point the viewer needs, state the point in one short clause instead ("Three years of financials and matching tax returns, before any offer.") or drop it.
- "This series is for…" becomes "This is for…".
- The 3C model (Credibility, Capital, Closing) and the five stages as an idea are fine; just don't present them as a series map or "where we are in the series".
- The video should end on the call to action (book a call with Josh; the free 3C Starter Kit for people who aren't a fit), not on a pointer to another video.

## 2. Make it readable

- Each video starts with `## <Video title>` (keep the title, but drop the "EP NN ·" prefix). Nothing else in the file except the scripts.
- Paragraphs of 1–2 sentences, max ~35 words. A blank line between paragraphs.
- Spoken section signposts ("Level 1: Pay cash.", "Mistake 2…", "Option A…", "The rule.") stay in **bold** on their own line, so Josh can see the structure. Add a bold signpost where a clear new section starts and none exists, but only words Josh would actually say (e.g. **Here's the maths.**, **Where people lose money.**, **What to do.**). No production labels (no HOOK, STAKES, CTA, timecodes).
- Turn bullet lists into spoken lists ("One… Two… Three…") or short paragraphs. No bullets, tables or headings other than the title.
- Write numbers the way they read cleanly on a teleprompter: "$1.2 million", "300 thousand", "1.5 times". Be consistent within a video.
- Keep every `[JOSH: …]` gap exactly as it is, in bold, on its own line where it sits.

## 3. Don't change the substance

Keep the content, the numbers, the claims, the relationships (Cam, Jason, Elliot = friends; Jy = student/mentee; Saul = member; Christian Dawes = example), the hooks and the closes. Only cut cross-references and tighten wording where it's clumsy. Don't add facts. No price, no exclamation marks.

## Delivery

Write `youtube/3c-machine/v3/<NN-MM>.md`. Then run `grep -niE "episode|series|season|\bact [0-9]|next video|this channel" <your file>` and fix anything left (the word "episode" should not appear at all). Touch nothing else; do not commit. Reply with one line per video: its title and the number of cross-references removed.
