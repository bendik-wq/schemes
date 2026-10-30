# Northbid: what makes it valuable (30 Oct 2026)

Built from public signals pulled through Monid: LinkedIn jobs and posts, Indeed, Reddit, Trustpilot, Crunchbase and news. Also used: TED award notices, trade-press feeds, and the earlier Trends and Meta Ads work. Monid spend: $0.82.

## The finding in one line
Suppliers don't lose work because they answer RFQs slowly. They lose it because they hear about the work too late and miss something when they answer. The product that is worth real money **sees the RFQ coming** and **can't miss a requirement**. Faster drafting is a commodity.

## Evidence

**1. Work arrives through tier-1s and frame agreements, after public triggers.**
- About NOK 100bn of Equinor frame work went to 7 tier-1s (Aibel, Aker Solutions, Wood and others). SMEs increasingly sell into tier-1 RFQs, which never appear on public portals.
- In October 2026 alone the news carried several such triggers:
  - Aker BP and DNO took FID on Lyra, a subsea tie-back to Gjøa (first oil H1 2028).
  - Aibel won the Wisting FPSO topsides FEED with an EPma option; fabrication comes later.
  - BP widened Aker Solutions' North Sea engineering and integrity deal.
  - Enova granted NOK 3.9bn to two floating wind projects off Karmøy.
- Each trigger is followed by a predictable cascade of subcontract packages, buyers and timing. We encoded that cascade (`tender-engine/src/radar/cascade.ts`).
- Job ads confirm buyers pay people to watch for these triggers. Nigel Wright's Oslo client: "monitor tender publications… maintain Tender Calendars". SPIE: "bewaakt aanbestedingsplatforms". ALTRAD: EOI, PQQ and portal administration.

**2. Missing one item loses the bid, and buyers distrust AI that skims.**
- "A single missed knock-out requirement can exclude a bid that took 420 hours to prepare."
- One model pass "misses at least one document on 31 of 44 real EU tenders"; multiple passes reached 99.4% recall.
- Scepticism is strong: "Found two compliance details that were just wrong. Nobody caught it until the client did." Another poster ran the same AI evaluation seven times and got scores from 55 to 77.
- So the selling points are auditability, citations and a second pass, not speed.

**3. Buyers want competition and price intelligence.**
- TED award notices name winners, their size, contract value and how many bids were received. Sample across NO/DK/NL offshore since Jan 2025: median 3 bids per contract, 44% won by SMEs or mid-size firms.
- Tenderbook, Reyda and AZTender sell buyer history and past-award analysis to generic markets. None of them cover offshore.

**4. The human being replaced or augmented is expensive and stretched.**
- Tender manager pay is €4.6–7.5k a month in the NL ads, so roughly €90–120k a year fully loaded.
- Estimator is the most common Norwegian bid role in the sample (Nordic Steel, Skanska, Panamera).
- Burnout shows up repeatedly ("2–3 bids due a day"; an energy-services tender lead "starting to feel burnout").
- Job ads name almost no bid software. The market still runs on Excel and SharePoint, so there is no incumbent to displace.

**5. The field is crowded with generic AI-tender startups, and none is offshore-aware.**
- Generic AI-tender startups: Tendrio, Tendera, Patterno, Cato (€6M seed), Reyda and others.
- Incumbents: Loopio, Responsive and Qvidian, aimed at SaaS security questionnaires.
- Offshore Qualific (Magnet JQS) owns qualification but not bidding.
- Several bid managers are paid $70–100/h to train frontier AI models on compliance matrices. General models will commoditise generic proposal writing, so the moat has to be offshore-specific: NORSOK, cascades, award data and estimating.

## What Monid can and cannot reach (tested)

| Works | Didn't work |
|---|---|
| LinkedIn job search (anyapi, about $0.02 per 25 jobs) | LinkedIn company employees and people search: returned nothing for Aker BP and Aker Solutions |
| LinkedIn post search (anyapi, about $0.0012/post; harvestapi with author filters) | LinkedIn company posts via ploid: input error. harvestapi profile-posts worked instead |
| Indeed (anyapi), Reddit (anyapi), news (search1api) | Trustpilot: almost no reviews for tender tools |
| Crunchbase name search (noisy) | Contact lookup for named buyers: not reliable, and avoided anyway for GDPR reasons |
| Company enrichment (Apollo/akta), tech stack and traffic (dataforseo/akta), customs trade data (tendata) | Not tested yet |

