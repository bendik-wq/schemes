"""Odds-matematikk: konvertering, margin og fjerning av margin (devig).

Alle odds er desimalodds (europeiske), f.eks. 2.10.
"""
from __future__ import annotations

import math
from typing import Sequence


def implied(odds: float) -> float:
    """Implisitt sannsynlighet fra desimalodds (inkluderer bookmakerens margin)."""
    if odds <= 1.0:
        raise ValueError(f"desimalodds må være > 1, fikk {odds}")
    return 1.0 / odds


def american_to_decimal(american: float) -> float:
    return 1 + (american / 100 if american > 0 else 100 / -american)


def fractional_to_decimal(num: float, den: float) -> float:
    return 1 + num / den


def overround(odds: Sequence[float]) -> float:
    """Sum av implisitte sannsynligheter. 1.05 betyr 5 % margin. Under 1 = arbitrasje."""
    return sum(implied(o) for o in odds)


def margin(odds: Sequence[float]) -> float:
    return overround(odds) - 1.0


def _bisect(f, lo: float, hi: float, tol: float = 1e-12, iters: int = 200) -> float:
    flo = f(lo)
    for _ in range(iters):
        mid = (lo + hi) / 2
        fm = f(mid)
        if abs(fm) < tol:
            return mid
        if (fm > 0) == (flo > 0):
            lo, flo = mid, fm
        else:
            hi = mid
    return (lo + hi) / 2


def devig_multiplicative(odds: Sequence[float]) -> list[float]:
    """Proporsjonal normalisering. Enkel, men tar ikke hensyn til favoritt/longshot-skjevhet."""
    q = [implied(o) for o in odds]
    s = sum(q)
    return [x / s for x in q]


def devig_additive(odds: Sequence[float]) -> list[float]:
    """Trekker like mye margin fra hvert utfall. Kan gi negative tall på store longshots."""
    q = [implied(o) for o in odds]
    d = (sum(q) - 1) / len(q)
    return [max(x - d, 1e-9) for x in q]


def devig_power(odds: Sequence[float]) -> list[float]:
    """p_i = q_i^k, der k velges så summen blir 1. Legger mer margin på longshots."""
    q = [implied(o) for o in odds]
    k = _bisect(lambda k: sum(x ** k for x in q) - 1, 0.01, 20.0)
    return [x ** k for x in q]


def devig_shin(odds: Sequence[float]) -> list[float]:
    """Shins metode: modellerer at bookmakeren priser inn innsidehandel.

    Regnes ofte som den mest treffsikre metoden for fotball 1X2 og hest.
    """
    q = [implied(o) for o in odds]
    big_q = sum(q)
    if big_q <= 1.0:
        return devig_multiplicative(odds)

    def probs(z: float) -> list[float]:
        return [
            (math.sqrt(z * z + 4 * (1 - z) * x * x / big_q) - z) / (2 * (1 - z))
            for x in q
        ]

    z = _bisect(lambda z: sum(probs(z)) - 1, 0.0, 0.99)
    return probs(z)


DEVIG_METHODS = {
    "multiplicative": devig_multiplicative,
    "additive": devig_additive,
    "power": devig_power,
    "shin": devig_shin,
}


def devig(odds: Sequence[float], method: str = "shin") -> list[float]:
    if len(odds) < 2:
        raise ValueError("trenger minst to utfall for å fjerne margin")
    return DEVIG_METHODS[method](odds)


def fair_odds(prob: float) -> float:
    return 1.0 / prob


def expected_value(prob: float, odds: float) -> float:
    """Forventet avkastning per krone innsats. 0.05 = +5 %."""
    return prob * odds - 1.0


def kelly(prob: float, odds: float, fraction: float = 0.25, cap: float = 0.05) -> float:
    """Kelly-andel av bankroll. Bruker fraksjonell Kelly og et tak, fordi
    sannsynlighetsestimatet alltid har feil og full Kelly er svært volatil."""
    b = odds - 1.0
    f = (prob * b - (1 - prob)) / b
    return max(0.0, min(f * fraction, cap))


def closing_line_value(taken_odds: float, closing_fair_prob: float) -> float:
    """CLV: hvor mye bedre oddsen du tok var enn den margin-frie sluttkursen.

    Positiv CLV over mange spill er det beste beviset på at du faktisk har en edge,
    langt raskere enn å vente på at resultatene skal jevne seg ut.
    """
    return taken_odds * closing_fair_prob - 1.0
