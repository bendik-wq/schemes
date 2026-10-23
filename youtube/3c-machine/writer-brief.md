# Writer brief: The 3C Machine scripts

You write 5 episodes (one act) of "The 3C Machine", a 100-episode YouTube series fronted by **Josh Li**. Every episode is a VSL for one thing: a call with Josh about buying a business with little to no money down (Owners Academy or 1:1 advisory). No price is ever stated.

## Read first, fully

1. `youtube/3c-machine/00-plan.md`: §1 offer, §2 red thread, §3 rules, §4 template, and your act's rows (Season 1 in §5; Seasons 2–3 at the end of the file).
2. `youtube/3c-machine/source-owners-academy.md`: the ONLY source for Josh's claims, stories, objection answers and proof. Keep each story's relationship exactly (Cam, Jason, Elliot = friends; Jy = student/mentee; Saul = member; Christian Dawes = example). Never call a friend a student.
3. The 3C skill: `ls ~/.claude/skills/synced/*/3c-acquisition-model/` (SKILL.md + references/).
4. Daniel Iles: grep `research/daniel-iles/playbook.md` and `research/daniel-iles/video-notes.md` for your topics. Use only teachings, numbers, quotes and timestamped YouTube links that are in those files. If a planned tie-in isn't supported, replace it with one that is, or drop it.

## Hard rules

- Never invent facts about Josh, his deals, students, friends or numbers. Where a real detail is needed and not in the source, write a `[JOSH: …]` prompt that says exactly what to fill (e.g. `[JOSH: the industry and revenue of the $3M business]`). Industry facts (typical margins, licences) are allowed only as general, hedged knowledge ("often", "typically") and never as Josh's experience.
- On-screen disclaimers: "Results not typical; records on file" near deal and income claims; "Education, not financial or legal advice" on structuring, tax and legal content.
- Worked examples use round numbers and are labelled illustrative on camera.
- Ad-safe hooks: no "are you…" personal call-outs; no income claim in the first line.

## Each episode, in this order, under `## Episode NN · <final title>`

1. `### Metadata`: 3 title options, thumbnail text (≤4 words), runtime target, stage lit on the 3C map (Credibility / Capital / Closing / Grow / Exit).
2. `### Script`: Josh to camera, word for word, 1,500–1,900 words. Bold block headings with timecodes from the §4 template; `[SCREEN: …]` / `[B-ROLL: …]` cues. Soft pitch at ~2:30. Full offer block per §1. "Do this this week" inside the script. Ends with the book-a-call CTA, the free 3C Starter Kit for non-fits, and the hand-off to the next episode.
3. `### Description`: timestamps; Daniel source links used; the lines "Education, not financial or legal advice. Results not typical; records on file." and "Not affiliated with Daniel Iles or Viral Coach."; link `[BOOK LINK]?utm_source=youtube&utm_medium=video&utm_campaign=3c-machine&utm_content=epNN`.
4. `### Pinned comment`.
5. `### Shorts / ad cut-downs`: 3, each with a timecode range, the hook line, and why it works.

**Style:** Josh's voice: direct, calm, a bit blunt, Australian, plain English, short sentences, no hype words, few em-dashes. Teaching that's useful on its own. Keep the shared opening device (the 3C map, stage lit) and closing turn (alone vs with me), but vary the wording so episodes don't sound templated.

## Delivery

- **Step A:** write all five to the file named in your task (H1 `# The 3C Machine — Act N: <name> (NN–NN)`).
- **Step B:** copy each episode verbatim into its Claude Docs tab. Load the tools with ToolSearch `select:mcp__Claude_Docs__update,mcp__Claude_Docs__guide`. Doc id `6a5f94be-f487-4798-8d73-2e5cd0ca715f`. One call per episode, replacing that episode's pending block:

```
mcp__Claude_Docs__update(ref={"object":"node","id":"<TAB NODE>"}, engine="prose",
  container={"kind":"project","id":"6a5f94be-f487-4798-8d73-2e5cd0ca715f"},
  payload={"ops":[{"op":"replace","target":{"kind":"blocks","ids":["<PENDING ID>"]},
    "with":{"from":{"kind":"inline","content":"<the episode's markdown, from its ## line to before the next ##>"},"as":"markdown"}}]})
```

- Drop `---` rules. Turn relative repo links into `https://github.com/bendik-wq/schemes/blob/claude/optimistic-brown-2jg5g0/<path>`.
- If a call is refused: call guide with items `["refusal.<code>"]` and make the smallest fix. If an episode is too big for one call, replace the pending block with the first half, then `insert` the rest `"side":"after"` the last block id in the ack.
- Touch nothing else in the doc or repo. Do not commit.
- **Reply** with 5 lines (final title + hook per episode), plus every `[JOSH: …]` prompt you left and any fact you couldn't support.
