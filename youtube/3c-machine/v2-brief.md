# V2 rewrite brief: The 3C Machine

You are rewriting one act (five episodes) of "The 3C Machine", a 100-episode YouTube series fronted by **Josh Li**. Every episode sells one thing: a call with Josh about buying a business with little to no money down (Owners Academy or 1:1 advisory). No price is ever stated.

The v1 scripts are too long, too beginner and too much like a wall of text. V2 is tighter, more expert, more money-focused, and laid out so it scans.

## Read first, fully

1. `youtube/3c-machine/daniel-style-guide.md`: how Daniel Iles hooks, structures and explains. **This is the format to copy.** Copy his *format*, not his content.
2. `~/.claude/skills/synced/*/sultanic-copy-frameworks/SKILL.md` and its `references/` (openers, body-frameworks, belief-identity-shift, closes), plus `~/.claude/skills/synced/*/copy-sultanic/SKILL.md`. **This is the persuasion layer.**
3. `youtube/3c-machine/source-owners-academy.md`: the only source for Josh's facts, stories and proof. Relationships exactly as stated (Cam, Jason, Elliot = friends; Jy = student/mentee; Saul = member; Christian Dawes = example).
4. Your act's v1 file (named in your task). Keep its topic, facts, worked numbers that hold up, every `[JOSH: …]` prompt, and its best lines. Rewrite everything else.

## What changes from v1

- **Audience: people who want to make money.** Business owners ($1–20M businesses), high earners and executives, people with capital. Lead every episode with the money: cash flow, equity, exit value, price paid vs value created, in numbers. Answer "what's this worth to me?" in the first 20 seconds.
- **Not beginner.** Assume a smart operator. No hand-holding, no "great question", no repeating the point three ways. Define a term once, in one line, then use it.
- **One concept per episode, explained cleanly:** the one-line definition, the mechanism, the numbers, the decision rule. Then stop.
- **Shorter.** Spoken script **1,000–1,300 words** (about 7–9 minutes). Finales (eps 40, 70, 100) up to 1,600.
- **Daniel Iles appears nowhere by name.** No Daniel quotes, stories, numbers or links. Use his structure and hook style only. General business principles are fine in Josh's voice; Daniel's specific claims and stories are not.
- **Sultanic, compact.** One opener type in the hook. One Not-Your-Fault line. One belief shift. The turn (Two Paths or No Choice), Identity Close and After Close live in the CLOSE section, in a few tight sentences. No framework tag lines in the script; list the frameworks in the episode header table instead.
- **Neat layout** (template below): header table, labelled beats, short paragraphs, on-screen callouts, numbers in small tables, a compact production table.

## Hard rules (unchanged)

- Never invent facts about Josh, his deals, students, friends or numbers. Missing facts stay as `[JOSH: …]` prompts. Keep every prompt from v1 that still applies, shortened to one line.
- On-screen disclaimers, as callouts: "Results not typical; records on file." near deal and income claims; "Education, not financial or legal advice." on structuring, tax and legal content. Worked examples are labelled illustrative.
- No price. No fake scarcity or urgency. No income promises. No exclamation marks.
- Ad-safe first line: no "are you…" call-outs, no income claim in the first line.
- Keep the episode number, topic and place in the series. Keep the hand-off to the next episode, as one line at the end of CLOSE.

## Template (follow exactly)

The act file starts with:

```
# Act N · <Act name>

<Two sentences: what this act covers and why it matters to someone who wants to make money.>

| EP | Title | The money |
|---|---|---|
| 11 | <final title> | <one line: the money outcome> |
| … five rows … |
```

Then each episode:

```
## EP 11 · <Final title>

| | |
|---|---|
| **The money** | <one sentence, with a number: what this unlocks> |
| **Hook** | "<first spoken line>" |
| **For** | <ICP: Trapped Owner / One-Business Ceiling / HNW Capital Deployer / Corporate Prisoner> |
| **Stage** | <Credibility / Capital / Closing / Grow / Exit> · Season X, Act Y |
| **Runtime** | ~8 min |
| **Copy** | <opener> · <belief shift> · <close stack> |

### Script

**HOOK · 0:00**

<2–4 short lines. Daniel-style hook fused with the Sultanic opener: the result or number, the contrarian claim, the open loop.>

> **On screen:** <text overlay>

**STAKES · 0:20**

<Why this matters in money. Who it's for, who it isn't. 3–5 sentences.>

**THE FRAME · 0:45**

<The whole idea in one line, then "there are N parts" or the levels/stages, Daniel-style. Include the Not-Your-Fault line here or in the breakdown.>

**SOFT CTA · ~1:30**

<One or two sentences: "I help owners do this. Book a call below. Now the detail.">

**1 · <Part name> · <time>**

<Tight explanation: definition, mechanism, number, rule. Paragraphs of 1–3 sentences.>

**2 · <Part name> · <time>**

**3 · <Part name> · <time>**   (3–5 parts; not every episode needs 5)

**THE NUMBERS · <time>**

| | Illustrative |
|---|---|
| <line> | <$> |

<1–2 sentences reading the table.>

**WHERE PEOPLE LOSE MONEY · <time>**

- <mistake, and what it costs>
- <mistake>
- <mistake>

**CLOSE · <time>**

<The turn (Two Paths / No Choice), what the call with Josh gives them (Academy or 1:1, no price), Identity Close ("If you're someone who…"), After Close ("Thirty days from now…"), "Book a call with me below. Not a setter. Me." Then one line for non-fits: the free 3C Starter Kit. Then one line handing off to the next episode.>

### Production

| | |
|---|---|
| **Titles** | 1. … 2. … 3. … |
| **Thumbnail** | <≤4 words> |
| **Shorts** | 1. "<hook>" (0:00–0:40) 2. "<hook>" (…) 3. "<hook>" (…) |
| **Description** | <2 sentences> · Education, not financial or legal advice. Results not typical; records on file. · [BOOK LINK]?utm_source=youtube&utm_medium=video&utm_campaign=3c-machine&utm_content=epNN |
| **Pinned comment** | <one line> |
```

Notes on the template:
- On-screen callouts: `> **On screen:** …`. B-roll only where it matters: `*[B-roll: …]*`.
- `[JOSH: …]` prompts inline in bold: `**[JOSH: one line on …]**`.
- Times are estimates at ~140 spoken words a minute.
- Use `—` sparingly; prefer full stops.

## Voice

Josh: direct, calm, a bit blunt, Australian, operator to operator. Short sentences. Numbers over adjectives. Says what to do and what it's worth. No hype.

## Delivery

Write your act to `youtube/3c-machine/v2/<NN-MM>.md` (create the folder if needed). Touch nothing else. Do not commit. Reply with: the five final titles, the five hook lines, the spoken word count per episode, and any `[JOSH: …]` prompts you kept or added.
