"""Datakilder: live odds fra The Odds API, resultater fra CSV, og eksempeldata."""
from __future__ import annotations

import csv
import json
import os
import random
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path

from .models import Match, parse_date

ODDS_API = "https://api.the-odds-api.com/v4"


def fetch_odds(
    sport: str = "soccer_epl",
    regions: str = "eu,uk",
    markets: str = "h2h,totals,spreads",
    api_key: str | None = None,
) -> list[dict]:
    """Hent odds fra the-odds-api.com (gratis nøkkel gir 500 kall/mnd).

    Sett nøkkelen i miljøvariabelen ODDS_API_KEY. Sportsnøkler finnes med
    `list_sports()`, f.eks. soccer_epl, soccer_norway_eliteserien,
    soccer_uefa_champs_league, basketball_nba, tennis_atp_*.
    """
    key = api_key or os.environ.get("ODDS_API_KEY")
    if not key:
        raise RuntimeError("mangler ODDS_API_KEY (registrer gratis på the-odds-api.com)")
    q = urllib.parse.urlencode({"apiKey": key, "regions": regions, "markets": markets, "oddsFormat": "decimal"})
    with urllib.request.urlopen(f"{ODDS_API}/sports/{sport}/odds?{q}", timeout=30) as r:
        return json.load(r)


def list_sports(api_key: str | None = None) -> list[dict]:
    key = api_key or os.environ.get("ODDS_API_KEY")
    if not key:
        raise RuntimeError("mangler ODDS_API_KEY")
    with urllib.request.urlopen(f"{ODDS_API}/sports?apiKey={key}", timeout=30) as r:
        return json.load(r)


def load_events(path: str | Path) -> list[dict]:
    return json.loads(Path(path).read_text())


def load_results_csv(path: str | Path) -> list[Match]:
    """Les resultater. Støtter football-data.co.uk-formatet direkte
    (Date, HomeTeam, AwayTeam, FTHG, FTAG) og enkle kolonner
    (date, home, away, home_goals, away_goals)."""
    out = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            try:
                if "HomeTeam" in row:
                    m = Match(parse_date(row["Date"]), row["HomeTeam"], row["AwayTeam"], int(row["FTHG"]), int(row["FTAG"]))
                else:
                    m = Match(parse_date(row["date"]), row["home"], row["away"], int(row["home_goals"]), int(row["away_goals"]))
            except (KeyError, ValueError):
                continue   # hopp over tomme/ufullstendige rader
            out.append(m)
    return out


# ---------------- eksempeldata (offline demo) ----------------

TEAMS = {
    # lag: (angrep, forsvar) — "sann" styrke brukt til å simulere en sesong
    "Bodø/Glimt": (0.45, -0.35), "Brann": (0.30, -0.20), "Molde": (0.25, -0.15),
    "Rosenborg": (0.10, -0.05), "Viking": (0.20, 0.00), "Vålerenga": (0.00, 0.05),
    "Lillestrøm": (-0.05, 0.05), "Sarpsborg 08": (-0.10, 0.10), "Tromsø": (-0.10, 0.00),
    "Fredrikstad": (-0.15, 0.05), "HamKam": (-0.20, 0.15), "KFUM Oslo": (-0.25, 0.10),
}


def _poisson_sample(rng: random.Random, lam: float) -> int:
    import math
    L, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= L:
            return k
        k += 1


def simulate_results(seasons: int = 2, seed: int = 7, start: date = date(2024, 4, 1)) -> list[Match]:
    import math
    rng = random.Random(seed)
    teams = list(TEAMS)
    out, d = [], start
    for _ in range(seasons):
        for _ in range(2):
            fixtures = [(h, a) for h in teams for a in teams if h != a]
            rng.shuffle(fixtures)
            for h, a in fixtures:
                lam = math.exp(0.25 + TEAMS[h][0] + TEAMS[a][1])
                mu = math.exp(TEAMS[a][0] + TEAMS[h][1])
                out.append(Match(d, h, a, _poisson_sample(rng, lam), _poisson_sample(rng, mu)))
                d += timedelta(days=1)
    return out


