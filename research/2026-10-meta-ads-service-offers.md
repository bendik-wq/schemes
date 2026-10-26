# Service offers scaling on Facebook/Instagram ads right now

Research date: 25–26 October 2026. Prepared for Bendik / Asym. The benchmark is Viral Coach.

## How this was measured

- **Source.** Pulled directly from Meta's public Ad Library with a headless browser:
  - 82 keyword searches on service-offer phrases.
  - 79 searches on funnel domains.
  - Page-level pulls for 59 advertisers.
  - Tools: `tools/adlib_sweep.cjs` and `tools/adlib_pages.cjs`. Data: `data/meta-ads-2026-10/`.
- **What "spending a lot" means here.** Meta does not publish spend for commercial ads outside the EU, so we use two proxies:
  - **Live ads:** total active ads in all countries (Meta's "~N results").
  - **Creative churn:** how many of the visible ads started in the last 30 days.
  
  Heavy spenders show both: dozens to hundreds of live ads, and new creatives every week.
- **How "new" is judged.** Pages are new when their funnel domain was registered in the last ~12 months (RDAP lookup), backed by the oldest live ad date. Meta hides page-creation dates from logged-out users.
- **Limits.** The Ad Library page shows at most ~30 cards per pull, so "oldest live ad" means the oldest of those visible cards. Live-ad totals are Meta's rounded "~" numbers.

---

## The benchmark: Viral Coach (Daniel Iles)

| | |
|---|---|
| Ad page | "Daniel Iles" (ID 265406025348448), plus a "Viral Coach" brand page |
| Live ads | **~59** |
| Creative churn | **All 28 visible ads started 12–21 Oct 2026**: the full set is refreshed every 1–2 weeks |
| Offer | Fully managed social media system: scripting, editing, posting, paid amplification. **"Guaranteed 1M views."** Claims 3,000+ clients, 250+ niches and 15.5M average views after 3 months |
| Funnel | Ads → `viralcoach.com/cpy/about-you` (qualifying form) → call |
| Vertical sub-funnels | `law.viralcoach.com` (attorneys) and `med.viralcoach.com` (doctors) |
| Age | Company 2022, domain 2019. **Not new**, but still scaling hard |

**The interesting part: client funnels on Viral Coach's own domain.** Other advertisers run ads to `*.viralcoach.com` subdomains:
- RIV AI (12 ads, all launched 22–25 Oct, selling AI automation to manufacturers)
- Key West Experts
- GBP Pro Agency
- Guymacebooks

So Viral Coach also builds and hosts paid-ad funnels for its clients. That gives it a second revenue line and a moat: the client's funnel lives on Viral Coach's domain.

**Ad angle:** "The guys spending $100,000/month on content have a team of 12 supporting them… with the right systems you can delegate your content so you just sit to film every week."

---

## New players (last ~6–12 months) that are spending heavily

Ranked by live ads and creative churn.

| # | Advertiser | Live ads | New in last 30 days (of visible) | Funnel domain registered | What they sell |
|---|---|---|---|---|---|
| 1 | **School of Mentors / School of Content** | **~350 + ~140** | School of Content: **29 of 29** | schoolofhardknocksai.com: **Apr 2026** | Done-with-you setup of "7 AI agents" that automate your content and grow Instagram/YouTube for business owners. Video → application. **Closest Viral Coach look-alike, built around AI.** |
| 2 | **AI Clipping Agency (Musa Mustafa / Crayo)** | **~360** | 20 of 26 | **Jun 2026** | **$5** "starter kit" to start a clipping agency: brands pay clippers per view through Content Rewards, and the agency takes 15–30%. "$1,000 client in 48h or refund." A business-opportunity tripwire on the clipping trend. |
| 3 | **7FigureLocal** | ~130 | 6 of 19 | **Jun 2026** | Done-for-you local SEO plus **GEO (ranking in ChatGPT)** for local businesses. "#1 on Google, Maps and ChatGPT in 90 days or money back." Book a call. |
| 4 | **Content Launch (Nathan Douglas Johnson)** | ~160 | 3 of 29 | content-launch.co: **Oct 2025** | Done-for-you content machine: "you film, we do the rest" (strategy, scripts, editing, distribution). Viral Coach clone. |
| 5 | **Blue Collar Business Accelerator** | ~130 | 6 of 30 | **Sep 2025** | Lead machine for contractors; application form. **The landing page still has placeholder text** ("blah", "social proof!!") and they are spending anyway: test fast, polish later. |
| 6 | **Mr Med Spa** | ~110 | 7 of 25 | **Mar 2026** | Patient acquisition for med spas: **"20–40 new patients every month or it's free."** Quiz → lead form. |
| 7 | **Atom Acquisition Co** | ~71 | 1 of 29 | **Nov 2025** | Done-for-you client acquisition (ads, VSL, setters, closer training) for coaches, agencies and local services. "Qualified appointments in 30 days or you pay nothing." High-end tier $30k+. |
| 8 | **Votel** | ~43 | 17 of 28 | **Aug 2025** | "Launch your own AI agency" (white-label voice AI) |
| 9 | **Leadscape Digital** | ~42 | 16 of 29 | leadsuite.agency: **Feb 2026** | Done-for-you client acquisition system for coaches and agencies; "you own it forever." Book a call. |
| 10 | **Alicia Lyttle (AI Consultants)** | ~19 | 0 of 11 | **Apr 2026** | Career pivot: "land premium AI consulting clients" |
| 11 | **Faiez Rana (Blue Collar Baller Partners)** | ~16 | 8 of 12 | **Jul 2026** | Plumbing business owners: a trained office manager placed in the business |
| 12 | **"Michael / Ella Does Social Media" (Campaign Crafters)** | ~7 + ~8 | all | brand-new persona pages, ads from 19 Oct | Done-for-you social media for local businesses run through **persona pages**: one agency, several "faces" testing the same offer |

**Newer than 18 months and at scale:**
- **Aaron Burnham / Modrn:** ~190 live ads, domain May 2025. B2B founders: "you don't have a lead problem, you have a system problem."
- **Leveraged Creator:** ~81 live ads, May 2025. AI/Claude content for creators.
- **Uare.ai:** ~84 live ads, Apr 2025. "AI digital twin" for experts.
- Smaller new content agencies: **GM Media** (~21, 17 new in 30 days), **Businessrate Media** (~16), **Reach Media** (done-for-you short-form content for restaurants), **Adley/goviralish** (~54, all launched since 16 Oct; a "double your reach" challenge).

## Established heavy spenders (benchmarks, not new)

| Advertiser | Live ads | Offer |
|---|---|---|
| Vaibhav Sisinty (Outskill/GrowthSchool) | ~1,200 | AI skills webinars |
| **Tyler Tometich (viral-strategies.com, 2023)** | **~1,100** | Go-viral / content coaching. **The biggest spender in Viral Coach's lane** |
| Alex Hormozi (Acquisition.com) | ~810 | Workshops, Skool |
| Cole Gordon (Closers.io) | ~520 | Places appointment setters/closers in coaching businesses and agencies |
| Babylovegrowth (2024) | ~240, **23/23 new in 30 days** | SEO + "rank on ChatGPT" software |
| Brook Hiddink (highticket.io) | ~160 | High-ticket workshop |
| Jeremy Miner (NEPQ) | ~160 | Sales training |
| Booming Bookkeeping | ~160 | "Bookkeeping challenge" business opportunity (advertorial-style ads) |
| Kai Bax (ScaleClients) | ~150, 26/30 new | Meta-ads client system for AI agencies; "pay in full after results" |
| StoneSystems | ~150 | Home-services growth |
| Regalis (2024) | ~120 | "Own a 6-figure business in 90 days. We do it for you." (done-for-you business ownership) |
| SMB Team | ~110 | "$100 per click on Google, $2 on ChatGPT" (ChatGPT ads agency) |
| Helen Guo (SMB Deal Hunter) | ~110 | Buying small businesses |
| Trainwell | ~100 | Producer training for P&C insurance agencies |

---

## Patterns

1. **Content-as-a-service is the hottest service lane.**
   - Players: Viral Coach, School of Mentors/Content, Content Launch, Tyler Tometich, Adley, GM Media, Businessrate, Campaign Crafters, Reach Media.
   - The promise: "you just film, we do everything else," backed by a **guarantee on views** (1M views) instead of revenue.
   - Viral Coach adds **vertical sub-funnels** (law/med).
2. **AI is the new wrapper on the same offers.** "7 AI agents run your content" (School of Mentors) and "launch an AI agency" (Votel, Kai Bax's audience, Eric Kavelaars). The underlying service hasn't changed; the angle is new.
3. **GEO ("rank in ChatGPT") went mainstream in 2026.** 7FigureLocal (new, ~130 ads), Babylovegrowth, SMB Team, UpFire, HVAC/Plumbing Webmasters and others all lead with it.
4. **"X results or it's free" guarantees in narrow verticals.** Mr Med Spa (patients), Atom (appointments), Smartcore (roofers: "only pay after you're at the kitchen table"), 7FigureLocal (rankings).
5. **Business-opportunity tripwires on platform trends.** AI Clipping Agency ($5), Votel, Booming Bookkeeping. They scale fast on cheap front-ends.
6. **Constant creative churn.** Winners launch 15–30 new ads a month: School of Content 29/29, Kai Bax 26/30, Daniel Iles 28/28 and Babylovegrowth 23/23 started in the last 30 days.
7. **Short funnels.**
   - Service offers: video → application or book a call.
   - Business opportunities: VSL → $5 tripwire.
   - Several are scaling on unfinished pages (Blue Collar Business Accelerator). Speed matters more than polish.
8. **Persona pages.** One operator runs ads from several "people" pages (Michael/Ella Does Social Media; School of Mentors + School of Content). This lets them test faces and hooks and survive ad-account bans.

## What this means for Asym

- **Strongest copy-the-model lane: done-for-you content system for professionals.**
  - This is Viral Coach's lane, with proven demand and spend.
  - Differentiate on a vertical (Norwegian professionals, or US law/med/financial advisors).
  - Use AI-agent production to deliver at lower cost, plus a delivery-based guarantee (posting volume, views campaign) instead of an outcome guarantee.
- **Copy Viral Coach's hosted-funnel trick.** Host client funnels on our own domain (`client.asym…`), so our funnel/HQ stack becomes the moat and a second revenue line. The Funnel HQ we've built already does this.
- **Bundle GEO.** "Found in ChatGPT" is the hook that's working in 2026 for local services.
- **Run 15–30 new creatives a month and use persona pages.** Budget creative production as a fixed line.
- **Compliance.**
  - "Or it's free" and view guarantees must be literal and documented.
  - Income claims in business-opportunity ads draw FTC attention (Business Opportunity Rule, earnings claims).
  - In Norway, markedsføringsloven applies to guarantees and testimonials.
