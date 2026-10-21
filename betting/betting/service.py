"""Funksjoner som returnerer resultater som dict/JSON, brukt av web-grensesnittet."""
from __future__ import annotations

import os
import urllib.request
from pathlib import Path

from . import data
from .arbitrage import find_arbs, find_middles
from .markets import group_markets
from .models import DixonColes, model_probs_for_markets
from .parlay import build_parlays
from .value import find_value_bets

CACHE = Path(os.environ.get("BETTING_CACHE", Path.home() / ".betting_cache"))


def _f(p: dict, k: str, default: float) -> float:
    v = p.get(k)
    return default if v in (None, "") else float(v)


def results_file(league: str, season: str) -> Path:
    from .backtest import results_url
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{league}_{season}.csv"
    if not path.exists():
        urllib.request.urlretrieve(results_url(league, season), path)
    return path


def load_results(league: str, seasons: str) -> list:
    """Resultater for én eller flere sesonger, f.eks. "2526,2627"."""
    out = []
    for season in [x.strip() for x in str(seasons).split(",") if x.strip()]:
        out += data.load_results_csv(results_file(league, season))
    return out


DEFAULT_MODEL_SEASONS = "2526,2627"


def scan(p: dict) -> dict:
    source = p.get("source", "sample")
    warnings: list[str] = []
    if source == "sample":
        events = data.sample_events()
    elif source == "free":
        from .sources import fetch_free
        events = fetch_free(tuple(p.get("brands") or ["ub"]))
    elif source == "events":
        # Odds hentet av nettleseren (GitHub Pages-versjonen) i The Odds API-format.
        events = p.get("events") or []
    elif source == "raw_free":
        # Rådata fra Pinnacle/Kambi hentet av nettleseren.
        from .sources import KAMBI_BRANDS, merge_events, parse_kambi, parse_pinnacle
        raw = p.get("raw") or {}
        parts = []
        if raw.get("pinnacle"):
            parts.append(parse_pinnacle(*raw["pinnacle"]))
        else:
            parts.append([])
            warnings.append("Fikk ikke hentet Pinnacle; value bets mot skarp pris mangler.")
        for brand, payload in (raw.get("kambi") or {}).items():
            parts.append(parse_kambi(payload, KAMBI_BRANDS.get(brand, brand)))
        events = merge_events(*parts) if parts[0] else [e for part in parts for e in part]
        warnings += p.get("fetch_warnings") or []
    elif source == "oddsapi":
        events = []
        for sport in p.get("sports") or ["soccer_epl"]:
            events += data.fetch_odds(sport, api_key=p.get("api_key") or None)
    else:
        raise ValueError(f"ukjent kilde: {source}")

    markets = group_markets(events)
    bankroll = _f(p, "bankroll", 10_000)
    kelly_mult = _f(p, "kelly", 0.25)
    min_edge = _f(p, "min_edge", 0.02)
    model_weight = _f(p, "model_weight", 0.2)

    model_probs = None
    model_info = None
    league = p.get("model_league")
    if source == "sample":
        results = data.simulate_results()
    elif league:
        results = load_results(league, p.get("model_season") or DEFAULT_MODEL_SEASONS)
    else:
        results = None
    if results:
        model = DixonColes().fit(results)
        model_probs = model_probs_for_markets(model, markets)
        model_info = {"matches": len(results), "markets": len(model_probs),
                      "home_adv": model.home_adv, "rho": model.rho}
        if not model_probs:
            warnings.append("Modellen kjente ingen av lagene (sjekk at liga og lagnavn stemmer).")

    arbs = find_arbs(markets, _f(p, "min_arb", 0.0))
    arb_stake = _f(p, "arb_stake", 1000)
    vbs = find_value_bets(markets, min_edge, _f(p, "max_odds", 10.0), method=p.get("devig", "shin"),
                          kelly_mult=kelly_mult, model_probs=model_probs, model_weight=model_weight)
    parlays = build_parlays(vbs, max_odds=_f(p, "max_parlay_odds", 15.0), top=15)

    def arb_row(a):
        stakes = a.stakes(arb_stake, round_to=10)
        pay = a.payouts(stakes)
        return {"match": f"{a.market.home} – {a.market.away}", "market": a.market.market, "line": a.market.line,
                "start": a.market.commence_time, "roi": a.roi,
                "legs": [{"outcome": o, "odds": pr, "book": b, "stake": stakes[o], "profit": pay[o]}
                         for o, (pr, b) in a.legs.items()]}

    model_rows = []
    if model_probs:
        for m in markets:
            mp = model_probs.get((m.event_id, m.market, m.line))
            for o, prob in (mp or {}).items():
                best = m.best_prices().get(o)
                if best:
                    model_rows.append({"match": f"{m.home} – {m.away}", "market": m.market, "line": m.line,
                                       "outcome": o, "odds": best[0], "book": best[1],
                                       "model_odds": 1 / prob, "edge": prob * best[0] - 1})
        model_rows.sort(key=lambda r: r["edge"], reverse=True)

    return {
        "summary": {"events": len(events), "markets": len(markets),
                    "books": sorted({b for m in markets for b in m.prices}), "model": model_info},
        "warnings": warnings,
        "arbs": [arb_row(a) for a in arbs],
        "middles": [{"match": f"{x.home} – {x.away}", "over": [x.over_line, *x.over],
                     "under": [x.under_line, *x.under], "table": x.outcome_table(100)}
                    for x in find_middles(markets)],
        "value": [{"match": f"{b.market.home} – {b.market.away}", "market": b.market.market, "line": b.market.line,
                   "start": b.market.commence_time, "outcome": b.outcome, "book": b.bookmaker, "odds": b.odds,
                   "fair_odds": b.fair_odds, "edge": b.edge, "stake": b.kelly_fraction * bankroll,
                   "source": b.source} for b in vbs],
        "parlays": [{"book": x.legs[0].bookmaker, "odds": x.odds, "prob": x.prob, "edge": x.edge,
                     "stake": x.kelly_fraction(kelly_mult) * bankroll,
                     "legs": [{"match": f"{b.market.home} – {b.market.away}", "market": b.market.market, "line": b.market.line,
                               "outcome": b.outcome, "odds": b.odds} for b in x.legs]} for x in parlays],
        "model_vs_market": model_rows[:30],
    }


