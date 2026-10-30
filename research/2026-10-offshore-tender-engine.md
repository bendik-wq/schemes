# Offshore tender & RFQ engine: market research (30 Oct 2026)

Desk research with web search, plus Monid pulls of Google Trends and the Meta Ads Library on 30 Oct 2026 (raw summaries in `data/offshore-tender/`). [UNVERIFIED] marks claims that come from third parties or could not be confirmed.

## Where offshore suppliers get RFQs
- **Qualification registers:** Norwegian operators use **Magnet JQS** (Equinor, Vår Energi and Gassco name it). Achilles JQS was dropped by Norwegian operators in 2019. **Achilles Global Energy** (formerly FPAL + JQS) is still used in the UK and internationally. Ørsted requires its Jaggaer portal plus Achilles Utilities NCE.
  - https://www.equinor.com/en/supply-chain.html · https://varenergi.no/en/operations/suppliers/ · https://achilles.com/global-energy · https://orsted.com/en/About-us/Procurement/Supplier-registration
- **Operator portals (invite-only):**

  | Buyer | Portal |
  |---|---|
  | Equinor | SAP Ariba |
  | Aker BP | Ivalua |
  | Vår Energi | Ivalua; also requires NORSOK Z-018 and EqHub |
  | OKEA | SISCommerce |
  | Aker Solutions | Ariba |

  **Most operator RFQs never appear publicly.** That is why the product centres on the RFQ reader, not on search.
- **Public APIs (tested 30 Oct 2026):**
  - TED `POST https://api.ted.europa.eu/v3/notices/search`: no key. Gotcha: `FT~(a OR b)` returns nothing; use one `FT~` per term.
  - UK Find a Tender OCDS `GET /api/1.0/ocdsReleasePackages`: no key.
  - Doffin: needs a subscription key (401 without one).

## Tailwinds
- **Norwegian shelf investment** (SSB, Aug 2026): NOK 275bn expected in 2026 (record NOK 273bn in 2025), falling to NOK 227bn in 2027. Spend shifts to fields already producing: modifications, maintenance and call-offs, which suit SMEs. Bid competition tightens from 2027. https://www.oedigital.com/news/539681-norwegian-oil-firms-lift-2026-2027-investment-outlook
- **Norwegian offshore wind suppliers:** NOK 64bn turnover in 2025. Utsira Nord areas awarded Dec 2025 and Feb 2026.
- **UK decommissioning:** record £2.6bn in 2025, close to £3bn a year expected this decade (NSTA, OEUK).
- **UK sentiment:** only 35% of UK supply-chain firms are confident about the next 12 months.

## Pain and economics
- **What an RFQ asks for:** technical, commercial and HSE sections, a deviation list, NORSOK Z-018 documentation, SDRL, mandatory questionnaires and Transparency Act questionnaires.
- **Bid cost** (UK construction proxy; no offshore data found):
  - about 0.57% of project value per bid (0.65% for winning bids, 0.48% for losing ones);
  - win rate 1 in 5 (1 in 8 for small firms);
  - 2–3% of revenue overall.
- No public NORSOK compliance-matrix tool found [UNVERIFIED that none exists].

## Competitors
| Tool | Price | What it misses |
|---|---|---|
| Loopio | ≈ $20k/yr | Generic RFP software |
| AutoRFP | $499–899/mo | Generic RFP software |
| Tendium | ≈ €115–125/mo | Public notices only |
| Mercell | not public | Public notices only |

None handle NORSOK, Z-018, deviation lists or JQS evidence.

## Regulation hooks
- **Norwegian procurement law:** amended, in force 1 Jul 2026. National threshold NOK 500k.
- **Transparency Act:** questionnaires reach suppliers of every size.
- **CSRD after the Omnibus deal:** suppliers under 1,000 staff can limit value-chain requests to VSME, so the pitch is "answer once".

