---
name: vsl-funnel-builder
description: Build a complete premium VSL funnel for an offer, end to end. Covers market and Ads Library research, the offer and pricing, a VSL script (Sultanic frameworks), an Apple-grade landing page in English and Norwegian with a multi-step application form, an optional Claude API lead magnet, thank-you pages, and deployment to Cloudflare Pages. Use when the user asks to "build a funnel", "make a VSL page", "launch this offer", "landing page for X", "VSL funnel for …", or names this skill.
---

# VSL Funnel Builder

Builds a high-ticket application funnel the way Operator was built (`claude-code-site/` in this repo is the reference implementation, live at operator-claude-code.pages.dev). Default market is premium: $10k–$100k offers, buyers with $1M+ revenue or $500k+ income.

## Inputs to confirm (ask only for what is missing)
1. **Offer**: what is sold, to whom, the outcome, the price range.
2. **Languages**: default EN + NO.
3. **Brand name** and Cloudflare project name.
4. **Proof available**: real case studies, numbers, testimonials. *Never invent any.*

## Pipeline

### 1. Research (`references/research.md`)
- Meta Ads Library via Monid (`tools/ads_scan.sh`, ~$0.00075/ad) for 3–6 queries: competitors, adjacent offers, the market's language. Look for many active variants + long run time = profitable.
- Google Trends via Monid `dataforseo /keywords/google-trends-explore` (5 keywords/call, include an anchor keyword to compare across calls).
- Teardown 1–2 reference offers (structure, guarantee, funnel, price signals).
- Save to `research/<date>-<offer>.md` with sources.

### 2. Offer and pricing (`references/offer.md`)
Value stack, price tiers (entry $3–5k → core $30k → top $60–150k), founding price, guarantee with written terms (measured on delivery/activity, never income or health outcomes), economics. Save to `offers/<offer>.md`.

### 3. VSL script
Load `sultanic-copy-frameworks` (or `copy-sultanic` for G&L/Owners Academy offers). Structure: Market Has Moved → Two Types → promise → Not Your Fault → mechanism → timeline → proof/guarantee → Identity Close → No Choice + CTA → After Close. ~9 min, plus a 90-sec ad cut. Mark screen-recording cues `[SKJERM]`. Write EN + NO in `copy/vsl-<offer>.md`.

### 4. Landing page (`references/design.md`)
Copy `claude-code-site/` as the scaffold (`build.py`, `public/assets/op.css`, `op.js`, `functions/api/*`). Edit only the `T` content dict in `build.py` and the bento UI mocks. Run `python3 build.py`.
Page order (Iles positioning, Apple execution):
hero (eyebrow, two-line headline with grey second line, one CTA + "Watch the film ›", assurance line) → product shot (the offer *shown*, e.g. a live UI) → four figures → film (black) → one big statement → system as bento → timeline in real units → two guarantees (black) → interactive proof (Claude generator) → fit + FAQ → 5-step application → closer with giant watermark number → footer with disclaimers.

### 5. Lead magnet (optional)
`functions/api/claude.js` pattern: one tool with a JSON schema, `claude-opus-5-5`, `effort: "low"`, `fallbacks: "default"`, refusal/max_tokens handling, per-IP rate limit via KV, lead forwarded to `WEBHOOK_URL`. Load `claude-api` before changing it.

### 6. Test (`references/qa.md`)
Mock Claude + webhook (`references/qa.md` has the mock), `wrangler pages dev`, Playwright: both languages, generator, full application → thank-you with booking, desktop 1280 + mobile 390 screenshots, no horizontal scroll, no console errors. Look at the screenshots before deploying.

### 7. Deploy
`npx wrangler pages project create <name> --production-branch main` then `npx wrangler pages deploy --branch main` with `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` from the user (env only, never committed). Smoke-test every URL. Tell the user which secrets to set: `ANTHROPIC_API_KEY`, `WEBHOOK_URL`, `CALENDAR_URL`.

### 8. Commit
Commit research, offer, script and site. Grep for tokens before committing.

## Hard rules
- No fabricated stats, testimonials, logos, partner badges or case studies. Leave honest placeholders ("founding cohort") until real proof exists.
- No income guarantees. Health offers: licensed partners hold clinical responsibility; no outcome promises. Finance: education, not advice.
- Trademarks (e.g. Claude, Claude Code) used descriptively with a non-affiliation line in the footer.
- Prices hidden on the page for $30k+ offers; revealed on the call.
- Design: no emoji markers, no 01/02 decoration unless it is a real sequence, no cream+serif+terracotta or neon-on-black "AI look". Default system in `references/design.md`.
