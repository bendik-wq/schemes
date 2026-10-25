# 20 more offers that can carry $30–50k (deep research round 2, incl. Norway)

Research date: 25 October 2026. Prepared for Bendik / Asym.

## Method and limits

- **How it was researched:** seven parallel research tracks, each excluding every idea in the three earlier reports. The tracks were:
  - healthcare reimbursement
  - professional practices
  - industrial/energy/defense
  - credits and incentives
  - vertical AI
  - Norway regulation
  - Norway market gaps
- **The test:** the same as `2026-10-high-ticket-30-50k.md`:
  1. The buyer already has money.
  2. Year-1 value is ≥5–10× the fee, with the math shown.
  3. A comparable price exists.
  4. There is a reason to buy now.
- **Estimates and sources:** figures marked **(est.)** are our assumptions. Everything else links to a source. Where a track's search budget ran out, the claim is flagged "unverified".
- **Compliance rules for every offer:**
  - Flat fees only, never per lead, per patient, per sale or a % of credits.
  - Guarantees cover delivery and activity, never outcomes.
  - Licensed partners do the regulated work.
  - TCPA/consent for SMS and calls (markedsføringsloven §15 in Norway).

## Ranking at a glance

| # | Offer | Buyer | Price | Year-1 value (est.) | Verdict |
|---|---|---|---|---|---|
| 1 | Peak Tag Shield | 5 MW+ power users in PJM/ERCOT | $35k | $190–265k | Easy |
| 2 | Breakaway RIA Liftout Launch OS | Advisor teams leaving wirehouses | $40–50k | ~$230k rev, ~$670k EV | Easy |
| 3 | Freight Ops Copilot | Freight brokers ($15–150M gross) | $40k | ~$670k (labor alone ~$245k) | Easy |
| 4 | AI Order Desk | Wholesale distributors ($10–200M) | $35–45k | ~$340k | Easy |
| 5 | Crew Engine | Electrical contractors on data-center builds | $40k | $250k–1.2M | Easy |
| 6 | 45Z Grower Enrollment Engine | Ethanol/biofuel plants | $45k | ~$775k plant share | Easy |
| 7 | BEAD Take-Rate Engine | 519 broadband subgrantees | $40k | ~$444k recurring | Easy |
| 8 | RDN Program-in-a-Box | Hospitals doing renal denervation | $40k | ~$545k revenue | Easy |
| 9 | Discovery Day Engine (franchise sales) | Franchisors with 5–25 units | $35–45k | ~$400k | Easy |
| 10 | In-House Care Mgmt Conversion | Practices with outsourced RPM | $35–45k | $260–300k protected | Easy if rule finalised |
| 11 | 100-Day AI EBITDA Sprint | PE operating partners | $45k/co | ~$2.5M EV per workflow | Easy after 1 case study |
| 12 | Niche Commercial Growth Engine | Insurance agencies preparing to sell | $45k | $135k rev, ~$940k EV | Strong |
| 13 | "2028 Ready" Practice Engine | Elder-law / estate firms | $35k | ~$420k | Strong |
| 14 | Submission Triage Sprint | MGAs / program administrators | $45–50k | ~$835k | Medium-easy |
| 15 | Dual-Use Capture OS | Drone/counter-drone/defense tech | $45k | $60–75k saved + awards | Medium |
| 16 | First-Year Credit Lease-Up | LIHTC developers | $40k | $250–330k | Medium |
| 17 | 🇳🇴 Rekrutteringsmotor Helse | Municipalities (nursing) | NOK 420k | NOK 2.1–4.2M | **Easy** |
| 18 | 🇳🇴 Forsvarsleverandør-motoren | Industrial SMEs entering defence | NOK 380k | NOK 1–3.5M | Go |
| 19 | 🇳🇴 Næringsmotor elektro/sol | Electricians / solar installers | NOK 350k | ~NOK 2.1M | Go |
| 20 | 🇳🇴 Energiløft (Enova) | Commercial property owners | NOK 400k | ~NOK 2.1M | Go |

Five more Norway market-gap offers (N1–N5), led by «Salgsklar Installatør», follow the regulation section.

---

## 1. Peak Tag Shield: capacity-charge cutting for PJM/ERCOT users — $35k (+$2.5–4k/mo in peak season)

