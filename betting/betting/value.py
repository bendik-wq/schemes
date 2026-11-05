"""Value bets: finn odds som er høyere enn den "sanne" sannsynligheten tilsier.

Kjernen i strategien: skarpe bookmakere (Pinnacle, Betfair-børsen) har lav
margin, tar store innsatser fra profesjonelle og justerer seg raskt. Deres
margin-frie pris er det beste offentlige estimatet på sann sannsynlighet.
Myke bookmakere henger etter, setter priser for markedsføring, eller skjevpriser
populære lag. Når en myk bookmaker gir høyere odds enn den skarpe, fair prisen,
har du positiv forventning.
"""
from __future__ import annotations

import math
import statistics
from dataclasses import dataclass

from .markets import Market
from .odds import devig, expected_value, kelly

DEFAULT_SHARP = ("Pinnacle", "Betfair", "Betfair Exchange", "Circa Sports")


@dataclass
class ValueBet:
    market: Market
    outcome: str
    bookmaker: str
    odds: float
    fair_prob: float
    source: str           # hvor den sanne sannsynligheten kommer fra
    kelly_fraction: float

    @property
    def edge(self) -> float:
        return expected_value(self.fair_prob, self.odds)

    @property
    def fair_odds(self) -> float:
        return 1 / self.fair_prob


def fair_probabilities(
    m: Market,
    sharp_books: tuple[str, ...] = DEFAULT_SHARP,
    method: str = "shin",
    min_books: int = 3,
    max_sharp_dev: float = 0.25,
    max_dev_books: int = 5,
) -> tuple[dict[str, float], str] | None:
    """Sann sannsynlighet per utfall. Skarp bok først, ellers median av markedet."""
    complete = m.complete_books()
    outs = m.outcomes()
    if len(outs) < 2:
        return None
    consensus = None
    if len(complete) >= min_books:
        per_outcome: dict[str, list[float]] = {o: [] for o in outs}
        for prices in complete.values():
            for o, p in zip(outs, devig([prices[o] for o in outs], method)):
                per_outcome[o].append(p)
        med = {o: statistics.median(v) for o, v in per_outcome.items()}
        s = sum(med.values())
        consensus = {o: p / s for o, p in med.items()}

    for sharp in sharp_books:
        if sharp in complete:
            probs = dict(zip(outs, devig([complete[sharp][o] for o in outs], method)))
            # Skiller den skarpe boka seg kraftig fra et bredt marked, er den trolig
            # utdatert eller feil akkurat her. Da er medianen tryggere.
            if consensus and len(complete) >= max_dev_books and any(
                    abs(math.log(probs[o] / consensus[o])) > max_sharp_dev for o in outs):
                return consensus, f"konsensus av {len(complete)} bøker ({sharp} avviker)"
            return probs, sharp
    if consensus is None:
        return None
    return consensus, f"konsensus av {len(complete)} bøker"


def blend(market_probs: dict[str, float], model_probs: dict[str, float], model_weight: float) -> dict[str, float]:
    """Vekt egen modell mot markedet. Markedet er nesten alltid bedre enn en enkel
    modell alene, så hold `model_weight` lav (0.1–0.3) til modellen har bevist seg."""
    out = {o: (1 - model_weight) * market_probs[o] + model_weight * model_probs.get(o, market_probs[o]) for o in market_probs}
    s = sum(out.values())
    return {o: p / s for o, p in out.items()}


def find_value_bets(
    markets: list[Market],
    min_edge: float = 0.02,
    max_odds: float = 10.0,
    sharp_books: tuple[str, ...] = DEFAULT_SHARP,
    method: str = "shin",
    kelly_mult: float = 0.25,
    model_probs: dict[tuple, dict[str, float]] | None = None,
    model_weight: float = 0.2,
) -> list[ValueBet]:
    bets = []
    for m in markets:
        fp = fair_probabilities(m, sharp_books, method)
        if fp is None:
            continue
        probs, source = fp
        key = (m.event_id, m.market, m.line)
        if model_probs and key in model_probs:
            probs = blend(probs, model_probs[key], model_weight)
            source += f" + modell ({model_weight:.0%})"
        for book, prices in m.prices.items():
            if book in sharp_books:
                continue
            for outcome, price in prices.items():
                p = probs.get(outcome)
                if p is None or price > max_odds:
                    continue
                if expected_value(p, price) >= min_edge:
                    bets.append(ValueBet(m, outcome, book, price, p, source, kelly(p, price, kelly_mult)))
    return sorted(bets, key=lambda b: b.edge, reverse=True)