## Headline hooks
1. NOK 275bn will be spent on the Norwegian shelf this year. How much of it reaches your inbox as an RFQ?
2. Most offshore RFQs never appear on Doffin.
3. Win 1 in 5 bids? Then 80% of your bid hours are wasted.
4. Every ITT turned into a NORSOK compliance matrix before your engineers read page one.
5. Transparency Act, ESG and JQS questionnaires answered once.

## Google Trends (Monid / DataForSEO, 5 years, weekly)
Last 13 weeks vs the same weeks last year (YoY) and vs the first year of the window (5y). Full table: `data/offshore-tender/trends-2026-10-30.csv`.

| Market | Keyword | Index now | YoY | 5y |
|---|---|---|---|---|
| Norway | anbud | 63 | −2% | +11% |
| Norway | doffin | 33 | **+36%** | +49% |
| Norway | mercell | 21 | **−30%** | −35% |
| UK | find a tender | 2.4 | +35% | +359% |
| UK | bid management | 1.0 | +160% | +940% |
| UK | ai tender | 2.2 (from ~0) | new | new |
| US | rfp software | 16 | −47%* | +306% |
| US | ai rfp | 18 | −53%* | new |

\* The US negative YoY figures come from a spike last year, not a collapse: both terms are still far above where they were five years ago.

Read:
- More Norwegian companies go looking for tenders themselves: Doffin is rising while Mercell, the paid aggregator, is falling. That fits the "find it yourself, then answer it well" pitch.
- Niche terms such as "jqs", "tilbudsskriving", "anbudsportal" and "ki anbud" have close to zero search volume in Norway. Paid search won't carry this offer.
- In the UK, interest in "ai tender" and "bid management" has just started; volumes are still tiny.

## Meta Ads Library (Monid, 40 most-seen active ads per query)

| Query | What is running |
|---|---|
| NO "anbud" | **DittAnbudsvarsel.no**: tender alerts, new (5 days old), hook "NOK 14.9bn in public tenders announced in July. How many fitted your company, and how many did you hear about?"<br>**Aider Norge**: guide download, 25 days, "Climate and environmental criteria count at least 30% in public tenders. Download the guide showing what good answers look like."<br>**Fama**: Miljøfyrtårn certification help, "8–14 hours of your own effort".<br>The rest is consumer "send it out to tender" (Lisi, TjenesteTorget). |
| GB "tender software" | **ProcureKey**: buyer-side sourcing.<br>**Capsule CRM**: "civil engineering firms… one place to track tenders". |
| GB "bid writing", "offshore supplier" | Noise. Nothing on bids for offshore suppliers. |
| US "ai rfp" / "rfp software" | **SamSearch**: "Your next government contract might never show up on SAM.gov", the same insight as our invite-only angle.<br>**OpenAsset/Shred**: AI proposals from your own content.<br>**HALOS**: long-form "why they win contracts" copy, 18 variants, 130 days, so it is profitable. |

Read:
- **No one advertises a tender or RFQ tool to offshore suppliers on Meta in Norway or the UK.** The audience is cheap to reach but has low intent.
- What is running in Norway is lead magnets (Aider's guide) and free alerts (DittAnbudsvarsel). That is the right shape for cold traffic: give away a useful tool, then sell the install.

## Channel plan this suggests
1. **Direct outreach first.** The buyers are a list, not an audience: FSi members, Norwegian Offshore Wind members, suppliers visible in Magnet JQS categories, and winners of past TED notices in relevant CPV codes. The tender-watch data can build that list.
2. **Lead magnet on Meta and LinkedIn:** a free "NORSOK compliance matrix template + bid/no-bid checklist", or "send us one RFQ, get the matrix back". Retarget page visitors to the application.
3. **No Google search ads** until volumes exist. Revisit "ai tender" (UK) in Q2 2027.

## Next research
- LinkedIn Ads Library for Mercell, Tendium and Loopio creatives (Monid has no LinkedIn scraper wired in yet).
- Pull past TED award notices for offshore CPV codes (Norway, Denmark, the Netherlands) to size the list of winning suppliers.
