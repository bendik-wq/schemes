# Offshore tender & RFQ engine: market research (30 Oct 2026)

Desk research with web search; Monid was not available in this session (no `MONID_API_KEY`), so no Meta Ads Library or Google Trends pull yet. [UNVERIFIED] marks claims that come from third parties or could not be confirmed.

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

## Next research (needs Monid key)
- Meta Ads Library: `tools/ads_scan.sh NO "anbud"`, `GB "tender software"`, `NO "tilbudsarbeid"`.
- Google Trends (NO): "anbud", "doffin", "tilbudsskriving", "jqs", "mercell".
