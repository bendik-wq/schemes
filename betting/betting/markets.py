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
from datetime import datetime, timezone

# Børser tar provisjon av nettogevinsten. Oppgitt odds må justeres ned før
# de sammenlignes med vanlige bookmakere, ellers ser man falske arbitrasjer.
COMMISSION = {"Betfair": 0.05, "Betfair Exchange": 0.05, "Smarkets": 0.02, "Matchbook": 0.02}


# Rimelig spenn for én bookmakers egen sum av 1/odds på et komplett marked.
SANE_OVERROUND = (0.97, 1.25)


def net_odds(price: float, commission: float) -> float:
    return 1 + (price - 1) * (1 - commission)


def _started(commence_time: str, now: datetime) -> bool:
    if not commence_time:
        return False
    try:
        t = datetime.fromisoformat(commence_time.replace("Z", "+00:00"))
    except ValueError:
        return False
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return t <= now


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
        """Bookmakere med fornuftig pris på alle utfall (trengs for devig).

        Bøker der summen av implisitte sannsynligheter er urimelig forkastes.
        Det fanger plassholder-odds fra børser uten omsetning (f.eks. 1.09 på
        alle utfall) og åpenbare tastefeil, som ellers gir falske funn.
        """
        outs = self.outcomes()
        out = {}
        for b, p in self.prices.items():
            if all(o in p for o in outs):
                s = sum(1 / p[o] for o in outs)
                if SANE_OVERROUND[0] <= s <= SANE_OVERROUND[1]:
                    out[b] = p
        return out

    def _suspect_books(self) -> set[str]:
        outs = self.outcomes()
        bad = set()
        for b, p in self.prices.items():
            if all(o in p for o in outs):
                s = sum(1 / p[o] for o in outs)
                if not SANE_OVERROUND[0] <= s <= SANE_OVERROUND[1]:
                    bad.add(b)
        return bad

    def best_prices(self) -> dict[str, tuple[float, str]]:
        """Beste odds per utfall på tvers av bookmakere: {utfall: (odds, bookmaker)}."""
        best: dict[str, tuple[float, str]] = {}
        bad = self._suspect_books()
        for book, outs in self.prices.items():
            if book in bad:
                continue
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


def group_markets(
    events: list[dict],
    markets: tuple[str, ...] = ("h2h", "totals", "spreads"),
    commission: dict[str, float] | None = None,
    skip_started: bool = True,
    now: datetime | None = None,
) -> list[Market]:
    """`skip_started` hopper over kamper som har startet: live-odds fra API-et
    er forsinket og gir falske funn. `commission` justerer børsodds (standard COMMISSION)."""
    commission = COMMISSION if commission is None else commission
    now = now or datetime.now(timezone.utc)
    grouped: dict[tuple, Market] = {}
    for ev in events:
        if skip_started and _started(ev.get("commence_time", ""), now):
            continue
        for bm in ev.get("bookmakers", []):
            book = bm.get("title") or bm["key"]
            c = commission.get(book, 0.0)
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
                    price = float(oc["price"])
                    m.prices.setdefault(book, {})[name] = round(net_odds(price, c), 4) if c else price
    return list(grouped.values())
