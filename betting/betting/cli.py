"""Kommandolinje.

    python -m betting scan --sample                    # offline demo
    python -m betting scan --sport soccer_epl          # live (krever ODDS_API_KEY)
    python -m betting scan --sport soccer_epl --results E0.csv   # + egen modell
    python -m betting model --sample Brann Molde       # modellprediksjon
    python -m betting backtest --league E0 --season 2425   # historisk test
    python -m betting sports                           # liste over sportsnøkler
"""
from __future__ import annotations

import argparse
import json
import sys

from . import data
from .arbitrage import find_arbs, find_middles
from .markets import group_markets
from .models import DixonColes, model_probs_for_markets
from .parlay import build_parlays
from .value import find_value_bets


def _pct(x: float) -> str:
    return f"{x * 100:+.2f}%"


def _hdr(title: str) -> None:
    print(f"\n{'=' * 78}\n{title}\n{'=' * 78}")


def cmd_scan(a: argparse.Namespace) -> None:
    if a.sample:
        events = data.sample_events()
    elif a.file:
        events = data.load_events(a.file)
    else:
        events = []
        for sport in a.sport:
            events += data.fetch_odds(sport, a.regions, a.markets)
    markets = group_markets(events)
    print(f"{len(events)} kamper, {len(markets)} markeder, "
          f"{len({b for m in markets for b in m.prices})} bookmakere")

    model_probs = None
    if a.results or a.sample:
        results = data.simulate_results() if a.sample and not a.results else data.load_results_csv(a.results)
        model = DixonColes(half_life_days=a.half_life).fit(results)
        model_probs = model_probs_for_markets(model, markets)
        print(f"Modell trent på {len(results)} kamper, dekker {len(model_probs)} markeder "
              f"(hjemmefordel {model.home_adv:.2f}, rho {model.rho:+.2f})")

    report: dict = {}

    # --- Arbitrasje ---
    arbs = find_arbs(markets, a.min_arb)
    _hdr(f"ARBITRASJE ({len(arbs)})  – garantert gevinst uansett utfall")
    for arb in arbs:
        print(f"\n{arb.market.label}  {arb.market.commence_time}\n  ROI {_pct(arb.roi)}")
        stakes = arb.stakes(a.arb_stake, round_to=a.round_to)
        pay = arb.payouts(stakes)
        for o, (price, book) in arb.legs.items():
            print(f"  {o:<22} {price:>6.2f} @ {book:<16} innsats {stakes[o]:>8.0f}  gevinst {pay[o]:>+7.0f}")
    report["arbs"] = [{"market": x.market.label, "roi": x.roi,
                       "legs": {o: {"odds": p, "book": b} for o, (p, b) in x.legs.items()}} for x in arbs]

    middles = find_middles(markets)
    if middles:
        _hdr(f"MIDDLES ({len(middles)})")
        for mid in middles:
            print(f"\n{mid.home} – {mid.away}: Over {mid.over_line} {mid.over[0]} @ {mid.over[1]}, "
                  f"Under {mid.under_line} {mid.under[0]} @ {mid.under[1]}")
            for k, v in mid.outcome_table(100).items():
                print(f"  {k:<24} {v:+.1f} per 100")

    # --- Value ---
    vbs = find_value_bets(markets, a.min_edge, a.max_odds, method=a.devig,
                          kelly_mult=a.kelly, model_probs=model_probs, model_weight=a.model_weight)
    _hdr(f"VALUE BETS ({len(vbs)})  – odds over fair pris (min edge {a.min_edge:.0%})")
    print(f"{'kamp/marked':<44}{'utfall':<14}{'bok':<15}{'odds':>6}{'fair':>7}{'edge':>9}{'innsats':>9}")
    for b in vbs[: a.top]:
        stake = b.kelly_fraction * a.bankroll
        print(f"{b.market.label[:43]:<44}{b.outcome[:13]:<14}{b.bookmaker[:14]:<15}"
              f"{b.odds:>6.2f}{b.fair_odds:>7.2f}{_pct(b.edge):>9}{stake:>9.0f}")
    if vbs:
        print(f"\nFair pris fra: {', '.join(sorted({b.source for b in vbs}))}. "
              f"Innsats = {a.kelly:.0%} Kelly av bankroll {a.bankroll:,.0f}.")
    report["value_bets"] = [{"market": b.market.label, "outcome": b.outcome, "book": b.bookmaker,
                             "odds": b.odds, "fair_odds": b.fair_odds, "edge": b.edge,
                             "stake": b.kelly_fraction * a.bankroll} for b in vbs]

    # --- Parlays ---
    parlays = build_parlays(vbs, max_odds=a.max_parlay_odds, top=a.top)
    _hdr(f"PARLAYS ({len(parlays)})  – bare +EV-ben fra ulike kamper, samme bok")
    for p in parlays:
        legs = " + ".join(f"{b.market.home[:10]}-{b.market.away[:10]} {b.market.market}: {b.outcome} ({b.odds:.2f})" for b in p.legs)
        print(f"  {p.legs[0].bookmaker:<14} {legs}\n"
              f"  {'':<14} odds {p.odds:.2f}  sanns. {p.prob:.1%}  edge {_pct(p.edge)}  "
              f"innsats {p.kelly_fraction(a.kelly) * a.bankroll:.0f}")
    report["parlays"] = [{"book": p.legs[0].bookmaker, "odds": p.odds, "prob": p.prob, "edge": p.edge,
                          "legs": [f"{b.market.label}: {b.outcome}" for b in p.legs]} for p in parlays]

    # --- Modell mot marked ---
    if model_probs:
        _hdr("MODELL MOT MARKED  – største avvik (bekreft før du spiller!)")
        rows = []
        for m in markets:
            mp = model_probs.get((m.event_id, m.market, m.line))
            if not mp:
                continue
            for o, p in mp.items():
                best = m.best_prices().get(o)
                if best:
                    rows.append((p * best[0] - 1, m.label, o, best, p))
        rows.sort(reverse=True)
        for edge, label, o, (price, book), p in rows[: a.top]:
            print(f"  {label[:43]:<44}{o[:13]:<14}{price:>6.2f} @ {book:<14} modell {1 / p:5.2f}  {_pct(edge)}")

    if a.json:
        with open(a.json, "w") as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
        print(f"\nLagret {a.json}")


