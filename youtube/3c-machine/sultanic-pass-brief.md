# Sultanic pass brief: The 3C Machine

The scripts already teach well. This pass makes them **sell** harder, using Alen Sultanic's frameworks, without losing the teaching, the facts or Josh's calm voice.

## Read first, fully

1. `~/.claude/skills/synced/*/sultanic-copy-frameworks/SKILL.md` and all four files in its `references/` (openers, body-frameworks, belief-identity-shift, closes).
2. `~/.claude/skills/synced/*/copy-sultanic/SKILL.md` (3C / Owners Academy context: the four ICPs, hooks, closes).
3. `youtube/3c-machine/source-owners-academy.md`: still the only source for facts about Josh, his deals and his proof.
4. `youtube/3c-machine/writer-brief.md`: the hard rules still apply.
5. Your act's script file.

## What to change in every episode

Rework the selling blocks. Keep the lesson block's teaching; you may tighten it and thread belief-shift lines through it.

| Script block | Sultanic tool (pick what fits the episode; vary across the act) |
|---|---|
| Cold open | One opener type: Two-Types, How Come, From-To, Secret, Saturated Mechanism, X Opener, or Chad vs James. Pick an ICP for the episode (Corporate Prisoner, Trapped Owner, One-Business Ceiling, HNW Capital Deployer) and write to them |
| The map + recipe | The 7-Minute Promise adapted to this episode ("In the next few minutes I'll show you … so you never have to … All without …") |
| Lesson | Not-Your-Fault frame once; one belief shift (What You Were Told Was Lying, Before I Knew / After I Knew, That's Not How It Works, Market Has Moved, or Proof That Changes The Story); Timeline Language ("first… then… once you have…"); assumptive statements instead of questions ("And the reason this works is…") |
| The turn | Two Paths (hard path alone vs the proven path with Josh) or the No Choice frame |
| The offer | Copy Payoff Sequence and desire layering (surface → tangible → emotional → identity) for the Academy / 1:1 call. **No price.** No Emotional Spending or BAC Pre-Close that implies a price |
| For skeptics | Complaints/Doubts in body: name the doubt, answer it as a statement |
| CTA | Identity Close ("If you're someone who…") + After Close (the 30-days-from-now frame). Optionally Threshold Moment or Permission Slip. Keep "Book a call with me. Not a setter." |

Label each reworked section with a small italic tag line above it, e.g. `*// TWO-TYPES OPENER · ICP: Corporate Prisoner*`, so Josh and the editor can see the structure. Add the ICP to the episode's Metadata.

## Do not

- Add facts, numbers, students, results, names or credentials that aren't in `source-owners-academy.md`. (The copy skill mentions Richard Alston AO; he isn't in our source, so only use him as `[JOSH: confirm Richard Alston AO can be named]`.) Keep every relationship as stated (friend ≠ student). Keep every `[JOSH: …]` prompt.
- Use fake scarcity or urgency ("closing public access", "only 3 spots", "guaranteed"), income promises, or the Jesus or Good Karma closes.
- Lose Josh's voice: direct, calm, a bit blunt, plain English. Sultanic structure, not hype. No exclamation marks.
- Break the ad-safe hook rule (no "are you…" personal call-outs, no income claim in the first line) or drop the disclaimers.
- Change the episode's title or topic, the hand-off to the next episode, the Description's source links, or the UTM link.
- Let length drift: spoken script stays 1,500–2,000 words (finales up to 2,500).

Also update each episode's Shorts / ad cut-downs so at least one uses the new opener.

## Delivery

**Step A:** rewrite the act's file in place.

**Step B:** refresh the act's Claude Docs tab so it matches the file. Load the tools with ToolSearch `select:mcp__Claude_Docs__read,mcp__Claude_Docs__update,mcp__Claude_Docs__guide`. Doc id `6a5f94be-f487-4798-8d73-2e5cd0ca715f`; your task names the tab node.

1. Read the tab: `read(ref={"object":"node","id":"<NODE>"}, engine="prose", container={"kind":"project","id":"6a5f94be-f487-4798-8d73-2e5cd0ca715f"}, payload={"projection":"outline"})`. Note its `rev` and the ids of every top-level block after the H1 title (block ids look like `mx5bta3gwca.123`; an outline prints later ids short, like `.123`, so prefix the session part of the last full id printed).
2. In one call, delete them all: `{"op":"delete","target":{"kind":"blocks","ids":[…every top-level block after the H1…]},"ifRev":<rev>}`. Keep the H1.
3. Insert the episodes one call at a time, in order: `{"op":"insert","target":{"kind":"root"},"side":"end","source":{"as":"markdown","from":{"kind":"inline","content":"<episode markdown from its ## line to before the next ##>"}}}`.

If someone edited the tab since it was filled (a `guard_mismatch`, or text in the read that isn't in the file), stop and report it instead of overwriting. On any refusal, call guide with items `["refusal.<code>"]`. Touch nothing else; do not commit.

**Reply:** one line per episode: the opener used, the ICP, and the new first line. Then list anything you couldn't do.
