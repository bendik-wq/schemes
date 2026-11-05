"""Statistiske modeller som gir egne sannsynligheter.

* DixonColes: Poisson-modell for fotball med angreps-/forsvarsstyrke per lag,
  hjemmefordel, tidsvekting (nyere kamper teller mer) og Dixon–Coles-korreksjon
  for lave resultater (0-0, 1-0, 0-1, 1-1). Gir full resultatmatrise, og dermed
  1X2, over/under, BTTS, handicap og kombinasjoner i samme kamp.
* Elo: enkel rating for to-veis-idretter (tennis, basket, esport osv).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, datetime
from typing import Callable, Iterable


@dataclass
class Match:
    date: date
    home: str
    away: str
    home_goals: int
    away_goals: int


def _poisson(k: int, lam: float) -> float:
    return math.exp(-lam) * lam ** k / math.factorial(k)


def _tau(x: int, y: int, lam: float, mu: float, rho: float) -> float:
    if x == 0 and y == 0:
        return 1 - lam * mu * rho
    if x == 0 and y == 1:
        return 1 + lam * rho
    if x == 1 and y == 0:
        return 1 + mu * rho
    if x == 1 and y == 1:
        return 1 - rho
    return 1.0


class DixonColes:
    def __init__(self, half_life_days: float = 180.0, prior_strength: float = 2.0, max_goals: int = 10):
        self.xi = math.log(2) / half_life_days
        self.prior = prior_strength   # krymper lag med få kamper mot gjennomsnittet
        self.max_goals = max_goals
        self.attack: dict[str, float] = {}
        self.defence: dict[str, float] = {}
        self.home_adv = 0.25
        self.rho = 0.0

    # ---------- tilpasning ----------
    def fit(self, matches: Iterable[Match], as_of: date | None = None, iters: int = 100) -> "DixonColes":
        ms = list(matches)
        if not ms:
            raise ValueError("ingen kamper å trene på")
        as_of = as_of or max(m.date for m in ms)
        w = [math.exp(-self.xi * max((as_of - m.date).days, 0)) for m in ms]
        teams = sorted({m.home for m in ms} | {m.away for m in ms})
        att = {t: 0.0 for t in teams}
        dfn = {t: 0.0 for t in teams}
        home = 0.25
        k = self.prior

        for _ in range(iters):
            # Koordinatvis maksimal likelihood: for Poisson med log-lenke har hvert
            # parameter en lukket løsning når de andre holdes fast.
            num = {t: k for t in teams}
            den = {t: k for t in teams}
            for m, wi in zip(ms, w):
                num[m.home] += wi * m.home_goals
                den[m.home] += wi * math.exp(home + dfn[m.away])
                num[m.away] += wi * m.away_goals
                den[m.away] += wi * math.exp(dfn[m.home])
            att = {t: math.log(num[t] / den[t]) for t in teams}

            num = {t: k for t in teams}
            den = {t: k for t in teams}
            for m, wi in zip(ms, w):
                num[m.home] += wi * m.away_goals
                den[m.home] += wi * math.exp(att[m.away])
                num[m.away] += wi * m.home_goals
                den[m.away] += wi * math.exp(home + att[m.home])
            dfn = {t: math.log(num[t] / den[t]) for t in teams}

            hn = sum(wi * m.home_goals for m, wi in zip(ms, w))
            hd = sum(wi * math.exp(att[m.home] + dfn[m.away]) for m, wi in zip(ms, w))
            home = math.log(hn / hd)

            mean_att = sum(att.values()) / len(att)
            att = {t: v - mean_att for t, v in att.items()}
            dfn = {t: v + mean_att for t, v in dfn.items()}

        self.attack, self.defence, self.home_adv = att, dfn, home

        # rho via enkel rutenett-søk på Dixon–Coles-likelihood.
        def ll(rho: float) -> float:
            total = 0.0
            for m, wi in zip(ms, w):
                lam, mu = self.rates(m.home, m.away)
                t = _tau(m.home_goals, m.away_goals, lam, mu, rho)
                if t <= 0:
                    return -math.inf
                total += wi * math.log(t)
            return total

        self.rho = max((r / 100 for r in range(-25, 16)), key=ll)
        return self

    # ---------- prediksjon ----------
    def knows(self, team: str) -> bool:
        return team in self.attack

    def rates(self, home: str, away: str) -> tuple[float, float]:
        lam = math.exp(self.home_adv + self.attack[home] + self.defence[away])
        mu = math.exp(self.attack[away] + self.defence[home])
        return lam, mu

    def score_matrix(self, home: str, away: str) -> list[list[float]]:
        lam, mu = self.rates(home, away)
        n = self.max_goals + 1
        mat = [[_poisson(x, lam) * _poisson(y, mu) * _tau(x, y, lam, mu, self.rho) for y in range(n)] for x in range(n)]
        s = sum(map(sum, mat))
        return [[v / s for v in row] for row in mat]

    def joint(self, home: str, away: str, event: Callable[[int, int], bool]) -> float:
        """Sannsynlighet for en vilkårlig hendelse på resultatet, f.eks.
        `lambda h, a: h > a and h + a > 2.5` (hjemmeseier OG over 2.5)."""
        mat = self.score_matrix(home, away)
        return sum(p for x, row in enumerate(mat) for y, p in enumerate(row) if event(x, y))

    def probs_1x2(self, home: str, away: str) -> dict[str, float]:
        return {
            home: self.joint(home, away, lambda h, a: h > a),
            "Draw": self.joint(home, away, lambda h, a: h == a),
            away: self.joint(home, away, lambda h, a: h < a),
        }

    def probs_total(self, home: str, away: str, line: float) -> dict[str, float]:
        """Over/under. På hele linjer (f.eks. 2.0) fjernes push, så tallene er
        betinget på at spillet ikke blir annullert (gir riktig fortegn på EV)."""
        over = self.joint(home, away, lambda h, a: h + a > line)
        under = self.joint(home, away, lambda h, a: h + a < line)
        s = over + under
        return {"Over": over / s, "Under": under / s}

    def probs_spread(self, home: str, away: str, home_line: float) -> dict[str, float]:
        win = self.joint(home, away, lambda h, a: h - a + home_line > 0)
        lose = self.joint(home, away, lambda h, a: h - a + home_line < 0)
        s = win + lose
        return {home: win / s, away: lose / s}

    def probs_btts(self, home: str, away: str) -> dict[str, float]:
        yes = self.joint(home, away, lambda h, a: h > 0 and a > 0)
        return {"Yes": yes, "No": 1 - yes}

    def ratings(self) -> list[tuple[str, float, float]]:
        """(lag, angrep, forsvar) sortert etter netto styrke. Lavt forsvar = bra."""
        return sorted(((t, self.attack[t], self.defence[t]) for t in self.attack),
                      key=lambda r: r[1] - r[2], reverse=True)


def model_probs_for_markets(model: DixonColes, markets) -> dict[tuple, dict[str, float]]:
    """Lag modell-sannsynligheter for alle markeder der begge lag er kjent."""
    out = {}
    for m in markets:
        if not (model.knows(m.home) and model.knows(m.away)):
            continue
        if m.market == "h2h":
            p = model.probs_1x2(m.home, m.away)
        elif m.market == "totals" and m.line is not None:
            p = model.probs_total(m.home, m.away, m.line)
        elif m.market == "spreads" and m.line is not None:
            p = model.probs_spread(m.home, m.away, m.line)
        else:
            continue
        out[(m.event_id, m.market, m.line)] = p
    return out


class Elo:
    """Elo for to-veis-markeder. Margin-justert oppdatering (større seier = større flytt)."""

    def __init__(self, k: float = 20.0, home_adv: float = 60.0, start: float = 1500.0):
        self.k, self.home_adv, self.start = k, home_adv, start
        self.r: dict[str, float] = {}

    def rating(self, team: str) -> float:
        return self.r.get(team, self.start)

    def win_prob(self, home: str, away: str, neutral: bool = False) -> float:
        diff = self.rating(home) - self.rating(away) + (0 if neutral else self.home_adv)
        return 1 / (1 + 10 ** (-diff / 400))

    def update(self, home: str, away: str, home_score: float, away_score: float, neutral: bool = False) -> None:
        exp = self.win_prob(home, away, neutral)
        actual = 1.0 if home_score > away_score else 0.0 if home_score < away_score else 0.5
        mov = math.log(abs(home_score - away_score) + 1) + 1
        delta = self.k * mov * (actual - exp)
        self.r[home] = self.rating(home) + delta
        self.r[away] = self.rating(away) - delta


def parse_date(s: str) -> date:
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d/%m/%y", "%d.%m.%Y"):
        try:
            return datetime.strptime(s.strip(), fmt).date()
        except ValueError:
            pass
    raise ValueError(f"ukjent datoformat: {s}")
