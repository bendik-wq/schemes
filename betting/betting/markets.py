"""Felles dataformat for odds.

Vi bruker samme format som The Odds API (v4), slik at live-data og
eksempeldata kan behandles likt:

    [{"id", "sport_key", "commence_time", "home_team", "away_team",
      "bookmakers": [{"key", "title", "markets": [
          {"key": "h2h" | "totals" | "spreads",
           "outcomes": [{"name", "price", "point"?}]}]}]}]

`group_markets` gjør dette om til én rad per marked (kamp + markedstype + linje)
med alle bookmakernes priser side om side.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Market:
    event_id: str
    sport: str
    commence_time: str
    home: str
    away: str
    market: str           # h2h, totals, spreads
    line: float | None    # totals: målgrense, spreads: hjemmelagets handicap
    # prices[bookmaker][utfall] = desimalodds
    prices: dict[str, dict[str, float]] = field(default_factory=dict)

    @property
    def label(self) -> str:
        line = "" if self.line is None else f" {self.line:+g}" if self.market == "spreads" else f" {self.line:g}"
        return f"{self.home} – {self.away} [{self.market}{line}]"

    def outcomes(self) -> list[str]:
        seen: list[str] = []
        for book in self.prices.values():
            for name in book:
                if name not in seen:
                    seen.append(name)
        return seen

    def complete_books(self) -> dict[str, dict[str, float]]:
        """Bare bookmakere som har pris på alle utfall (trengs for devig)."""
        outs = self.outcomes()
        return {b: p for b, p in self.prices.items() if all(o in p for o in outs)}

    def best_prices(self) -> dict[str, tuple[float, str]]:
        """Beste odds per utfall på tvers av bookmakere: {utfall: (odds, bookmaker)}."""
        best: dict[str, tuple[float, str]] = {}
        for book, outs in self.prices.items():
            for name, price in outs.items():
                if name not in best or price > best[name][0]:
                    best[name] = (price, book)
        return best


def _outcome_key(market_key: str, outcome: dict, home: str) -> tuple[str, float | None]:
    name = outcome["name"]
    point = outcome.get("point")
    if market_key == "totals":
        return name, point
    if market_key == "spreads":
        # Linjen uttrykkes alltid fra hjemmelagets side.
        line = point if name == home else (-point if point is not None else None)
        return name, line
    return name, None


def group_markets(events: list[dict], markets: tuple[str, ...] = ("h2h", "totals", "spreads")) -> list[Market]:
    grouped: dict[tuple, Market] = {}
    for ev in events:
        for bm in ev.get("bookmakers", []):
            book = bm.get("title") or bm["key"]
            for mk in bm.get("markets", []):
                if mk["key"] not in markets:
                    continue
                for oc in mk["outcomes"]:
                    name, line = _outcome_key(mk["key"], oc, ev["home_team"])
                    key = (ev["id"], mk["key"], line)
                    m = grouped.get(key)
                    if m is None:
                        m = grouped[key] = Market(
                            event_id=ev["id"], sport=ev.get("sport_key", ""),
                            commence_time=ev.get("commence_time", ""),
                            home=ev["home_team"], away=ev["away_team"],
                            market=mk["key"], line=line,
                        )
                    m.prices.setdefault(book, {})[name] = float(oc["price"])
    return list(grouped.values())