def _model(p: dict) -> DixonColes:
    if p.get("league"):
        results = load_results(p["league"], p.get("season") or DEFAULT_MODEL_SEASONS)
    else:
        results = data.simulate_results()
    return DixonColes(half_life_days=_f(p, "half_life", 180)).fit(results)


def teams(p: dict) -> dict:
    m = _model(p)
    return {"teams": [{"team": t, "attack": a, "defence": d} for t, a, d in m.ratings()]}


def predict(p: dict) -> dict:
    m = _model(p)
    h, a = p["home"], p["away"]
    for t in (h, a):
        if not m.knows(t):
            raise ValueError(f"ukjent lag: {t}")
    lam, mu = m.rates(h, a)
    rows = [{"label": o if o != "Draw" else "Uavgjort", "prob": pr} for o, pr in m.probs_1x2(h, a).items()]
    for line in (1.5, 2.5, 3.5):
        t = m.probs_total(h, a, line)
        rows += [{"label": f"Over {line}", "prob": t["Over"]}, {"label": f"Under {line}", "prob": t["Under"]}]
    rows.append({"label": "Begge scorer", "prob": m.probs_btts(h, a)["Yes"]})
    rows.append({"label": f"{h} vinner + over 2.5", "prob": m.joint(h, a, lambda x, y: x > y and x + y > 2.5)})
    rows.append({"label": f"{a} vinner + over 2.5", "prob": m.joint(h, a, lambda x, y: x < y and x + y > 2.5)})
    mat = m.score_matrix(h, a)
    scores = sorted(((mat[x][y], f"{x}-{y}") for x in range(6) for y in range(6)), reverse=True)[:8]
    return {"home": h, "away": a, "xg": [lam, mu], "rows": rows,
            "scores": [{"score": s, "prob": pr} for pr, s in scores]}


def backtest(p: dict) -> dict:
    from . import backtest as bt
    path = results_file(p.get("league") or "E0", p.get("season") or "2526")
    res = bt.run(str(path), warmup=int(_f(p, "warmup", 100)), min_edge=_f(p, "min_edge", 0.02),
                 model_weight=_f(p, "model_weight", 0.3), soft=p.get("soft") or "B365")
    out = []
    for l in res["ledgers"]:
        out.append({"name": l.name, "bets": l.bets, "staked": l.staked, "profit": l.profit,
                    "roi": l.profit / l.staked if l.staked else 0.0,
                    "clv": sum(l.clv) / len(l.clv) if l.clv else None})
    return {"matches": res["matches"], "ledgers": out, "logloss": res["logloss"]}
