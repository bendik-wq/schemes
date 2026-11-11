# Hendelsesrisiko-desken: prediksjonsmarkeder som varslingssystem for sykliske selskaper

Laget 11. nov 2026. Bygger på følgende data:
- Polymarket og Kalshi, hentet fra åpne API-er 11.11.2026, i `research/data/prediction-markets-2026-11-11/`.
- Kjøperlistene i `deals/oppkjopskandidater-vestland.xlsx`.
- Juridisk og markedsmessig gjennomgang med kilder, oppsummert nedenfor.

Kategorier i dataene: 358 relevante Polymarket-events og 58 relevante Kalshi-events.

## Konklusjon først

**Ideen om å sikre seg med prediksjonsmarkeder fungerer ikke for norske selskaper i dag. Ideen om å bruke dem som varsel fungerer godt.**

Fire grunner til at direkte sikring ikke går:

1. **Pengespill:** Lotteritilsynet varslet i oktober 2026 DNS-blokkering av Kalshi og Polymarket, sammen med 60 andre sider. Direktøren sa: «vi har i praksis trukket vår konklusjon». Danmark, Nederland og Spania har allerede blokkert eller bøtelagt.
   ([AffPapa](https://affpapa.com/norway-to-block-kalshi-polymarket-60-more-illegal-websites/), [Dagens PS](https://www.dagensps.se/bors-finans/norge-vill-blockera-polymarket-sverige-saknar-verktygetnorge-vill/))
2. **Verdipapirregler (MiFID II):** ESMA sa 3.7.2026 at hendelseskontrakter på olje, renter og klima er finansielle instrumenter.
   - Forbudet mot binære opsjoner for ikke-profesjonelle gjelder.
   - Profesjonelle kunder må handle via autoriserte aktører.
   - Kontrakter på toll, valg og våpenhvile faller trolig inn under pengespill-loven.
   ([PwC](https://legal.pwc.de/en/news/articles/esmas-public-statement-confirms-that-existing-binary-options-prohibitions-apply-to-event-contracts))
3. **Tilgang:** Kalshis selskapskontoer ser ut til å være forbeholdt amerikanske personer. Polymarket US er for amerikanske brukere.
4. **Likviditet:** Utenfor sport er bøkene tynne. Rundt $1 600 flyttet en WTI-kontrakt 5 prosentpoeng. Realistisk sikringsstørrelse er titusener av dollar per marked, ikke millioner.
   ([CryptoBriefing](https://cryptobriefing.com/prediction-markets-see-prolonged-hormuz-disruption-wti-crude-unlikely-to-hit-160/))

**Det som fungerer:**
- Prisene er offentlige. De er markedets beste sanntidsanslag på sannsynlighet for hendelser som ingen bank-derivat priser: Hormuz, Rødehavet, Iran-sanksjoner, Fed-kutt, resesjon og oljepristerskler.
- Å *lese* prisene er lovlig, selv om nettsidene blokkeres.

Derfor selger vi **hendelsesrisiko som styringsverktøy, og ikke spill**. Faktisk sikring skjer med vanlige instrumenter via lisensiert bank eller megler:
- valuta
- renter
- kraft
- frakt (FFA)
- Brent
- laks

## Hva markedene faktisk priser, med reell dybde (11.11.2026)

| Hendelse | Marked | Volum | Åpne posisjoner | Hvem i Vestland treffes |
|---|---|---|---|---|
| USA avslutter Iran-blokaden | Polymarket | $52M | $2,4M | Tankrederier, sjømat (frakt), offshore |
| Hormuz-trafikken normal innen 31.12 | Polymarket | $18M | $1,9M | Tank og produkt, olje |
| Bab el-Mandeb (Rødehavet) stengt | Polymarket | $18M | $0,8M | Container og bulk, eksportører (transporttid) |
| Israel–Iran-våpenhvilen holder | Polymarket | $52M | $2,1M | Olje, frakt |
| Fed-beslutning desember | Polymarket | $26M | $3,9M | Alle med USD-gjeld og USD-inntekt, eiendom |
| Antall Fed-kutt i 2026 | Polymarket | $56M | $2,0M | Samme |
| WTI-nivå i november | Polymarket | $2,2M | $1,3M | Offshore og olje |
| Resesjon i USA innen 2026 / i 2027 | Polymarket / Kalshi | $2,5M / $1,0M | $0,6M / $0,4M | Industri, sjømat-etterspørsel |
| Toll og handelsavtaler | Polymarket | under $0,5M | under $0,1M | Sjømat (for tynt til å stole på) |
| Gass, kraft og vær | Begge | nesten null | nesten null | Ikke brukbart |
| Norges Bank, laks, grunnrenteskatt | Ingen | – | – | Ikke priset |

Det betyr at **geopolitikk rundt olje og frakt, amerikanske renter og resesjon** er priset med reelle penger. Toll, kraft, vær og alt norsk er ikke det.

## De mest sykliske kjøperne i Vestland, og hvilken hendelse som rammer dem

Rangert etter størrelsen på hendelsesrisikoen som bare prediksjonsmarkeder priser:

1. **Shipping (tank, produkt, offshorefartøy):**
   - Hendelser: Hormuz, Rødehavet, sanksjoner.
   - FFA priser fraktraten, men ikke hendelsen som utløser den.
   - Eksempler fra listen: Odfjell Drilling, DOF Subsea, Seaborn (frakt), Scan-Shipping Bergen. I tillegg Bergens tank- og kjemikalierederier utenfor listen, som er børsnoterte eller eid av konsern.
2. **Olje- og gasstjenester og offshore:**
   - Hendelser: oljepristerskler, våpenhvile og sanksjoner (Russland og Iran), resesjon. Disse styrer investeringene hos oljeselskapene.
   - Eksempler: Enhanced Drilling, TCO Norway, Omega Subsea, M Vest Energy, Petrolia Noco.
3. **Sjømateksport og havbruk:**
   - Hendelser: USA-toll (bare tynt priset), USD/NOK via Fed, frakt via Rødehavet, resesjon.
   - Lakseterminer finnes, men er svært illikvide.
   - Eksempler: Sjor, Seaborn, Coast Seafood, Tess Vest, Blom og Nordsjø Fjordbruk.
4. **Verft og industri:**
   - Hendelser: Fed og resesjon (ordreinngang), olje (offshore-ordre), sanksjoner på komponenter.
   - Eksempler: Leirvik, Palfinger Marine, Alutec.
5. **Bygg og eiendom:**
   - Hendelser: renter. Norges Bank er ikke priset, men Fed og ECB smitter over.
   - Eksempler: Presis Vegdrift, Sartor & Drange.

---

## Tilbudet: Hendelsesrisiko-desken

**Løfte:** «Styret og ledelsen ser hver uke hva markedet tror om hendelsene som kan snu resultatet deres: Hormuz, Rødehavet, sanksjoner, oljeprisen, renter og resesjon. Hvert varsel er koblet til hva det betyr i kroner for dere, og til hva dere gjør når en terskel nås.»

**Kjøper:**
- Private og sykliske selskaper i Vestland med driftsresultat over 20 MNOK innen shipping, offshore, sjømateksport, verft og industri.
- Rundt 60–90 selskaper på listen vår.
- Beslutningstaker er administrerende direktør eller CFO, med styret som mottaker.

**Hvorfor nå:**
- 2026 har vist hvor mye hendelsesrisiko betyr:
  - Hormuz- og Rødehav-uro
  - USA-tollen på Norge er endret tre ganger
  - sjømateksporten til USA er ned 28 % i første halvår
  - oljeinvesteringene ventes å falle rundt 17 % i 2027 (SSB)
- Prediksjonsmarkedene har vokst kraftig: Kalshi rundt $178 mrd i årlig volum.
- Det betyr at det nå finnes sanntidspriser på slike hendelser for første gang.

**Leveranse:**

1. **Risikokart på 30 dager:**
   - Kartlegge de 5–10 hendelsene som betyr mest for resultatet.
   - Følsomhet i kroner per hendelse: for eksempel hva Hormuz åpen eller stengt betyr for rater og marginer, eller hva 25 bp Fed-kutt betyr for USD/NOK og rentekostnad.
   - Bygget på selskapets egne tall.
2. **Ukentlig hendelsesrapport og dashbord:**
   - Sannsynligheter fra Polymarket og Kalshi, lest via åpne API-er. Vi handler ingenting.
   - Volum og åpne posisjoner vises ved siden av, så man ser hvor mye tillit et tall fortjener.
   - Endring siste uke.
   - Terskelvarsler, for eksempel «sannsynligheten for normal Hormuz-trafikk innen kvartalsslutt har passert 60 %».
   - Kostnad: vi bygger på stacken vi alt har (Workers, D1, cron og varsler). Feedene er gratis.
3. **Scenarier i budsjett og plan:**
   - Sannsynlighetene brukes som vekter i budsjettets scenarier, i stedet for magefølelse.
   - Kvartalsvis gjennomgang med styret.
4. **Sikringspolicy:**
   - Vi skriver policy og beslutningsregler, for eksempel «når X skjer, sikrer vi Y % av eksponeringen».
   - Gjennomføring og produktanbefalinger går via selskapets bank eller en lisensiert megler (DNB, Nordea, Clarksons eller annen FFA-megler), eller via en lisensiert partner som vi er tilknyttet agent for.
   - Instrumenter: valuta, renter, kraft, FFA, Brent og laks.
   - Vi anbefaler ikke konkrete finansielle instrumenter uten slik lisens.

**Pris:**
- Risikokart: NOK 150k, som trekkes fra første år.
- Desken: NOK 35k per måned med ukerapport, dashbord, varsler og kvartalsmøte med styret.
- Sikringspolicy: NOK 120k som tillegg.
- Totalt år én: rundt NOK 540k.

*Illustrasjon:* For et rederi med 100 MNOK i driftsresultat der én hendelse kan flytte resultatet 20–30 MNOK, er ett godt timet sikrings- eller budsjettvedtak per år nok til å betale dette mange ganger. Tallene er illustrasjon, ikke løfte.

**Garanti (skriftlig):**
- Risikokartet leveres på 30 dager med følsomheter i kroner.
- Hvis ledelsen etter kartet mener desken ikke gir beslutningsverdi, kan den sies opp før første månedsfaktura.
- Vi lover ingen avkastning og ingen treffsikkerhet i markedene.

**Åpningsmelding:**
> «Polymarket-traderne har satt rundt 18 millioner dollar på når trafikken gjennom Hormuz blir normal, og 18 millioner på om Rødehavet stenges. Hva betyr hvert av utfallene i kroner for [selskap], og hva gjør dere når sannsynligheten passerer 60 %? Vi setter opp et ukentlig varsel med de 5–10 hendelsene som kan snu resultatet deres.»

## Rammer vi holder oss innenfor
- **Ingen handel og ingen oppfordring til handel** på Kalshi eller Polymarket for norske selskaper. Markedsføringsforbudet i pengespilloven og MiFID-reglene gjelder.
- **Ingen konkrete investeringsråd** uten konsesjon som verdipapirforetak eller som tilknyttet agent (verdipapirhandelloven § 2-3).
- **Direkte hendelseskontrakter** vurderes bare for kunder med amerikansk datterselskap eller via en autorisert MiFID-plass, og bare på finansielle underliggende. Det krever forhåndsklarering fra advokat, revisor og skatt.
  - Sikringsbokføring etter IFRS 9 er lite sannsynlig, så resultatet vil svinge.
  - Skattemessig fradrag er usikkert hvis kontraktene regnes som spill.
- **Tynne markeder kan manipuleres eller hoppe.** Vi viser alltid volum og åpne posisjoner, og bruker tallene som ett av flere signaler.

## Risiko for oss
- Ordet «prediksjonsmarked» høres ut som pengespill. Vi selger det som *markedsbaserte sannsynligheter* i et styringsverktøy.
- Regulatoriske endringer i USA kan svekke datakilden. Vi har to feeder og kan legge til CME/FanDuel Predicts og ForecastEx.
- Desken har mest verdi i urolige perioder. Når det er rolig, må den vise verdi gjennom budsjett og policy.

## Neste steg
1. Bygge prototypen av dashbordet. Det tar 1–2 dager med eksisterende stack (Polymarket gamma-API og Kalshi trade-api, cron hvert 30. minutt, terskelvarsler på e-post eller Slack).
2. Lage tre demo-risikokart, for et rederi, en sjømateksportør og en offshore-leverandør fra listen, med offentlige tall fra Brønnøysund.
3. Avklare med advokat hvilken partnermodell vi trenger for sikringspolicyen (tilknyttet agent eller henvisning).
