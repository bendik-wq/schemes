"""Backtest på historiske data fra football-data.co.uk.

Filene der har både resultater og odds fra flere bookmakere (B365 = Bet365,
PS = Pinnacle, Max = beste pris i markedet; C-kolonner = sluttkurs). Vi tester:

1. Markedsstrategien: spill Bet365 når oddsen er over Pinnacles margin-frie pris.
2. Modellstrategien: spill Bet365 når Dixon–Coles (blandet med markedet) gir edge.
3. Kalibrering: log-loss for modellen mot Pinnacle-markedet. Lavere er bedre.
   Er modellen dårligere enn markedet, skal den ha lav vekt.

Modellen trenes kun på kamper *før* hver kamp (walk-forward), så det er ingen
fremtidslekkasje.
"""
from __future__ import annotations

import csv
import math
from dataclasses import dataclass, field

from .models import DixonColes, Match, parse_date
from .odds import devig, expected_value

LEAGUES = {"E0": "Premier League", "E1": "Championship", "SP1": "La Liga", "D1": "Bundesliga",
           "I1": "Serie A", "F1": "Ligue 1", "N1": "Eredivisie", "SC0": "Skottland"}


def results_url(league: str = "E0", season: str = "2425") -> str:
    return f"https://www.football-data.co.uk/mmz4281/{season}/{league}.csv"


@dataclass
class Row:
    match: Match
    result: int                    # 0 = hjemme, 1 = uavgjort, 2 = borte
    soft: tuple[float, float, float] | None
    sharp: tuple[float, float, float] | None
    sharp_close: tuple[float, float, float] | None


def load_rows(path: str, soft: str = "B365", sharp: str = "PS") -> list[Row]:
    def triple(row, prefix):
        try:
            t = tuple(float(row[f"{prefix}{s}"]) for s in "HDA")
            return t if all(x > 1 for x in t) else None
        except (KeyError, ValueError, TypeError):
            return None

    rows = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            try:
                m = Match(parse_date(r["Date"]), r["HomeTeam"], r["AwayTeam"], int(r["FTHG"]), int(r["FTAG"]))
            except (KeyError, ValueError):
                continue
            res = 0 if m.home_goals > m.away_goals else 1 if m.home_goals == m.away_goals else 2
            rows.append(Row(m, res, triple(r, soft), triple(r, sharp), triple(r, sharp + "C")))
    rows.sort(key=lambda x: x.match.date)
    return rows


@dataclass
class Ledger:
    name: str
    bets: int = 0
    staked: float = 0.0
    profit: float = 0.0
    clv: list[float] = field(default_factory=list)

    def add(self, stake: float, odds: float, won: bool, clv: float | None) -> None:
        self.bets += 1
        self.staked += stake
        self.profit += stake * (odds - 1) if won else -stake
        if clv is not None:
            self.clv.append(clv)

    def summary(self) -> str:
        roi = self.profit / self.staked if self.staked else 0.0
        clv = sum(self.clv) / len(self.clv) if self.clv else float("nan")
        return (f"{self.name:<34} spill {self.bets:>4}  innsats {self.staked:>8.0f}  "
                f"resultat {self.profit:>+8.0f}  ROI {roi:+7.2%}  snitt-CLV {clv:+.2%}")


def run(path: str, warmup: int = 100, min_edge: float = 0.02, model_weight: float = 0.3,
        refit_every: int = 10, half_life: float = 180, stake: float = 100.0, soft: str = "B365") -> dict:
    rows = load_rows(path, soft=soft)
    market = Ledger(f"{soft} > Pinnacle fair (marked)")
    modelled = Ledger(f"Modell {model_weight:.0%} + Pinnacle")
    model_only = Ledger("Kun modell (advarsel: naiv)")
    ll_model = ll_market = ll_blend = 0.0
    n_ll = 0
    model = None

    for i, row in enumerate(rows):
        if i < warmup or not row.sharp:
            continue
        if model is None or i % refit_every == 0:
            model = DixonColes(half_life_days=half_life).fit((r.match for r in rows[:i]), as_of=row.match.date)
        m = row.match
        fair = devig(row.sharp, "shin")
        close = devig(row.sharp_close, "shin") if row.sharp_close else None

        mp = None
        if model.knows(m.home) and model.knows(m.away):
            p = model.probs_1x2(m.home, m.away)
            mp = [p[m.home], p["Draw"], p[m.away]]
            blend = [(1 - model_weight) * a + model_weight * b for a, b in zip(fair, mp)]
            ll_model -= math.log(mp[row.result])
            ll_market -= math.log(fair[row.result])
            ll_blend -= math.log(blend[row.result])
            n_ll += 1

        if not row.soft:
            continue
        for k in range(3):
            o = row.soft[k]
            won = row.result == k
            clv = expected_value(close[k], o) if close else None
            if expected_value(fair[k], o) >= min_edge:
                market.add(stake, o, won, clv)
            if mp:
                if expected_value(blend[k], o) >= min_edge:
                    modelled.add(stake, o, won, clv)
                if expected_value(mp[k], o) >= min_edge:
                    model_only.add(stake, o, won, clv)

    return {
        "matches": len(rows),
        "ledgers": [market, modelled, model_only],
        "logloss": {"modell": ll_model / max(n_ll, 1), "marked (Pinnacle)": ll_market / max(n_ll, 1),
                    f"blanding {model_weight:.0%}": ll_blend / max(n_ll, 1)},
    }
