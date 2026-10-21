"""«Sannsynlig» parlay: høyest mulig treffsjanse for en ønsket samlet odds.

1. For hver kamp tilpasses forventede mål (lambda, mu) slik at en Dixon–Coles-
   resultatmatrise gjenskaper skarpe markedspriser (Pinnacle uten margin, ellers
   medianen av markedet) på 1X2, over/under-linjer og begge lag scorer.
2. Matrisen gir sannsynligheten for alle spilltyper: over/under på alle linjer,
   dobbelsjanse, handicap, begge lag scorer.
3. Ett spill per kamp (uavhengige kamper), alle hos samme bok, velges slik at
   treffsjansen blir størst mulig for minst ønsket samlet odds.

Bare spill uten push brukes (halve linjer, ikke draw-no-bet eller hele/kvarte linjer).
"""
from __future__ import annotations

import math
import statistics
from dataclasses import dataclass
from typing import Callable

from .markets import COMMISSION, net_odds
from .models import _poisson, _tau
from .odds import devig
SHARP_TITLE = "Pinnacle"
MAX_GOALS = 10


def score_matrix(lam: float, mu: float, rho: float = 0.0) -> list[list[float]]:
    n = MAX_GOALS + 1
    m = [[_poisson(x, lam) * _poisson(y, mu) * _tau(x, y, lam, mu, rho) for y in range(n)] for x in range(n)]
    s = sum(map(sum, m))
    return [[v / s for v in row] for row in m]


def prob(mat, fn: Callable[[int, int], bool]) -> float:
    return sum(p for x, row in enumerate(mat) for y, p in enumerate(row) if fn(x, y))


@dataclass
class Leg:
    match: str
    event_id: str
    kind: str          # Resultat, Dobbelsjanse, Over/Under, Begge scorer, Handicap
    label: str
    fn: Callable[[int, int], bool]
    prices: dict[str, float]   # bok -> odds
    p_model: float = 0.0
    p_sharp: float | None = None

    @property
    def p(self) -> float:
        # Direkte skarp pris når den finnes, ellers modellen.
        return self.p_sharp if self.p_sharp is not None else self.p_model


def _half(point) -> bool:
    return point is not None and abs(point * 2 - round(point * 2)) < 1e-9 and round(point * 2) % 2 == 1


def legs_for_event(ev: dict) -> tuple[dict[tuple, Leg], dict]:
    home, away = ev["home_team"], ev["away_team"]
    match = f"{home} – {away}"
    raw: dict[tuple, dict[str, float]] = {}   # (kind, label-key) -> bok -> odds
    fns: dict[tuple, tuple[str, str, Callable]] = {}

    def add(key, kind, label, fn, book, price):
        raw.setdefault(key, {})[book] = price
        fns[key] = (kind, label, fn)

    for bm in ev.get("bookmakers", []):
        book = bm.get("title") or bm["key"]
        c = COMMISSION.get(book, 0.0)
        for mk in bm.get("markets", []):
            k = mk["key"]
            for o in mk["outcomes"]:
                if float(o.get("price") or 0) <= 1.0:
                    continue   # ugyldig/stengt pris
                price = net_odds(float(o["price"]), c) if c else float(o["price"])
                name, pt = o["name"], o.get("point")
                if k == "h2h":
                    fn = {home: lambda h, a: h > a, away: lambda h, a: h < a, "Draw": lambda h, a: h == a}.get(name)
                    if fn:
                        add(("h2h", name), "Resultat", "Uavgjort" if name == "Draw" else f"{name} vinner", fn, book, price)
                elif k == "double_chance":
                    if name == f"{home} or Draw":
                        add(("dc", "1X"), "Dobbelsjanse", f"{home} eller uavgjort", lambda h, a: h >= a, book, price)
                    elif name == f"{away} or Draw":
                        add(("dc", "X2"), "Dobbelsjanse", f"{away} eller uavgjort", lambda h, a: h <= a, book, price)
                    elif name in (f"{home} or {away}", f"{away} or {home}"):
                        add(("dc", "12"), "Dobbelsjanse", "Ikke uavgjort", lambda h, a: h != a, book, price)
                elif k in ("totals", "alternate_totals") and _half(pt):
                    if name == "Over":
                        add(("tot", "O", pt), "Over/Under", f"Over {pt} mål", lambda h, a, t=pt: h + a > t, book, price)
                    elif name == "Under":
                        add(("tot", "U", pt), "Over/Under", f"Under {pt} mål", lambda h, a, t=pt: h + a < t, book, price)
                elif k == "btts":
                    if name == "Yes":
                        add(("btts", "Y"), "Begge scorer", "Begge lag scorer", lambda h, a: h > 0 and a > 0, book, price)
                    elif name == "No":
                        add(("btts", "N"), "Begge scorer", "Ikke begge lag scorer", lambda h, a: h == 0 or a == 0, book, price)
                elif k in ("spreads", "alternate_spreads") and _half(pt):
                    if name == home:
                        add(("hc", home, pt), "Handicap", f"{home} {pt:+g}", lambda h, a, t=pt: h - a + t > 0, book, price)
                    elif name == away:
                        add(("hc", away, pt), "Handicap", f"{away} {pt:+g}", lambda h, a, t=pt: a - h + t > 0, book, price)

    legs = {key: Leg(match, ev["id"], *fns[key], prices=prices) for key, prices in raw.items()}
    return legs, _sharp_targets(legs, home, away)


