# Asymmetrical AI Solutions funnel + Funnel HQ

A high-ticket VSL funnel for **Asymmetrical AI Solutions** (Asym's eight-week, done-with-you Claude Code program for founders doing $1M+), plus **Funnel HQ**, the CRM and analytics dashboard behind it. It all runs in **one Cloudflare Worker** with a **D1** database and a 5-minute cron. There are no other servers and no client framework.

```
 Ad / video / email ─▶ /  or  /for/<industry>[/<angle>]  or  /m (Meta smart route)
                        │  film (VSL) · CTA and page unlock at the pitch
                        ▼
                     /apply   one question per screen · lead captured at step 1 · every answer saved
                        │     score 0–100 + hard caps ─▶ tier
            ┌───────────┼──────────────────┐
            ▼ A         ▼ B                ▼ C
          /book      /breakout          /resources
       (Calendly)   (video + FAQ,       (starter kit)
            │        then /book)
            ▼ verified booking (signed webhook / Calendly API)
       reminders · pre-call emails · confirm AI call · team ping
            ▼
       call ─▶ showed / no-show ─▶ won / lost ─▶ onboarding / re-engagement
```

## What is in it

| Area | Where | Notes |
|---|---|---|
| Content | `src/config.ts` | Brand, offer, headlines (A/B), landing copy, FAQs, application questions and points, tier thresholds and hard caps, routes, closers, markets, consent text, calling rules, voice prompts. |
| Pages | `public/*.html`, `src/funnel/pages.ts` | Static templates filled server-side with HTMLRewriter. The page view is written before the HTML leaves the Worker. |
| Tracking | `src/lib/identity.ts`, `src/tracking/*`, `public/assets/f.js` | First-party HttpOnly cookies, sessions, UTMs plus 11 click ids, channel grouping, VSL heartbeats, deep on-page behaviour (never field values), consent gating, Meta CAPI / GA4 / PostHog / CRM forwarding with retries. |
| Application | `src/funnel/application.ts`, `scoring.ts`, `routing.ts` | Contact first (with an unticked AI-call consent box), strict validation, the "continue your application" flow for known emails, weighted round-robin closers. |
| Booking | `src/integrations/booking.ts`, `calendly.ts` | Calendly embed with `salesforce_uuid`; the browser report is only a claim; signed webhook, API sync, history import, qualification from booking answers. |
| Email | `src/integrations/email.ts`, `sequences.ts`, `templates.ts`, `src/followup/*` | 13 sequences, 122 templates, signed redirects, open pixel, RFC 8058 one-click unsubscribe, postal address, DST-safe pre-call barrage. |
| Personalisation | `src/personalize/*` | Behaviour facts, rules mode, Claude mode (structured JSON, hard output validation, falls back to rules), 10 behaviour triggers. |
| AI calls | `src/integrations/elevenlabs*.ts`, `calling-rules.ts` | Consent per number, calling hours across every zone of the phone's country, AU holidays, caps, do-not-call re-checked at every dial, verified bookings only, inbound callback agent. |
| Sales | `src/sales/*` | Reps, outcomes with deal markers, payments ledger, Slack/Discord pings, daily digest, historical-import guard. |
| Landers | `src/landers/*` | 20 industries × 5 angles = 100 pages, Thompson-sampling bandit, smart route from ad names. |
| Funnel HQ | `/admin`, `src/routes/admin.ts`, `src/admin/*`, `public/assets/admin.*`, `funnel-map.js` | Every tab from the build spec, including the editable funnel map and the Integrations screen. |

## Revenue operations

Per-lead fields live in `lead_revops` (first ad touch, `p_win`, no-show risk, email status), not on `leads`: D1 caps a table at 100 columns and `leads` is at 94.

- **Ad spend, CAC and ROAS** (`src/integrations/meta-ads.ts`, `src/admin/spend.ts`). Set `META_ADS_TOKEN` (ads_read) and `META_AD_ACCOUNT_ID` in Integrations → Meta Ads spend. The cron pulls the last 7 days of ad-level daily Insights every hour into `ad_spend` (upsert per platform/date/ad). Other platforms: Traffic → Spend → import a CSV (`date`, `spend`, `ad_id` or `campaign`). Leads are credited to the first session that carried an `ad_id` (a trigger at insert plus an hourly backfill). Traffic → "Spend, CAC & ROAS" shows spend, CPL, cost per application/qualified/booked/show, CAC, cash and revenue ROAS by campaign, ad set and ad, and flags ads that spend with no visits. Overview adds Spend, CAC, Cash ROAS and cost per booked call with previous-period deltas.
- **Offline conversions** (`src/tracking/forward.ts`, `catalog.ts`). Show, no-show (`NoShow`), won, lost (`DealLost`), disqualified (`Disqualified`), payments (`CashCollected`, value = amount) and refunds (negative payment → `Refund`, negative value) go to Meta with `action_source: "system_generated"` and stable event ids (`won_<lead>`, `pay_<payment>`…). Retargeting: `vsl_25` → `VideoView25`, `vsl_cta_reveal` → `VSLPitchReached`, first `app_step` → `StartApplication`, with `tier` and `watched_pct`. Consent gating is unchanged. `booking_page_ready` is not forwarded: the beacon stores it local-only (`collect.ts`), see follow-ups. Values: `STAGE_VALUES` holds P(won | stage, tier) × average deal, recomputed nightly and with Tracking → Recompute; cells with fewer than 20 outcomes keep `TIER_VALUE`. Tracking also shows a stage × destination matrix.
- **Alerts** (`src/admin/alerts.ts`, System → Alerts). Every 15 minutes: traffic or film plays at zero for an hour in hours that normally have them, applications/bookings below the same 24 h of the last four weeks (Poisson, 3σ), forwarding failures > 10%, Meta email match share down > 20 pts, email failures > 10%, bounces/complaints, no Calendly activity in 3 h when bookings are expected, cron heartbeat gaps > 15 min, ads spending with no visits, CPL > 2× its 28-day level. One open alert per rule, 2 h cooldown after resolving, Slack/Discord ping on open and resolve (`ALERT_PINGS`), red bar in HQ.
- **Deliverability** (`src/integrations/resend-webhook.ts`, `email-dns.ts`). Point a Resend webhook at `/hooks/resend` and paste its `whsec_` secret as `RESEND_WEBHOOK_SECRET` (Svix signature, 5-minute window, fails closed). Hard bounces and complaints suppress the address, cancel queued email and mark the lead; complaints also unsubscribe and ping the team. Emails shows bounce and complaint rates per sequence; above 0.2% complaints or 3% bounces over 7 days (100+ sends) marketing sequences pause (`EMAIL_AUTO_PAUSE`) until you resume. Integrations → Email → Check DNS grades SPF, DKIM, DMARC and alignment over DNS-over-HTTPS.
- **No-show risk** (`src/sales/noshow.ts`). Hourly for calls in the next 72 h: rules prior (booked > 5 days ahead, no pre-call open, confirm call unanswered, < 25% of the film, personal email, tier), replaced by a logistic model shrunk to the prior once 50 calls have an outcome. Over 40% pings the team once per call. Sales → "Upcoming calls by no-show risk". Nothing is sent to the lead.
- **Scoring calibration** (`src/sales/calibration.ts`, `model.ts`). Nightly over 365 days of terminal outcomes: smoothed win rate and lift per answer, suggested points, an L2 logistic regression (answers, film share, flags) stored in `scoring_models`, `p_win` for open leads. Insights → Scoring calibration. Routing uses `config.ts` points unless the owner switches on learned points (see Sales operations below).
- **Digest v2, closer pings, weekly analyst** (`src/sales/digest.ts`, `followups.ts`, `analyst.ts`). The daily digest adds deltas vs the 7-day average, today's calls by closer with tier and risk, calls needing an outcome, overdue follow-ups and instalments, yesterday's spend/CPL and 7-day CAC, open alerts. At `CLOSER_PING_HOUR` each closer gets their follow-ups and instalments due. Mondays, with an Anthropic key and `WEEKLY_ANALYST` on, Claude reads aggregate week-over-week numbers and the result is stored in `ai_reports`, posted to Slack and shown on Insights. Sales → Send digest now.

## Sales operations (round 2)

Migrations `0018_salesops.sql` and `0019_salesops2.sql`. New per-lead fields go on `lead_revops` (`pipeline_stage`, `score_model`); `leads` is unchanged at 96 columns.

- **Users, roles, audit** (`src/admin/auth.ts`, `users.ts`, `audit.ts`, `src/routes/hq-public.ts`). Team → Users & access adds people with a role (owner, manager, closer, setter, viewer) and, for closers and setters, their rep. They sign in with a signed, single-use, 15-minute email link (rate-limited per address and IP; same answer for unknown addresses). The admin password stays as the owner's break-glass login. Sessions are `user.<exp>.<id>.<epoch>` next to the old `admin.…` format; the user row is re-read on every request, so deactivating someone signs them out. Closers and setters only reach Today, Pipeline, Leads and Sales, and only their own leads (closer or setter); viewers read but never write. Every lead change, outcome, payment, setting (key name only), team/user change, map save, merge, erase, export and sign-in lands in System → Activity log with a keyed IP hash.
- **Pipeline & forecast** (`src/sales/pipeline.ts`). Booked / Held / Verbal / Won – plan / Won – paid columns from statuses and deal fields; drag a card (or use its menu) to move it. Weighted pipeline uses P(won | stage, tier) from `STAGE_VALUES` cells with 20+ outcomes, else fixed starting values. Cash forecast for this and next month: commit, expected (held/verbal × P, booked calls × P(show) × P(close) × average deal), best case, against the sum of rep monthly targets.
- **Receivables** (`src/sales/receivables.ts`). Winning on a plan with 2+ instalments creates the schedule; payments pay the oldest pending instalment, **Mark paid** records the payment and links it, deleting a payment reopens it, a refund cancels what is left. `next_payment_at` mirrors the next instalment, so the morning closer ping and the digest list instalments with amounts.
- **Today** (`src/sales/today.ts`). Mobile-first: today's calls with prep cards (film watched, key answers, objections predicted from answers, no-show risk), A/B leads nobody has touched with a live counter, follow-ups and instalments, one-tap Call / Log touch / Log outcome / Log payment. Touches feed speed to lead (median, % within 5 minutes) and setter activity on Sales. The 15-minute call ping and a new 45-minute "needs an outcome" ping carry a signed **Log outcome** link (`/admin/o/…`, valid until 48 h after the call, only for that call). If Cloudflare Access covers `/admin*`, reps need Access too, or exclude `/admin/o/*` and `/admin/login/*`.
- **Duplicates** (`src/admin/dedupe.ts`, System → Data quality). Same phone, same browser, or same name at a company domain. Merge keeps the earlier lead, re-points every table with a `lead_id` column (read from the schema), merges answers, keeps the further stage, carries opt-outs, cancels the duplicate's emails and calls, then erases it.
- **Learned scoring** (`src/funnel/scoring.ts`). Off by default. The owner can switch routing to the active model's suggested points on Insights → Scoring calibration; only options with 20+ outcomes change, every flag and tier cap stays, and the version is stored per lead (`lead_revops.score_model`). The table is pinned until switched again.
- **Attribution & cohorts** (`src/admin/attribution.ts`). First, last non-direct, linear, position (40/20/40) and 7-day time decay over non-bot sessions before each conversion, by campaign, ad or channel, with spend ROAS; top paths; weekly/monthly cohorts (cash at d0–d180, time to close, plan collection, refunds, 90-day value). Cached 10 minutes.
- **API & webhooks** (`src/routes/v1.ts`, `src/admin/api-keys.ts`, `src/integrations/webhooks.ts`). `GET /api/v1/{leads,deals,payments,calls,metrics/daily,spend}` with `Authorization: Bearer fk_…`, scopes, `updated_since` + `cursor` paging, 120 requests a minute. Keys are shown once and stored as an HMAC. Webhook subscriptions go through `forward_log` retries, public https hosts only (and `WEBHOOK_ALLOWED_HOSTS` when set), signed `X-Funnel-Signature: t=<unix>,v1=HMAC-SHA256(secret, t + "." + body)` with `X-Funnel-Event-Id`. Set `LEAD_WEBHOOK_SECRET` to sign the CRM webhook the same way. CSV exports (owners and managers): payments, calls, emails, attribution, cohorts.

## Run it locally

```bash
cd funnel
npm install
printf 'ADMIN_PASSWORD=pick-a-long-one\nSESSION_SECRET=%s\n' "$(openssl rand -hex 32)" > .dev.vars
npm run db:migrate:local
npm run dev                          # http://127.0.0.1:8787  ·  Funnel HQ at /admin
npm run simulate -- 150              # 150 synthetic visitors through the real endpoints
curl "http://127.0.0.1:8787/__scheduled?cron=*/5+*+*+*+*"   # run the cron once
npm run check                        # typecheck + all tests
```

With no integration keys everything **simulates**: emails are marked `simulated`, AI calls are logged but never placed, nothing is forwarded. You can test every flow end to end.

## Deploy

```bash
npx wrangler d1 create operator-funnel          # copy database_id into wrangler.jsonc
npm run db:migrate:remote
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET          # openssl rand -hex 32
npm run check && npm run deploy
```

Then open `/admin` → **Integrations** and connect what you have. **Never paste API keys into a chat**; this screen is where they go. Keys set with `wrangler secret put` override the screen and show as locked.

## Going live checklist

1. **Domain.** Attach `apply.<yourdomain>` as a Worker Custom Domain and set `PUBLIC_URL`. If the domain moves to Cloudflare, snapshot the existing DNS first and recreate every record, then set the exact two nameservers Cloudflare gives you.
2. **Email.** Verify the sending domain in Resend; one merged SPF record, DKIM for every sender, DMARC `p=none` first. Set `EMAIL_FROM`, `BUSINESS_ADDRESS` (required in every email) and send a test from Integrations.
3. **Calendly.** Paste a personal access token and press **Connect**. That creates the signed webhook. Then **Import history** and **Requalify**.
4. **Meta.** Pixel id + Conversions API token; test with `META_TEST_EVENT_CODE`; optimise campaigns on `QualifiedLead` or `Schedule`. Ad URL parameters:
   `utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}&ad_id={{ad.id}}&adset_id={{adset.id}}&placement={{placement}}`
5. **Film.** Upload the VSL (MP4 or HLS on Cloudflare Stream/R2) and set `VSL_MAIN_SRC`. Set `ctaRevealAt` in `src/config.ts` to the second the offer starts.
6. **AI calls (optional).** ElevenLabs key → import your Twilio number in ElevenLabs → Voice tab → Provision → pick the number → test call. Set geo permissions and spend limits in Twilio and ElevenLabs.
7. **Protect `/admin*` with Cloudflare Access** (SSO) on top of the password.
8. **Privacy.** `/privacy` is a draft that matches the code; have a lawyer review it before launch.

## Security notes

The build went through an adversarial review: four specialist reviewers (admin auth, webhooks and public API, privacy and compliance, XSS and injection), then two skeptics who tried to break the fixes. Everything they confirmed is fixed and has a regression test in `test/security.test.ts` or `test/core.test.ts`.

- Stranger-typed text is escaped and defanged once, in the dossier, before any email, chat ping or voice prompt. The voice agent only ever gets a first name and an industry label from our own list.
- Webhooks fail closed: 501 without a secret, HMAC over the raw body, replay windows.
- Bookings matched only by an email address update fields but send nothing, call no one and report nothing to ad platforms until the lead's own browser or an admin confirms them. Side effects run exactly once.
- AI calls: consent per number, a toll-fraud allowlist (no premium, personal or Caribbean numbers), calling hours across every time zone of the phone's country (stricter windows for Canada and the UAE), do-not-call per number that survives erasure, a callback number in every call and voicemail.
- Consent: nothing reaches Meta, GA4 or PostHog in the EU/EEA/UK/Norway/Switzerland before an explicit yes; a "no" is honoured everywhere; fonts are self-hosted.
- Admin: signed revocable sessions, same-origin writes, strict CSP, per-IP lockout.
- Round-2 review (regression tests in `test/security2.test.ts`):
  - **Owner-only settings.** Every secret, every URL setting and the sender, reply-to, public URL, webhook allowlist, consent, callback number and learned-routing keys can only be changed by the owner (`isOwnerOnly` in `src/settings.ts`, enforced in `PUT /admin/api/integrations`). A manager cannot point mail, links or data somewhere else.
  - **Sign-in links** are built from the host the request reached, never from the stored `PUBLIC_URL`, so a changed setting cannot send an owner's link to another domain. Limits: 3 links per address and 10 per IP per 15 minutes; the answer is the same for addresses without access.
  - **No-JS form** (no Turnstile possible): the lead is stored unconfirmed (`nojs_unverified:<lead>` in `kv_state`). No Lead event to Meta/GA4/PostHog/CRM, no sequence, and the JSON application steps refuse it, until the person clicks the one signed confirm email (a click with user activation; scanners get a button). The 50-a-day ceiling counts only submissions that passed validation.
  - **Payments**: "mark paid" claims the instalment before recording, so a double click records one payment. Instalments are paid by running balance: one is paid only when the cash covers it in full; partial payments carry forward; deleting a payment un-pays what it no longer covers.
  - **Merge** moves referral credit to the surviving lead and restarts the reminders and confirm call when the duplicate held the live booking (no second Schedule event).
  - **Erasure** clears the before/after detail of that lead's audit rows (the action, who and when stay) and posts `lead_erased` (id and ref only) to the CRM webhook and to every active webhook subscription, whatever events it picked. Audit detail older than 13 months is cleared by the daily purge, as are stale sign-in nonces, MX verdicts, no-show and hot-partial marks.
  - Outbound webhook and CRM posts never follow redirects (a 3xx is a failed delivery). `/api/v1/metrics/daily` allows 10 calls a minute per key and at most 31 days per call. Signed proof-request links are shown to owners and managers only.
  - **One-tap outcome links** in the Slack/Discord call pings are bearer links: anyone who can read the channel can log that call's outcome until 48 hours after the call (or until it moves). Keep those channels private to the sales team.

**Before launch, do these three things:**
1. Put **Cloudflare Access** (SSO) in front of `/admin*`. The password lockout is per IP; Access is what stops a distributed attack.
2. Turn on **Turnstile** (`TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`) so scripts can't mass-create applications.
3. Lock **Twilio and ElevenLabs geo permissions** to the countries you serve and set spend limits.

Residual decisions: no SMS one-time code before AI calls (consent, caps and the number allowlist reduce wrong-number risk); one shared admin password with no audit log (Access fixes both); US territories (Puerto Rico, Guam, USVI) are not called.