def sample_events() -> list[dict]:
    """Håndlagde odds med en arbitrasje, flere value-spill og en middle innbakt."""
    def book(title, h2h=None, totals=None, spreads=None):
        mk = []
        if h2h:
            mk.append({"key": "h2h", "outcomes": [{"name": n, "price": p} for n, p in h2h]})
        for line, o, u in totals or []:
            mk.append({"key": "totals", "outcomes": [{"name": "Over", "price": o, "point": line},
                                                      {"name": "Under", "price": u, "point": line}]})
        for home, away, line, hp, ap in spreads or []:
            mk.append({"key": "spreads", "outcomes": [{"name": home, "price": hp, "point": line},
                                                       {"name": away, "price": ap, "point": -line}]})
        return {"key": title.lower().replace(" ", "_"), "title": title, "markets": mk}

    def ev(i, home, away, books):
        return {"id": f"ev{i}", "sport_key": "soccer_norway_eliteserien",
                "commence_time": f"2026-10-2{4 + i % 3}T17:00:00Z",
                "home_team": home, "away_team": away, "bookmakers": books}

    H, A = "Bodø/Glimt", "Rosenborg"
    e1 = ev(1, H, A, [
        book("Pinnacle", [(H, 1.62), ("Draw", 4.45), (A, 5.60)], [(2.5, 1.66, 2.33), (3.5, 2.55, 1.56)]),
        book("Unibet", [(H, 1.57), ("Draw", 4.30), (A, 5.50)], [(2.5, 1.62, 2.25)]),
        book("Bet365", [(H, 1.60), ("Draw", 4.20), (A, 6.25)], [(2.5, 1.64, 2.30)]),
        book("Norsk Tipping", [(H, 1.55), ("Draw", 4.00), (A, 5.00)], [(2.5, 1.60, 2.10)]),
        book("Betsson", [(H, 1.61), ("Draw", 4.40), (A, 5.40)], [(3.5, 2.75, 1.50)]),
    ])
    H, A = "Brann", "Molde"
    e2 = ev(2, H, A, [
        book("Pinnacle", [(H, 2.30), ("Draw", 3.55), (A, 3.15)], [(2.5, 1.85, 2.02)]),
        book("Unibet", [(H, 2.45), ("Draw", 3.40), (A, 3.00)], [(2.5, 1.80, 2.00)]),
        book("Bet365", [(H, 2.25), ("Draw", 3.75), (A, 3.05)], [(2.5, 1.83, 2.00)]),
        book("Betsson", [(H, 2.28), ("Draw", 3.45), (A, 3.40)], [(2.5, 1.84, 2.10)]),
        book("Norsk Tipping", [(H, 2.15), ("Draw", 3.30), (A, 2.90)]),
    ])
    H, A = "Viking", "Vålerenga"
    e3 = ev(3, H, A, [
        book("Pinnacle", [(H, 1.95), ("Draw", 3.80), (A, 3.90)], [(2.5, 1.62, 2.40), (3.0, 1.93, 1.95)],
             [(H, A, -0.5, 1.95, 1.95)]),
        book("Unibet", [(H, 1.90), ("Draw", 3.75), (A, 3.85)], [(3.0, 1.90, 1.92)], [(H, A, -0.5, 1.90, 1.92)]),
        book("Bet365", [(H, 1.92), ("Draw", 3.70), (A, 3.85)], [(2.5, 1.60, 2.37)], [(H, A, -0.5, 1.92, 1.95)]),
        book("Betsson", [(H, 2.05), ("Draw", 3.60), (A, 3.70)], [(2.5, 1.58, 2.35)], [(H, A, -0.5, 2.04, 1.78)]),
    ])
    H, A = "Tromsø", "Fredrikstad"
    e4 = ev(4, H, A, [
        book("Pinnacle", [(H, 2.20), ("Draw", 3.35), (A, 3.55)], [(2.5, 2.05, 1.82)]),
        book("Unibet", [(H, 2.18), ("Draw", 3.30), (A, 3.50)], [(2.5, 2.00, 1.80)]),
        book("Bet365", [(H, 2.15), ("Draw", 3.40), (A, 3.60)], [(2.5, 2.18, 1.75)]),
        book("Betsson", [(H, 2.22), ("Draw", 3.25), (A, 3.45)], [(2.5, 2.02, 1.80)]),
    ])
    return [e1, e2, e3, e4]
