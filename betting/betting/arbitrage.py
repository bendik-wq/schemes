"""Arbitrasje (surebets) og middles på tvers av bookmakere."""
from __future__ import annotations

from dataclasses import dataclass

from .markets import Market
from .odds import implied


@dataclass
class Arb:
    market: Market
    legs: dict[str, tuple[float, str]]   # utfall -> (odds, bookmaker)
    overround: float                      # sum 1/odds, < 1 betyr garantert gevinst

    @property
    def roi(self) -> float:
        """Garantert avkastning på total innsats."""
        return 1.0 / self.overround - 1.0

    def stakes(self, total: float, round_to: float = 0.0) -> dict[str, float]:
        """Fordel innsatsen så utbetalingen blir lik uansett utfall.

        `round_to` runder hver innsats (f.eks. 10 kr) så det ser mindre
        mistenkelig ut hos bookmakeren. Sjekk `payouts` etterpå.
        """
        out = {}
        for name, (price, _) in self.legs.items():
            s = total * implied(price) / self.overround
            if round_to:
                s = round(s / round_to) * round_to
            out[name] = s
        return out

    def payouts(self, stakes: dict[str, float]) -> dict[str, float]:
        total = sum(stakes.values())
        return {n: stakes[n] * self.legs[n][0] - total for n in stakes}


def find_arbs(markets: list[Market], min_roi: float = 0.0) -> list[Arb]:
    arbs = []
    for m in markets:
        outs = m.outcomes()
        if len(outs) < 2:
            continue
        best = m.best_prices()
        if any(o not in best for o in outs):
            continue
        # Et ekte arb krever minst to ulike bookmakere; ellers er det som regel en datafeil.
        if len({book for _, book in best.values()}) < 2:
            continue
        s = sum(implied(best[o][0]) for o in outs)
        if s < 1.0 and (1 / s - 1) >= min_roi:
            arbs.append(Arb(m, {o: best[o] for o in outs}, s))
    return sorted(arbs, key=lambda a: a.roi, reverse=True)


@dataclass
class Middle:
    """Over på lav linje + under på høy linje. Lander resultatet mellom linjene
    vinner begge spillene; ellers taper du litt (eller går i null)."""
    home: str
    away: str
    over_line: float
    over: tuple[float, str]
    under_line: float
    under: tuple[float, str]

    def outcome_table(self, total: float = 100.0) -> dict[str, float]:
        o_price, u_price = self.over[0], self.under[0]
        s_over = total * (1 / o_price) / (1 / o_price + 1 / u_price)
        s_under = total - s_over
        return {
            "kun over vinner": s_over * o_price - total,
            "kun under vinner": s_under * u_price - total,
            "begge vinner (middle)": s_over * o_price + s_under * u_price - total,
        }


def find_middles(markets: list[Market], max_cost: float = 0.03) -> list[Middle]:
    """Finn totals-middles der verste utfall koster maks `max_cost` av innsatsen."""
    by_event: dict[str, list[Market]] = {}
    for m in markets:
        # Bare halve linjer (2.5, 3.5): hele linjer gir push og endrer regnestykket.
        if m.market == "totals" and m.line is not None and m.line % 1 == 0.5:
            by_event.setdefault(m.event_id, []).append(m)
    found = []
    for ms in by_event.values():
        for lo in ms:
            for hi in ms:
                if hi.line <= lo.line:
                    continue
                o = lo.best_prices().get("Over")
                u = hi.best_prices().get("Under")
                if not o or not u:
                    continue
                mid = Middle(lo.home, lo.away, lo.line, o, hi.line, u)
                worst = min(v for k, v in mid.outcome_table(1.0).items() if "middle" not in k)
                if worst >= -max_cost:
                    found.append(mid)
    return found
