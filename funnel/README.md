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

**Before launch, do these three things:**
1. Put **Cloudflare Access** (SSO) in front of `/admin*`. The password lockout is per IP; Access is what stops a distributed attack.
2. Turn on **Turnstile** (`TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`) so scripts can't mass-create applications.
3. Lock **Twilio and ElevenLabs geo permissions** to the countries you serve and set spend limits.

Residual decisions: no SMS one-time code before AI calls (consent, caps and the number allowlist reduce wrong-number risk); one shared admin password with no audit log (Access fixes both); US territories (Puerto Rico, Guam, USVI) are not called.