def _pair_devig(a: dict[str, float] | None, b: dict[str, float] | None, book: str) -> float | None:
    if a and b and book in a and book in b:
        return devig([a[book], b[book]], "shin")[0]
    return None


def _consensus_pair(a: dict[str, float] | None, b: dict[str, float] | None) -> float | None:
    if not a or not b:
        return None
    books = [bk for bk in a if bk in b and 1.0 < 1 / a[bk] + 1 / b[bk] < 1.15]
    if len(books) < 3:
        return None
    return statistics.median(devig([a[bk], b[bk]], "shin")[0] for bk in books)


def _sharp_targets(legs: dict[tuple, Leg], home: str, away: str) -> dict:
    """Skarpe sannsynligheter (Pinnacle uten margin, ellers konsensus) per leg-nøkkel."""
    get = lambda k: legs[k].prices if k in legs else None
    targets: dict[tuple, float] = {}
    hk, dk, ak = ("h2h", home), ("h2h", "Draw"), ("h2h", away)
    if all(k in legs for k in (hk, dk, ak)):
        books = [b for b in legs[hk].prices if b in legs[dk].prices and b in legs[ak].prices]
        src = [SHARP_TITLE] if SHARP_TITLE in books else books
        trip = [devig([legs[hk].prices[b], legs[dk].prices[b], legs[ak].prices[b]], "shin") for b in src
                if 1.0 < sum(1 / legs[k].prices[b] for k in (hk, dk, ak)) < 1.2]
        if trip:
            ph, px, pa = (statistics.median(t[i] for t in trip) for i in range(3))
            s = ph + px + pa
            targets.update({hk: ph / s, dk: px / s, ak: pa / s,
                            ("dc", "1X"): (ph + px) / s, ("dc", "X2"): (pa + px) / s, ("dc", "12"): (ph + pa) / s})
    pairs = [(("btts", "Y"), ("btts", "N"))]
    pairs += [(k, ("tot", "U", k[2])) for k in legs if k[0] == "tot" and k[1] == "O"]
    pairs += [(k, ("hc", away, -k[2])) for k in legs if k[0] == "hc" and k[1] == home]
    for ka, kb in pairs:
        p = _pair_devig(get(ka), get(kb), SHARP_TITLE)
        if p is None:
            p = _consensus_pair(get(ka), get(kb))
        if p is not None:
            targets[ka], targets[kb] = p, 1 - p
    return targets



