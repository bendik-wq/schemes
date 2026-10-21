# Betting-algo: arbitrasje, value bets, parlays og egen modell

Statistisk verktøy som leter etter ineffektiviteter i oddsmarkedet. Ren Python 3.10+, ingen pakker å installere.

```bash
cd betting
python3 -m betting scan --sample                        # demo uten nett/nøkkel
export ODDS_API_KEY=...                                 # gratis på the-odds-api.com
python3 -m betting scan --sport soccer_epl soccer_norway_eliteserien
python3 -m betting backtest --league E0 --season 2425   # test på ekte historikk
python3 -m betting model --sample Brann Molde           # modellens fair odds
python3 -m unittest tests/test_betting.py
```

## Hva den finner

| Modul | Hva | Hvorfor det er en ineffektivitet |
|---|---|---|
| `arbitrage.py` | **Arbitrasje**: beste odds per utfall på tvers av bøker, sum 1/odds < 1. Regner ut innsats per ben (avrundet) så gevinsten er lik uansett utfall. Også **middles** på over/under. | Bøker oppdaterer i ulikt tempo og priser for ulike kunder. |
| `value.py` | **Value bets**: fjerner marginen fra Pinnacle/Betfair (eller medianen av markedet) og flagger myke bøker med høyere odds. Innsats via fraksjonell Kelly. | Skarpe bøker er det beste estimatet på sann sannsynlighet; myke bøker henger etter. |
| `models.py` | **Dixon–Coles** (Poisson med tidsvekting og lavscore-korreksjon) for fotball, **Elo** for to-veis-idretter. Gir 1X2, over/under, handicap, BTTS og vilkårlige kombinasjoner. | Gir et uavhengig estimat å blande med markedet. |
| `parlay.py` | **Parlays** bygget kun av +EV-ben fra ulike kamper hos samme bok, rangert etter Kelly-vekst. `same_game_edge` + `DixonColes.joint` for samme-kamp-kombinasjoner. | Bøker priser ofte korrelasjon i samme kamp grovt. |
| `odds.py` | Devig (Shin, power, multiplikativ, additiv), EV, Kelly, CLV. | Shin/power tar høyde for at longshots er mest overpriset. |
| `backtest.py` | Walk-forward-test på football-data.co.uk med Pinnacle-sluttkurs. | Viser om strategien holder, uten fremtidslekkasje. |

## Det viktigste å vite (fra backtesten på Premier League 24/25)

```
Max > Pinnacle fair (marked)  spill  52  ROI -27.83%  snitt-CLV +0.81%
Modell 30% + Pinnacle         spill 290  ROI  +5.15%  snitt-CLV -2.39%
Kun modell                    spill 391  ROI  +8.73%  snitt-CLV -2.10%
Log-loss: modell 1.0011, Pinnacle 0.9830, blanding 0.9825
```

* **ROI på én sesong er mest flaks.** Modellen «tjente» penger men slo ikke sluttkursen (negativ CLV), mens markedsstrategien tapte penger men slo sluttkursen. Over tid er det CLV som teller.
* **Markedet er bedre enn en enkel modell.** Pinnacle har lavere log-loss enn Dixon–Coles. Bruk modellen som et lite tillegg (`--model-weight 0.1–0.3`), ikke alene. Store avvik mellom modell og marked betyr som regel at modellen tar feil (skader, rotasjon, motivasjon mangler i den).
* **Parlays ganger opp marginen**: 5 ben à 5 % margin ≈ 22 % margin. Bare +EV-ben gir +EV-parlay.
* **Arbitrasje og value fører til begrensede kontoer** hos myke bøker. Avrund innsatser, ikke spill bare på feilpriser, og regn med at kontoer blir limitert.
* Odds endrer seg på sekunder. Sjekk prisen hos boka før du legger inn, og sjekk regler for void/forlengelse (to ben i et arb kan avgjøres ulikt).
* `--sample` bruker oppdiktede odds og en modell trent på simulerte resultater, så tallene der er bare for å vise funksjonene.

## Datakilder
* Live odds: [the-odds-api.com](https://the-odds-api.com) (`ODDS_API_KEY`). `python3 -m betting sports` lister sportsnøkler.
* Resultater og historiske odds: [football-data.co.uk](https://www.football-data.co.uk) – CSV-ene kan brukes direkte med `--results` og `backtest --file`.