def cmd_model(a: argparse.Namespace) -> None:
    results = data.simulate_results() if a.sample else data.load_results_csv(a.results)
    model = DixonColes(half_life_days=a.half_life).fit(results)
    if not a.home:
        print(f"{'lag':<18}{'angrep':>8}{'forsvar':>9}")
        for t, att, dfn in model.ratings():
            print(f"{t:<18}{att:>+8.2f}{dfn:>+9.2f}")
        return
    h, aw = a.home, a.away
    for t in (h, aw):
        if not model.knows(t):
            sys.exit(f"ukjent lag: {t}. Kjente: {', '.join(sorted(model.attack))}")
    lam, mu = model.rates(h, aw)
    print(f"{h} – {aw}: forventet mål {lam:.2f} – {mu:.2f}\n")
    for o, p in model.probs_1x2(h, aw).items():
        print(f"  {o:<18} {p:6.1%}   fair odds {1 / p:5.2f}")
    for line in (1.5, 2.5, 3.5):
        p = model.probs_total(h, aw, line)
        print(f"  Over/Under {line:<7} {p['Over']:6.1%} / {p['Under']:5.1%}   fair {1 / p['Over']:.2f} / {1 / p['Under']:.2f}")
    p = model.probs_btts(h, aw)["Yes"]
    print(f"  Begge scorer      {p:6.1%}   fair odds {1 / p:5.2f}")
    p = model.joint(h, aw, lambda x, y: x > y and x + y > 2.5)
    print(f"  {h} vinner + over 2.5  {p:6.1%}   fair odds {1 / p:5.2f}  (samme-kamp-kombo)")