def fit_goals(legs: dict[tuple, Leg], targets: dict) -> tuple[float, float, float, float]:
    """Finn (lambda, mu, rho) som best gjenskaper de skarpe sannsynlighetene.
    Returnerer også gjennomsnittlig avvik (RMSE) i sannsynlighet."""
    items = [(legs[k].fn, p) for k, p in targets.items() if k in legs and k[0] in ("h2h", "tot", "btts")]
    if not items:
        return 1.4, 1.1, 0.0, float("nan")

    def loss(lam, mu, rho):
        mat = score_matrix(lam, mu, rho)
        return sum((prob(mat, fn) - p) ** 2 for fn, p in items)

    best, best_l = (1.4, 1.1, 0.0), loss(1.4, 1.1, 0.0)
    for step in (0.2, 0.05, 0.01):
        lam0, mu0, rho = best
        for i in range(-6, 7):
            for j in range(-6, 7):
                lam, mu = lam0 + i * step, mu0 + j * step
                if lam > 0.05 and mu > 0.05:
                    l_ = loss(lam, mu, rho)
                    if l_ < best_l:
                        best, best_l = (lam, mu, rho), l_
    lam, mu, _ = best
    for rho in (-0.15, -0.1, -0.05, 0.0, 0.05):
        l_ = loss(lam, mu, rho)
        if l_ < best_l:
            best, best_l = (lam, mu, rho), l_
    return (*best, math.sqrt(best_l / len(items)))


def analyse_event(ev: dict) -> dict:
    legs, targets = legs_for_event(ev)
    lam, mu, rho, err = fit_goals(legs, targets)
    mat = score_matrix(lam, mu, rho)
    for k, l in legs.items():
        l.p_model = prob(mat, l.fn)
        l.p_sharp = targets.get(k)
    return {"match": f"{ev['home_team']} – {ev['away_team']}", "lambda": lam, "mu": mu, "rho": rho,
            "fit_error": err, "legs": list(legs.values())}


@dataclass
class Ticket:
    book: str
    legs: list[tuple[Leg, float]]   # (leg, odds)

    @property
    def odds(self) -> float:
        return math.prod(o for _, o in self.legs)

    @property
    def prob(self) -> float:
        return math.prod(l.p for l, _ in self.legs)

    @property
    def edge(self) -> float:
        return self.prob * self.odds - 1


def best_ticket(analyses: list[dict], book: str, target_odds: float, min_leg_edge: float = -0.04,
                min_leg_odds: float = 1.05, min_legs: int = 2) -> Ticket | None:
    """Høyest treffsjanse med samlet odds >= target_odds, ett spill per kamp hos `book`.

    Spill som er priset mer enn `min_leg_edge` under rettferdig pris tas ikke med,
    så kupongen ikke betaler for mye margin.
    """
    per_match = []
    for a in analyses:
        cands = []
        for l in a["legs"]:
            o = l.prices.get(book)
            if o and o >= min_leg_odds and l.p * o - 1 >= min_leg_edge:
                cands.append((l, o))
        per_match.append(cands)

    # Pareto-front over (log-odds, log-sannsynlighet), med mulighet til å hoppe over en kamp.
    front: list[tuple[float, float, list]] = [(0.0, 0.0, [])]
    for cands in per_match:
        nxt = list(front)
        for lo, lp, chosen in front:
            for l, o in cands:
                nxt.append((lo + math.log(o), lp + math.log(l.p), chosen + [(l, o)]))
        nxt.sort(key=lambda t: (-t[0], -t[1]))
        pruned, best_lp = [], -math.inf
        for t in nxt:                      # synkende odds: behold bare om sannsynligheten øker
            if t[1] > best_lp + 1e-12:
                pruned.append(t)
                best_lp = t[1]
        front = pruned
    ok = [t for t in front if t[0] >= math.log(target_odds) - 1e-9 and len(t[2]) >= min_legs]
    if not ok:
        return None
    lo, lp, chosen = max(ok, key=lambda t: t[1])
    return Ticket(book, chosen)