Free sources used directly, without Monid:
- TED search and award notices.
- UK Find a Tender.
- Trade-press RSS: Offshore Energy, offshoreWIND.biz, Offshore Engineer, Splash247, World Oil, Offshore Technology, NS Energy, Rigzone, Aker BP, Cision Norge, E24.
- Google News answers from a laptop but returns 503 to Cloudflare, so it is only an extra source.

## What was built today (live)
- **Project radar.**
  - Reads 11 trade and press feeds, plus Google News when it answers, every 6 hours.
  - Classifies each trigger: FID/PDO, contract award, FEED, frame agreement, decommissioning, wind grant or vessel.
  - Clusters the same story across outlets.
  - Works out who buys next and which packages usually follow, and when.
  - Ranks each signal against the supplier's profile, and penalises other regions and non-energy news.
  - Status and next-step notes per signal.
- **Who wins.** TED award notices in the supplier's field: winners, value in EUR, bids received, median bids, SME share.
- **Second-pass reading.** When Claude reads an RFQ, the rule reader runs as well. Requirements only it found are added and flagged "check: second pass".
- **Offer page.** Repositioned to "See the RFQ coming. Answer it without missing a line."
- 41 tests.

## Next, by value
1. **Estimating copilot** (highest willingness to pay after the radar). RFQ, drawings and specs go in. Out come:
   - a take-off or quantity list and an estimate sheet;
   - a scope-gap and risk list;
   - sub-supplier quote requests and a side-by-side quote comparison;
   - tender assumptions (tilbudsforutsetninger).
   It is the most common Norwegian bid role and no RFP tool covers it.
2. **Qualification & evidence autopilot.**
   - Certificate and insurance expiry, and JQS/Achilles profile readiness.
   - Evidence status per matrix row, with page or clause citations.
   - "Answer once" for Transparency Act and VSME ESG questionnaires.
3. **Addenda and clarification tracking.** Diff each addendum against the matrix, flag affected rows, and keep a clarification and deviation register through to contract handover.
4. **Capacity-aware bid/no-bid.** Check the bid calendar and the people and vessels already committed.
5. **Account plays from the radar.** For each signal, a one-page brief:
   - the buyer's supplier portal and how to register;
   - past awards by that buyer from TED;
   - a capability statement drafted from the library.
   No personal contact data.

## Pricing (proposal; not changed on the page)
Today: NOK 95k install + NOK 9.5k/month, everything included. The radar is pipeline (new revenue), not just time saved, so it supports a higher tier:

| Plan | Install | Monthly | What |
|---|---|---|---|
| Bid Desk | NOK 95k | NOK 9.5k | Reader, matrix, library, tender watch |
| Bid Desk + Radar | NOK 95k | NOK 19.5k | Adds project radar, Who wins, monthly account-plays review |
| + Estimating (when built) | +NOK 60k | +NOK 10k | Estimating copilot and quote comparison |

Anchor: one tender manager costs about €90–120k a year. Bid Desk + Radar is about NOK 330k in year one, roughly a quarter of a hire. One subcontract won from a radar signal pays for years of it.

## Go-to-market changes from this research
- **Lead with the radar, not the reader.** "Aker BP and DNO sanctioned Lyra on 30 October. Here are the 9 packages and the 3 buyers that usually follow." A weekly or monthly radar digest is the lead magnet. Fresh project news is something suppliers forward to each other.
- **Use the job market as the target list.** Suppliers currently hiring tender managers or estimators have the pain and the budget. Examples: Nordic Steel, Norwegian Offshore Rental, ROVOP, Enshore Subsea, Acta Marine, STAR Specialists, Hanab, Global Wind Service, Pentair Union Engineering, AMETEK/Solartron, James Fisher Renewables, Acteon. A weekly Monid LinkedIn job pull (about $0.10) keeps that list fresh.
- **Sell auditability.** "Read twice, every row cited, nothing missed." This answers the main objection to AI in bidding.