**Why now**
- PJM capacity has cleared at the cap three auctions running: $329.17/MW-day (2026/27), $333.44 (2027/28) and $325 (2028/29). Uncapped, 2028/29 would have cleared at $554.72. [Enel](https://www.enelnorthamerica.com/insights/blogs/pjm-2028-2029-capacity-auction-results), [Modo](https://modoenergy.com/research/en/pjm-capacity-auction-2028-2029-reliability-price-cap-elcc)
- A customer's capacity tag is set by its load in PJM's 5 summer peak hours ([PJM M19](https://www.pjm.com/-/media/DotCom/documents/manuals/m19.pdf)). The summer 2027 peaks set the 2028/29 bill, so the system has to be live by **1 June 2027**.
- NIH cut its tag ~25% and avoided >$1.5M with a peak-prediction program. [NIH ORF bulletin, May 2026](https://orf.od.nih.gov/TechnicalResources/Documents/Technical%20Bulletins/26TB/PJM%20Five%20Coincident%20Peaks%20%285CP%29%20and%20Capacity%20Charges%20-%20A%20Data%20Science%20Approach%20-%20May%202026%20TB_508.pdf)

**Buyer value:** 8 MW tag × 20% cut × $325 × 365 = **$189.8k/yr** (calc). Demand-response revenue comes on top. That is 5.4–7.6× the fee. Qualify that the customer's retail contract passes capacity costs through.

**What we build**
- Interval-data pipeline and a 5CP/4CP exposure model.
- Peak-day predictor (PJM forecast + weather).
- Shed playbook, plus SMS/Slack alerts and an executive dashboard.
- Demand-response enrollment via a curtailment service provider partner (CPower/Voltus/Enel).

**Guarantee:** the back-test flags at least 4 of 5 peaks per year (2023–26) and alerts are live before 1 June, or we keep working free / refund 50%.

**Hook:** "Five hours next summer set your 2028 power bill at a record capacity price."

## 2. Breakaway RIA "Liftout Launch OS" — $40k ($50k for $1B+ teams)

**Why now**
- Wirehouses lost a net 517 advisors in H1 2026 (more than all of 2025). 41 $500M+ teams and 20 $1B+ teams left. [WealthManagement, 8 Oct 2026](https://www.wealthmanagement.com/wirehouse-news/wirehouses-lost-517-advisors-in-first-half-of-2026)
- RIA M&A hit a record 322 deals in 2025, at a median 11.6× EBITDA. [AdvisorHub](https://www.advisorhub.com/ria-ma-hit-a-record-in-2025-as-firms-with-nearly-800-bln-aum-changed-hands/)

**Buyer value (est.):**
- Retention from 86% → 92% on a $318M book ≈ $152k/yr, plus ~$80k from new households ≈ **$230k recurring**.
- At a 25% margin that is ~$58k EBITDA × 11.6 ≈ **$670k of enterprise value**.

**Anchors:** transition consultants charge $25–150k flat; RIA launch programs $50–200k. [FastTrackr](https://fasttrackr.ai/blog/fee-structures-transition-consultants-charge-and-benchmarks), [WealthManagement](https://www.wealthmanagement.com/ria-news/boutique-consultancy-adds-to-ria-launch-options-for-breakaways)

**What we build**
- Brand and site with Marketing-Rule-reviewed pages.
- CRM household-transition tracker, holding only data the Broker Protocol allows.
- Day-0 call board and repapering/NIGO dashboard.
- Announcement sequence, COI/referral engine and a 90-day new-household webinar funnel.

**Sell through:** transition consultants, recruiters, RIA attorneys, custodian transition teams.

**Compliance:** SEC Marketing Rule, books-and-records archiving, Reg S-P; the CCO signs off; no client lists outside the Protocol.

## 3. Freight Ops Copilot for brokers — $40k (+$3–5k/mo)

**Why now**
- Broker margins are compressing: J.B. Hunt brokerage went 15.5% → 12.5%. [ARK TMS](https://arktms.com/blog/freight-broker-margin-compression-purchased-transportation-costs-2026)
- Cargo theft hit ~$725M (+60%). [Insurance Business](https://www.insurancebusinessmag.com/us/news/breaking-news/cargo-theft-at-record-highs-what-brokers-need-to-know-546996.aspx)
- HappyRobot was valued at $1.2B and serves 8 of the top 10 brokers ([Fortune](https://fortune.com/2026/08/04/happyrobot-worth-1-2-billion-founder-says-just-getting-started/)), which leaves mid-size brokers unserved.

**Buyers:** 25,081 active broker authorities ([Draylo](https://draylo.us/data/freight-brokers)); ~955 with $10–200M revenue.

**Buyer value (est., $30M gross broker):** labor ~$245k + one theft avoided ~$274k + 0.5 pt margin ~$150k.

**What we build**
- Quote/order email parser into the TMS.
- Track-and-trace agent working over SMS/email.
- Carrier-vetting gate (authority age, insurance, double-brokering flags).
- Margin dashboard.

**Guarantee:** ≥60% of quote/order emails and check-calls handled touchless by day 45, or we work free / waive the final 25%.

**Hook:** "Send 500 of last month's load emails; in 72 hours we show the touches we remove."

**Window:** 12–24 months, before TMS vendors ship native agents.

## 4. AI Order Desk for distributors — $35–45k (+$3–4k/mo)

**Why now**
- VC money is proving the category: Canals ($35M), Augment ($85M), Didero ($30M), Rundoo ($30M). [Distribution Strategy](https://distributionstrategy.com/2026/09/ai-moves-into-the-distributor-order-desk-as-new-tools-target-manual-work/)
- 93% of distributors call AI a priority, but only 16% have it in production. 68% cite integration as a top barrier ([MDM](https://www.mdm.com/news/featured/featured-blog/last-call-help-benchmark-ai-adoption-across-distribution/)). Integration is our edge.

**Buyer value (est., $50M distributor):** 70% of 13.3k order-entry hours automated ≈ 4.5 FTE ≈ $290k, plus quote follow-up lift ≈ **$340k+**.

**Guarantee:** ≥70% of orders drafted touchless at ≥95% line accuracy on a 500-order test set by day 45.

**Upsell:** an AR "Cash Desk" for +$35k (6 fewer days of DSO frees ~$822k of cash at a $50M distributor).

**Sell through:** buying groups (AD, IDEA) and ERP resellers.

## 5. Crew Engine: owned electrician recruiting for data-center contractors — $40k (+$4–6k/mo)

**Why now**
- Electrical is 45–70% of data-center construction cost, and ABC says construction needs 349k net new workers in 2026 ([build.inc](https://build.inc/insights/data-center-construction-labor-shortage-2026)).
- ENR Top 600 specialty revenue is up 14.7% on AI work ([ENR](https://www.enr.com/articles/64024-enr-top-600-ai-boom-tests-talent-pipelines)).
- Staffing agencies mark labor up 20–75% ([Rinvio](https://www.rinvio.com/blog/data-center-electrician-crew-cost-benchmark)).

**Buyer value (calc):**
- 15 electricians moved off agency ≈ $250k/yr.
- 10 unfilled seats filled for 6 months ≈ $1.17M gross profit.

**What we build:** traveler employer brand and video ads, a 3-minute mobile application with license upload, AI SMS/voice screening, ATS/bench CRM, per-diem calculator and referral engine.

**Note:** lead with open-shop (ABC/IEC) contractors, because IBEW referral-hall rules limit union contractors. Meta's employment ad category applies.

## 6. 45Z Grower Enrollment & Chain-of-Custody Engine — $45k (+$5k/mo in season)

**Why now**
- OBBBA extended 45Z through 2029 (North American feedstock only).
- USDA's farm carbon-intensity (CI) rules took effect 29 Jul 2026.
- IRS Notice 2026-53 (8 Sep 2026) lets plants use the USDA FD-CIC farm-practice calculator for 2025–26 fuel. [Holland & Knight](https://www.hklaw.com/en/insights/publications/2026/09/section-45z-2026-emissions-rate-table)

**Buyers:** 189–198 ethanol plants ([EIA](https://www.eia.gov/biofuels/capacity/)), plus biodiesel/renewable diesel plants.

**Buyer value:**
- Each CI point ≈ 2¢/gal. Cover-crop corn is worth up to $98.80/acre ([farmdoc](https://farmdocdaily.illinois.edu/2026/07/the-clean-fuel-production-tax-credit-45z-part-3-reviewing-the-potential-value.html)).
- Average plant (est.): 10% of ~157k sourcing acres enrolled ≈ $1.55M/yr credit value, ~$775k kept by the plant after grower premiums.

**What we build:** county/elevator grower funnels, a practice-record portal, premium contract e-sign, scale-ticket linkage, a verifier data room and a dashboard of CI points and dollars.

**Partners:** CI modeler, third-party verifier, and the plant's CPA (who signs the claim).

**Hook:** "Every CI point is ~$1.9M/yr on your plant. Enroll growers before 2027 seed orders close."

## 7. BEAD Pre-Sell & Take-Rate System — $40k (+$4–6k/mo through build)

**Why now**
- All 56 BEAD final proposals were approved by 26 Aug 2026 ([NTIA](https://www.ntia.gov/press-release/2026/closing-digital-divide-once-and-all-ntia-announces-all-56-bead-final-proposals-now-approved)).
- That covers 519 subgrantees and 3.86M locations, with construction running 2026–30.
- 127 of these providers are growing their footprint by ≥10% ([Broadband Expanded](https://broadbandexpanded.com/posts/beadfccprovidermatch)).

**Buyer value:**
- NRTC benchmarks: ARPU $74/mo, CAC $135, lifetime value ~$5k ([Telecompetitor](https://www.telecompetitor.com/report-average-rural-broadband-customer-lifetime-value-is/)).
- 10k passings × +5 pts take rate = 500 subs ≈ **$444k/yr** recurring.

**What we build:** address-level pre-registration tied to the build map, ads only to serviceable addresses, construction-timed nurture, door-knock routing and order handoff into billing.

**Hook:** "BEAD pays for the network, not the customers."

## 8. RDN Program-in-a-Box (renal denervation) — $40k (+$4–6k/mo)

**Why now**
- The CMS national coverage decision (NCD 20.40) took effect 6 Apr 2026 ([CMS](https://www.cms.gov/medicare-coverage-database/view/ncd.aspx?NCDId=382)). Medtronic's Symplicity is at a $100M run rate, and weekly procedures more than doubled after the NCD.
- The NCD requires a hypertension program with a navigator. Patients need ≥6 weeks on maximally tolerated meds, secondary-hypertension screening and ≥6 months with ≥3 encounters. That makes the bottleneck a systems problem.
- The device pass-through payment runs out around end of 2027.

**Buyer value:** ~$21.8k per Medicare case (APC 5192 $5,815 + pass-through). 25 extra cases ≈ $545k of revenue (not margin; the hospital models the margin).

**What we build:** EHR search under a BAA, a navigator CRM tracking the NCD checklist, a home/ambulatory BP workflow, a closed-loop PCP referral portal, a registry export and on-label education pages.

**Compliance:** Anti-Kickback Statute (flat fee, nothing per case, manufacturers must not fund the fee), HIPAA marketing rules, on-label claims only.

## 9. Discovery Day Engine for emerging franchisors — $35–45k (+$4–7k/mo)

**Why now**
- About 430 new franchise brands launch a year ([FRANdata](https://frandata.com/experts/paul-wilbur-chief-operating-officer-frandata/)).
- Cost per franchise sold is $15.7–25.1k ([2026 Franchise Development Report](https://www.franchising.com/articles/20260923_tracking_average_costs_per_lead_and_costs_per_sale.html)).
- The FTC fined Xponential **$17M** in Mar 2026 over Franchise Rule failures ([Alston](https://www.alston.com/en/insights/publications/2026/03/ftc-xponential-fitness-settlement-franchise-rule)), so compliant funnels now matter.

**Buyer value (est.):** 6 direct units × $45k fee + ~$135k of broker commissions avoided ≈ **$400k**, plus royalties.

**What we build**
- Candidate funnel with liquidity/net-worth scoring.
- Logging of FDD delivery and the Item 23 receipt, with an automatic 14-day hold.
- Registration-state gating (CA, IL, MD, MN, NY, VA, WA…).
- Guardrails so no earnings claim goes beyond Item 19.
- Validation-call scheduler and a cost-per-sale dashboard.

**Compliance:** we never "sell" franchises. No per-unit commission and no prospect conversations, because of franchise-seller registration rules.

## 10. In-House Care Management Conversion (RPM) — $35–45k

**Why now**
- The CY2027 physician fee schedule proposal would pay remote patient monitoring (RPM) only when staff are **employed** by the practice, starting 1 Jan 2027. Outsourced vendor nurses would stop being billable. [CMS fact sheet](https://www.cms.gov/newsroom/fact-sheets/calendar-year-cy-2027-medicare-physician-fee-schedule-proposed-rule), [Benesch](https://www.beneschlaw.com/insight/cms-proposes-sweeping-restrictions-on-remote-patient-monitoring-the-outsourcing-ban-reimbursement-revaluation-and-potential-code-consolidation-in-the-cy-2027-physician-fee-schedule-proposed-rule/)
- The final rule is due around 1 Nov 2026. **Re-verify before selling.**

**Buyers:** 4,639 practices billed RPM routinely in 2024.

**Buyer value:** 300 patients × $103.88/mo ≈ $374k/yr at risk. Even after cuts, ~$260–300k is protected. Upside from the new primary-care management codes (APCM G0557/G0558).

**What we build:** AI triage of device readings so one employed medical assistant covers a large panel, consent and initiating-visit flow, time logging per code, and a billing-audit dashboard.

## 11. 100-Day AI EBITDA Sprint, sold through PE operating partners — $45k per company (3 for $120k)

**Why now**
- There are 13,509 PE-backed US companies.
- About 90% of portfolio-company AI pilots never reach production (Accenture). [FTI 2026](https://www.fticonsulting.com/insights/reports/2026-private-equity-ai-radar)
- AI roll-ups (General Catalyst, Thrive's Current) prove the thesis.

**Anchor:** published PE AI sprints run around $30k for discovery alone ([WorkWise](https://workwisesolutions.org/guides/ai-readiness-assessment-providers-private-equity.html)).

**Buyer value (est.):** one workflow (offers 3/4/14) worth $250k of EBITDA × 10 ≈ $2.5M of enterprise value.

**Path:** this is the channel for scaling offers 3, 4 and 14 once there is one case study.

## 12. Niche Commercial Growth Engine for insurance agencies — $45k (+$5–8k/mo)

**Why now**
- Soft-market growth is slowing, from 8.7–11.3% to 6.2–10.2% ([Big I/Reagan](https://www.independentagent.com/news/big-i-and-reagan-consulting-release-2026-best-practices-study-update/)).
- MarshBerry Q2 2026 multiples: 14.22× for high performers vs 11.57× for the rest.
- There were 439 deals in Q1–Q3 2026, 76% by PE buyers.

**Buyers:** ~37,000 agencies ([Insurance Journal](https://www.insurancejournal.com/news/national/2026/09/24/886639.htm)).

**Buyer value (est.):** $1M of new niche premium ≈ $135k of commission, $81k EBITDA × 11.57 ≈ **$940k EV**.

**What we build:** niche landers, quote intake, AMS integration, X-date capture, ACORD pre-fill reviewed by licensed staff, and an organic-growth dashboard laid out the way buyers run diligence.

**Weakness:** no published consultant price anchor; sell on the gap in sale multiples.

## 13. "2028 Ready" elder-law / estate practice engine — $35k

**Why now**
- OBBBA caps Medicaid long-term-care home equity at **$1M from Jan 2028** (not indexed) ([Justice in Aging](https://justiceinaging.org/hr1-imposes-new-limit-on-home-equity-for-medicaid-ltss-effective-2028/)).
- The estate tax exemption is now a permanent $15M, so every plan built around the expected sunset needs review.
- A nursing-home room runs $129.6k/yr ([CareScout](https://www.businesswire.com/news/home/20260302283881/en/CareScout-Releases-2025-Cost-of-Care-Survey-Results)).

**Buyer value (est.):** 2 workshops/mo × 25 attendees × 15% × $5k ≈ $420k/yr.

**Compliance:** ABA Model Rules 7.1–7.3 and 5.4 (flat fee, no referral pay). Never say "protect/hide assets".

## 14. Submission Triage Sprint for MGAs — $45–50k

**Why now**
- US MGA premium was ~$128B in 2025, with statutory growth +12% ([Conning](https://www.reinsurancene.ws/conning-estimates-us-mga-premiums-reached-128bn-in-2025/)).
- The NAIC model AI bulletin has been adopted in ~25 states, so governance logs are needed.

**Buyers:** ~440 MGAs plus ~1,150 program administrators.

**Buyer value (est.):** 31 min saved × 15k submissions ≈ $385k, plus better hit ratio. FurtherAI (a vendor) reports 32 → 1 min per submission ([FurtherAI](https://www.furtherai.com/customers/submissions-processing-ai)).

**Needs:** SOC 2 Type I, or a partner who has it; GLBA. Security reviews add 2–4 weeks.

## 15. Dual-Use Capture OS for drone / counter-drone / defense-tech firms — $45k (+$5–8k/mo)

**Why now**
- The FY27 request includes >$74B for drones and counter-drone ([DefenseScoop](https://defensescoop.com/2026/04/21/dod-plans-largest-ever-investment-drones-anti-drone-weapons/)).
- The Blue UAS list moved to DCMA. A full-system assessment costs ~$80k vs $5–20k per component ([DCMA](https://www.dcma.mil/bluelist/)).
- SBIR/STTR was reauthorized to 2031 with per-firm caps, which rewards better capture work over more proposals.
- **EEA angle:** EU SAFE €150B loans; Norway counts as an eligible source.

**What we build:** registration hygiene (SAM/CAGE/DSBS), an opportunity radar (SAM, DIU CSOs, SBIR, Drone Dominance, SAFE), a capture CRM, a Blue List component dossier and 2 proposal packages written with the client's technical staff.

**Compliance:**
- FAR 52.203-5 means flat fees only.
- No ITAR technical data goes to non-US persons.
- We make no government contacts on the client's behalf (Lobbying Disclosure Act risk).

## 16. First-Year Credit Lease-Up Engine for LIHTC developers — $40k per property

**Why now:** OBBBA raised 9% LIHTC allocations by 12% and cut the 4% bond test to 25% ([Novogradac](https://www.novoco.com/notes-from-novogradac/final-reconciliation-bill-permanently-expands-lihtc-nmtc-and-oz-incentive-but-does-not-include-htc-provisions)). Slow first-year lease-up pushes credits to year 11 and triggers investor equity adjusters.

**Buyer value (est., 80 units, $1.2M/yr credits):** 2 months faster lease-up ≈ $168k of equity protected + rent ≈ $250–330k.

**What we build:** an Affirmative Fair Housing Marketing–compliant funnel, AI pre-screening against HUD income limits, a 120-day document tracker, and tenant income certification files prepared for a certified compliance specialist.

**Slower sale:** few buyers, long cycles.

---

## 🇳🇴 Norway: regulation-driven offers

**The key unlock:** from **1 July 2026**, the direct-purchase threshold in public procurement rose from NOK 100k to **NOK 500k** ex. VAT, including defence ([Regjeringen](https://www.regjeringen.no/no/aktuelt/endringene-i-anskaffelsesloven-trer-i-kraft-skal-gjore-innkjop-enklere/id3167974/), [Anbud365](https://www.anbud365.no/regelverk/na-endres-anskaffelsesreglene-dette-ma-offentlige-oppdragsgivere-fa-med-seg/226248)).
- A NOK 300–450k package **including** the retainer can be bought by a municipality without a tender.
- The value counts options and all payments, and splitting a contract to get under the threshold is prohibited.

### 17. Rekrutteringsmotor Helse (health & care recruitment engine) — NOK 420k all-in incl. 12 months' operation

**Why now**
- Municipalities still spent ~NOK 1.55bn on agency nurses in 2025 ([Sykepleien](https://sykepleien.no/vikarregningen-falt-med-30-prosent-men-knapt-okning-i-sykepleierarsverk)).
- An agency nurse costs NOK 999/hour vs NOK 564/hour employed ([Fafo 2023:17](https://www.fafo.no/images/pub/2023/20852.pdf)).

**Buyers:** ~241 of 357 municipalities buy agency nurses, plus 15 counties and the health trusts.

**Buyer value:** each agency FTE replaced saves ≈ NOK 0.7M/yr. 3–6 FTE ≈ NOK 2.1–4.2M (5–10×).

**What we build:** employer-brand landers per unit, campaigns aimed at nurses/students/part-timers, an applicant CRM with AI pre-screening and booking, a student talent pool, and a dashboard of vacancies, hires and agency hours avoided.

**Compliance:** data processing agreement and DPIA; a human makes every hire decision; offentleglova (public records).

**Hook:** «Hver vikarvakt koster dere ~4 500 kr ekstra. Vi bygger en rekrutteringsmotor under 500 000-grensen – ingen anbud nødvendig.»

### 18. Forsvarsleverandør-motoren (defence supplier engine) — NOK 380k + NOK 15k/mo

**Why now**
- The long-term defence plan frame is NOK 1,848bn (2025–2036) ([Stortinget Innst. 440 S](https://www.stortinget.no/no/Saker-og-publikasjoner/Publikasjoner/Innstillinger/Stortinget/2025-2026/inns-202526-440s/?all=true)).
- NOK 516M for production capacity in 2027 ([Regjeringen](https://www.regjeringen.no/no/aktuelt/oker-produksjonskapasiteten-i-norsk-forsvarsindustri/id3174290/)).
- FSi (the defence industry association) added 74 members in a year, and 95% of members are SMEs ([FSi](https://www.fsi.no/nyhetsartikler/blank/)).

**Buyers:** 1,350 + 560 + 327 manufacturing establishments with 20–249 staff (SSB).

**Buyer value (est.):** one or two NOK 2–5M subcontracts ≈ NOK 1–3.5M contribution margin.

**What we build:** an English capability site, a qualification file, AI tender monitoring (Doffin/TED/NSPA), outreach to primes (Kongsberg, Nammo, NFM) and EDF consortium matchmaking.

**Compliance:** no classified material; check export control first.

### 19. Næringsmotor for elektro/sol (commercial pipeline engine for electricians and solar installers) — NOK 350k + NOK 20k/mo

**Why now**
- Household solar orders collapsed after Norgespris ([NRK](https://www.nrk.no/sorlandet/dramatisk-fall-i-bestillinger-av-solceller-etter-at-norgespris-ble-lansert-1.17592331)).
- Businesses get **no** Norgespris support.
- Enova covers 25% of commercial building energy upgrades, up to NOK 10M per project ([Enova](https://enova.no/nb/bedrift/bygg-og-eiendom/stottetilbud-innen-bygg-og-eiendom/stotte-til-forbedring-av-energitilstand-i-yrkesbygg)).

**Buyer value (est.):** 10 commercial projects × NOK 0.85M × 25% margin ≈ NOK 2.1M.

**Hook:** «Privatmarkedet stoppet med Norgespris – næringskundene får null strømstøtte og 25 % fra Enova.»

### 20. Energiløft (energy upgrade programme) for commercial property owners — NOK 400k

**Why now:** Enova pre-project support covers 50% of external costs, max NOK 300k. It requires a 2026+ energy certificate rated C–G. Next deadline **1 Dec 2026** ([Enova](https://enova.no/nb/bedrift/bygg-og-eiendom/stottetilbud-innen-bygg-og-eiendom/forprosjektstotte-til-energieffektivisering-i-yrkesbygg)). Investment support of 25% follows.

**Buyer value (est.):** a NOK 6M upgrade → ~NOK 1.5M Enova + 0.3M pre-project grant + ~0.3M/yr savings.

**How it is delivered:** we run the programme, data and application; an independent engineering partner does the study.

**Note:** keep this separate from #19 so the product-independence rule is not breached.

### Norway: watch list and rejects

- **Klientmotor 2030 (client engine for accounting firms), NOK 300k — conditional.** E-invoicing regulation FOR-2026-09-29-1933 sets the dates: send e-invoices 1 Jan 2027, buyer org. no. 2028, receive e-invoices and digital bookkeeping 2030 ([Lovdata](https://lovdata.no/dokument/SF/forskrift/2026-09-29-1933)). The ticket is lower and Tripletex/Fiken compete.
- **KI-byggesaksassistent (AI building-permit assistant) — pilot only.** Municipalities refund 25% of the permit fee per started week late ([byggesaksforskriften §7-6](https://lovdata.no/forskrift/2010-03-26-488/§7-6)).
- **Rejected:**
  - NIS2 and the pay transparency directive: not in the EEA Agreement yet.
  - Åpenhetsloven: fines too small.
  - GP crisis: easing.
  - Dental reform: no date yet.
  - Wealth-tax exits: no change in the 2027 budget.
- **Skattefunn:** the 2027 budget proposes covering only costs incurred after approval. Apply before starting AI R&D projects.

---

## 🇳🇴 Norway: market-gap offers (models proven in the US or Sweden, not yet common in Norway)

Data comes mostly from primary APIs: SSB Statbank and Brreg Enhetsregisteret (SN2025 industry codes, counting active firms only). Google Trends for Norway returned 429 throughout.

**Why automation pays more in Norway:** labour costs NOK 622 per hour actually worked across the economy (SSB 07685, 2024). By sector: construction 510, admin 480, professional services 749, health 650. Each automated hour is worth 2–3× what it is in the US.

### N1. «Salgsklar Installatør» (PE-ready build for installers): NOK 450k + NOK 25k/mo. **Strongest, build first.**
- **Evidence:**
  - BDO counted a record 928 Norwegian deals in 2025. 344 were PE deals, and **245 of those were roll-ups**.
  - BDO names electrical, plumbing, VVS (HVAC/plumbing) and consulting engineering as the sectors being rolled up ([BDO](https://www.bdo.no/nb-no/nyheter/2026/rekordaar-for-oppkjop-i-norge-i-2025)).
  - Active buyers include Nimlas, Elscoop, Konstel and Tekni.
- **Buyers (Brreg, firms with ≥5 employees):** electrical 1,375, plumbing 922, cooling/heat pump 155. Filter for owners aged 55+ using the Brreg roles API.
- **Value (est.):**
  - 250 service agreements × NOK 3.5k = NOK 875k recurring revenue.
  - 0.5 admin FTE freed ≈ NOK 370k.
  - NOK 500k more EBITDA × 4–8 ≈ NOK 2–4M more sale value.
- **What we build:** CRM and field-service integration, a service-agreement funnel with Vipps recurring billing, our own lead engine (so they stop buying from Mittanbud), an AI phone/SMS assistant, an owner KPI dashboard and a data-room kit.
- **Hook:** «Fondene kjøpte 245 bedrifter i fjor. Blir din kjøpt – eller kjøpt billig?»
- **Partners:** M&A boutiques, Nelfo/EFO, Rørentreprenørene Norge.

### N2. «Klinikk-autopilot» (AI front desk + recall for private clinics): NOK 320k + NOK 12–15k/mo
- **Buyers (Brreg, ≥5 employees):** dentists 502, vets 240, specialist doctors 220.
- **Value (est.):** 0.5 receptionist FTE ≈ NOK 400–480k, plus recall and no-show revenue.
- **What we build:** a Norwegian voice/chat agent, SMS recall, a review engine and local ads.
- **Compliance:** health data under GDPR Art. 9, the Normen security standard, hosting in the EU/EEA, and administrative triage only (no clinical advice). This price is below the NOK 300–500k range for the larger offers, but it is easy to productise.

### N3. «Hytte-salgsmotor» (sales engine for cabin builders): NOK 380k + NOK 30k/mo
- **Evidence:**
  - Cabin start permits fell **−68%** from 2021 to 2025 (8,762 → 2,824, SSB 06952).
  - Second-hand cabin sales recovered to 11,358 in 2025, at an average NOK 2.72M (SSB 11694).
  - Demand is waiting, not gone.
- **Value (est.):** each extra NOK 4–6M cabin sold ≈ NOK 0.6–1.2M contribution, so two sales pay the fee.
- **What we build:** configurator pages, a financing calculator (no promised returns), Finn/Meta/YouTube ads, an 18-month nurture sequence, BankID reservations and a CRM.

### N4. «Forsvarsløftet» (defence / offshore-wind diversification ABM for oil-service suppliers): NOK 480k
- **Buyers:** ~1,200 oil-service, steel, shipyard and engineering firms with ≥10 employees (Brreg).
- **Offer:** merge this with #18. Position: «Fra olje til forsvar på 90 dager.»

### N5. «AI-drevet regnskapsbyrå» (AI-driven accounting firm): NOK 420k
- **Buyers:** 846 accounting firms with ≥5 employees (Brreg 69.202).
- **Value (est.):** automating 15% of 16k hours = 2,400 h × NOK 749 ≈ NOK 1.8M of capacity freed.
- **Fit:** bundle with Klientmotor 2030 (e-invoicing deadlines) and the sale-readiness logic from N1.

### Run-it-yourself businesses (not agency offers)
- **Seniorflytt (senior move management):**
  - The 80+ population grows **+22% by 2030** and +62% by 2040 (SSB 14740).
  - The US has an established trade association (NASMM); we found no Norwegian equivalent.
  - NOK 40–80k per downsizing. Test with a NOK 30k ad budget in Oslo/Bærum.
- **Hyttevert/Hytteservice (cabin care):** 452k cabins. Subscription inspection and maintenance, or rental management. Novasol is a competitor.

### Norway rejects
- Exit services for people moving to Switzerland: only 163 business owners since 2020, and the flow is stable.
- Lead generation for seafood exporters: US exports were −28% in H1 2026, but the buyers are consolidated.
- Importing the "next padel": fad risk and heavy capex.
- Importing US franchises: slow. N1 reaches the same buyers faster.

---

## Rejected this round (US)

- 179D/45L "last-chance" studies: ended 30 Jun 2026.
- WOTC: lapsed.
- §174A retro amendments: window closed 6 Jul 2026.
- Trump Accounts §128: too small.
- SBIR writing on its own: $5–25k anchor.
- Flat-fee state incentives: incumbents work on success fees.
- Export-controls compliance: needs counsel; SaaS tools dominate.
- Prior auth: VC-saturated and HIPAA-heavy.
- E-commerce customer service: Fin/Gorgias charge ~$1/resolution.
- SOC 2 readiness: Vanta/Drata already cover it.
- Property management: EliseAI.
- Dental sleep: no new trigger.
- Intracept: no new trigger.
- GUIDE: closed.
- Arizona ABS: tiny market.
- Whole-body MRI: Ezra/Function already partner with 170+ sites; no society backing.

**Possible at $15–30k:** CCTA + AI plaque program (CPT 75577), memory clinic (pTau217 + Leqembi Iqlik), ASM readiness (starts 1 Jan 2027, pays from 2029), Subchapter V (if the $7.5M limit is signed), CPA "AI capacity + advisory", Proposal Factory (govcon), year-end non-itemizer donor engine, 529-for-credentials, Plant Ramp (168(n)), Bridge-Power deal engine, Large-Load Readiness Room.

## Order of attack

1. **Start now:**
   - Peak Tag Shield: hard 1 June 2027 deadline.
   - 45Z: grower enrollment before the 2027 season.
   - Rekrutteringsmotor Helse: Norway, no tender needed.
   - Liftout Launch OS: a continuous flow of breakaways.
2. **Productize:** Freight Ops Copilot and AI Order Desk. Then use those case studies to open the PE operating-partner channel (#11).
3. **Time-boxed:** RPM conversion (after the ~1 Nov final rule) and Energiløft (deadline 1 Dec 2026).