def cmd_backtest(a: argparse.Namespace) -> None:
    import os
    import urllib.request
    from . import backtest
    path = a.file
    if not path:
        path = f"{a.league}_{a.season}.csv"
        if not os.path.exists(path):
            urllib.request.urlretrieve(backtest.results_url(a.league, a.season), path)
            print(f"Lastet ned {path}")
    res = backtest.run(path, warmup=a.warmup, min_edge=a.min_edge, model_weight=a.model_weight,
                       half_life=a.half_life, soft=a.soft)
    print(f"{res['matches']} kamper, flat innsats 100 per spill, min edge {a.min_edge:.0%}\n")
    for ledger in res["ledgers"]:
        print(ledger.summary())
    print("\nLog-loss på 1X2 (lavere = bedre sannsynligheter):")
    for k, v in res["logloss"].items():
        print(f"  {k:<22} {v:.4f}")
    print("\nCLV = hvor mye bedre oddsen var enn Pinnacles sluttkurs. Positiv CLV over tid er\n"
          "det sikreste tegnet på ekte edge; ROI på én sesong er mest støy.")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="betting", description="Arbitrasje, value bets og parlays")
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("scan", help="skann odds for ineffektiviteter")
    src = s.add_mutually_exclusive_group()
    src.add_argument("--sample", action="store_true", help="bruk innebygde eksempeldata")
    src.add_argument("--file", help="JSON i The Odds API-format")
    s.add_argument("--sport", nargs="+", default=["soccer_epl"])
    s.add_argument("--regions", default="eu,uk")
    s.add_argument("--markets", default="h2h,totals,spreads")
    s.add_argument("--results", help="CSV med historiske resultater for egen modell")
    s.add_argument("--model-weight", type=float, default=0.2)
    s.add_argument("--half-life", type=float, default=180)
    s.add_argument("--bankroll", type=float, default=10_000)
    s.add_argument("--kelly", type=float, default=0.25, help="andel av full Kelly")
    s.add_argument("--min-edge", type=float, default=0.02)
    s.add_argument("--max-odds", type=float, default=10.0)
    s.add_argument("--min-arb", type=float, default=0.0)
    s.add_argument("--arb-stake", type=float, default=1000)
    s.add_argument("--round-to", type=float, default=10)
    s.add_argument("--max-parlay-odds", type=float, default=15.0)
    s.add_argument("--devig", default="shin", choices=["shin", "power", "multiplicative", "additive"])
    s.add_argument("--top", type=int, default=15)
    s.add_argument("--json", help="lagre funn som JSON")
    s.set_defaults(func=cmd_scan)

    m = sub.add_parser("model", help="Dixon–Coles-prediksjon for en kamp eller styrkeliste")
    msrc = m.add_mutually_exclusive_group(required=True)
    msrc.add_argument("--sample", action="store_true")
    msrc.add_argument("--results")
    m.add_argument("--half-life", type=float, default=180)
    m.add_argument("home", nargs="?")
    m.add_argument("away", nargs="?")
    m.set_defaults(func=cmd_model)

    bt = sub.add_parser("backtest", help="test strategiene på historiske data (football-data.co.uk)")
    bt.add_argument("--file")
    bt.add_argument("--league", default="E0", help="E0=PL, E1, SP1, D1, I1, F1, N1, SC0")
    bt.add_argument("--season", default="2425", help="f.eks. 2425 for 2024/25")
    bt.add_argument("--soft", default="B365", help="bok vi spiller hos: B365, BW, WH, 1XB, Max (beste pris)")
    bt.add_argument("--warmup", type=int, default=100)
    bt.add_argument("--min-edge", type=float, default=0.02)
    bt.add_argument("--model-weight", type=float, default=0.3)
    bt.add_argument("--half-life", type=float, default=180)
    bt.set_defaults(func=cmd_backtest)

    sp = sub.add_parser("sports", help="list sportsnøkler fra The Odds API")
    sp.set_defaults(func=lambda a: [print(f"{x['key']:<40}{x['title']}") for x in data.list_sports()])

    a = ap.parse_args(argv)
    a.func(a)


if __name__ == "__main__":
    main()
