"""Parlays / kombinasjonsspill.

Viktig matte: bookmakerens margin ganges opp for hvert ben. Fem ben med 5 %
margin hver gir ca. 23 % margin totalt. En parlay er derfor bare lønnsom når
hvert ben selv har positiv forventning, eller når bookmakeren feilpriser
korrelasjon (samme-kamp-kombinasjoner) eller gir boost.
"""
from __future__ import annotations

import itertools
from dataclasses import dataclass
from math import prod

from .odds import expected_value, kelly
from .value import ValueBet


@dataclass
class Parlay:
    legs: list[ValueBet]

    @property
    def odds(self) -> float:
        return prod(b.odds for b in self.legs)

    @property
    def prob(self) -> float:
        # Antar uavhengighet: benene må være fra ulike kamper.
        return prod(b.fair_prob for b in self.legs)

    @property
    def edge(self) -> float:
        return expected_value(self.prob, self.odds)

    def kelly_fraction(self, mult: float = 0.25, cap: float = 0.02) -> float:
        return kelly(self.prob, self.odds, mult, cap)


def compounded_margin(margins: list[float]) -> float:
    """Total margin på en parlay når hvert ben har gitt margin (0.05 = 5 %)."""
    return 1 - prod(1 / (1 + m) for m in margins)


def build_parlays(
    value_bets: list[ValueBet],
    sizes: tuple[int, ...] = (2, 3),
    same_book: bool = True,
    max_odds: float = 15.0,
    top: int = 10,
) -> list[Parlay]:
    """Kombiner +EV-ben fra ulike kamper til parlays.

    `same_book=True` krever at alle ben finnes hos samme bookmaker (det må de
    for å kunne spilles som én kupong). Rangeres etter forventet logaritmisk
    vekst (Kelly), ikke rå EV, så vi ikke bare jager lange odds.
    """
    # Beste ben per (kamp, bok) så vi ikke kombinerer to utfall fra samme kamp.
    groups: dict[str, list[ValueBet]] = {}
    for b in value_bets:
        groups.setdefault(b.bookmaker if same_book else "*", []).append(b)

    parlays = []
    for legs in groups.values():
        for n in sizes:
            for combo in itertools.combinations(legs, n):
                if len({b.market.event_id for b in combo}) < n:
                    continue
                p = Parlay(list(combo))
                if p.odds <= max_odds and p.edge > 0:
                    parlays.append(p)

    def growth(p: Parlay) -> float:
        import math
        f = p.kelly_fraction(1.0, 1.0)
        if f <= 0:
            return 0.0
        return p.prob * math.log(1 + f * (p.odds - 1)) + (1 - p.prob) * math.log(1 - f)

    return sorted(parlays, key=growth, reverse=True)[:top]


def same_game_edge(joint_prob: float, offered_odds: float) -> float:
    """EV på en samme-kamp-kombinasjon. `joint_prob` bør komme fra en modell som
    forstår korrelasjon, f.eks. `DixonColes.joint(...)`. Mange bookmakere
    priser slike kombinasjoner grovt, og det er en klassisk ineffektivitet."""
    return expected_value(joint_prob, offered_odds)
