"""Mønstersøk i historiske odds og resultater (football-data.co.uk).

Hver hypotese er et filter som velger spill (kamp + utfall). Vi måler avkastning
(ROI) med tre priser per spill:

* MaxC  – beste sluttkurs i markedet (krever mange kontoer, litt optimistisk)
* AvgC  – gjennomsnittlig sluttkurs (det en vanlig spiller får)
* fair  – Pinnacles sluttkurs uten margin (viser om markedet er skjevt priset)

For å skille mønstre fra tilfeldigheter deles dataene i to: mønsteret må være
positivt både i de eldste sesongene (trening) og de nyeste (test), og vi
oppgir z-verdi (antall standardfeil over null).
"""
from __future__ import annotations

import csv
import math
from collections import defaultdict, deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable

from .models import parse_date
from .odds import devig

OUTS = ("H", "D", "A")
TEST_FROM = "2324"     # sesonger fra og med denne er testsett


def _f(row: dict, key: str) -> float | None:
    try:
        v = float(row.get(key) or "")
        return v if v > 1.0 else None
    except ValueError:
        return None


def _triple(row, prefix):
    t = tuple(_f(row, f"{prefix}{o}") for o in OUTS)
    return t if all(t) else None


@dataclass
class Game:
    league: str
    season: str
    date: object
    home: str
    away: str
    hg: int
    ag: int
    hs: int | None
    as_: int | None
    hst: int | None
    ast: int | None
    odds: dict = field(default_factory=dict)   # f.eks. odds["MaxC"]["H"], odds["MaxC"]["O"]
    fair: dict = field(default_factory=dict)   # Pinnacle-sluttkurs uten margin: H/D/A/O/U
    fair_open: dict = field(default_factory=dict)

    @property
    def result(self) -> str:
        return "H" if self.hg > self.ag else "D" if self.hg == self.ag else "A"

    def won(self, sel: str) -> bool:
        if sel in OUTS:
            return self.result == sel
        total = self.hg + self.ag
        return total > 2.5 if sel == "O" else total < 2.5

    @property
    def is_test(self) -> bool:
        return self.season >= TEST_FROM


def load_games(directory: str | Path) -> list[Game]:
    games = []
    for path in sorted(Path(directory).glob("*_*.csv")):
        league, season = path.stem.split("_")
        with open(path, newline="", encoding="utf-8-sig", errors="replace") as f:
            for r in csv.DictReader(f):
                try:
                    g = Game(league, season, parse_date(r["Date"]), r["HomeTeam"], r["AwayTeam"],
                             int(r["FTHG"]), int(r["FTAG"]),
                             *(int(r[k]) if (r.get(k) or "").strip().isdigit() else None
                               for k in ("HS", "AS", "HST", "AST")))
                except (KeyError, ValueError):
                    continue
                for src in ("PS", "PSC", "Max", "MaxC", "Avg", "AvgC", "B365", "B365C"):
                    t = _triple(r, src)
                    if t:
                        g.odds[src] = dict(zip(OUTS, t))
                for src, (o, u) in {"PS": ("P>2.5", "P<2.5"), "PSC": ("PC>2.5", "PC<2.5"),
                                    "Max": ("Max>2.5", "Max<2.5"), "MaxC": ("MaxC>2.5", "MaxC<2.5"),
                                    "Avg": ("Avg>2.5", "Avg<2.5"), "AvgC": ("AvgC>2.5", "AvgC<2.5")}.items():
                    ov, un = _f(r, o), _f(r, u)
                    if ov and un:
                        g.odds.setdefault(src, {}).update({"O": ov, "U": un})
                for src, target in (("PSC", g.fair), ("PS", g.fair_open)):
                    d = g.odds.get(src, {})
                    if all(k in d for k in OUTS) and 1.0 < sum(1 / d[k] for k in OUTS) < 1.15:
                        target.update(zip(OUTS, devig([d[k] for k in OUTS], "shin")))
                    if "O" in d and "U" in d and 1.0 < 1 / d["O"] + 1 / d["U"] < 1.15:
                        p = devig([d["O"], d["U"]], "shin")
                        target.update({"O": p[0], "U": p[1]})
                games.append(g)
    games.sort(key=lambda g: (g.date, g.league))
    return games


@dataclass
class Result:
    name: str
    n: int = 0
    profit: dict = field(default_factory=lambda: defaultdict(float))
    sq: dict = field(default_factory=lambda: defaultdict(float))
    n_src: dict = field(default_factory=lambda: defaultdict(int))
    split: dict = field(default_factory=lambda: {"train": [0, 0.0], "test": [0, 0.0]})
    hit: int = 0
    exp_hit: float = 0.0

    def add(self, g: Game, sel: str, price_src: tuple[str, ...] = ("MaxC", "AvgC")) -> None:
        won = g.won(sel)
        self.n += 1
        self.hit += won
        self.exp_hit += g.fair.get(sel, 0.0)
        for src in price_src:
            o = g.odds.get(src, {}).get(sel)
            if o:
                pr = (o - 1) if won else -1.0
                self.profit[src] += pr
                self.sq[src] += pr * pr
                self.n_src[src] += 1
        o = g.odds.get(price_src[0], {}).get(sel)
        if o:
            s = self.split["test" if g.is_test else "train"]
            s[0] += 1
            s[1] += (o - 1) if won else -1.0

    def roi(self, src: str) -> float:
        n = self.n_src[src]
        return self.profit[src] / n if n else float("nan")

    def z(self, src: str) -> float:
        n = self.n_src[src]
        if n < 2:
            return float("nan")
        mean = self.profit[src] / n
        var = self.sq[src] / n - mean * mean
        return mean / math.sqrt(var / n) if var > 0 else float("nan")

    def split_roi(self, part: str) -> float:
        n, p = self.split[part]
        return p / n if n else float("nan")

    def row(self) -> dict:
        return {"mønster": self.name, "spill": self.n, "treff": self.hit / self.n if self.n else 0,
                "forventet treff": self.exp_hit / self.n if self.n else 0,
                "ROI beste": self.roi("MaxC"), "ROI snitt": self.roi("AvgC"), "z": self.z("MaxC"),
                "ROI trening": self.split_roi("train"), "ROI test": self.split_roi("test")}


Strategy = Callable[[Game], Iterable[str]]


def run(games: list[Game], strategies: dict[str, Strategy], min_n: int = 200) -> list[dict]:
    out = []
    for name, fn in strategies.items():
        r = Result(name)
        for g in games:
            if not g.fair:
                continue
            for sel in fn(g):
                r.add(g, sel)
        if r.n >= min_n:
            out.append(r.row())
    return out


# ---------------- hypoteser ----------------

def _band(x: float, edges: list[float]) -> str | None:
    for lo, hi in zip(edges, edges[1:]):
        if lo <= x < hi:
            return f"{lo:g}–{hi:g}"
    return None


ODDS_BANDS = [1.0, 1.3, 1.6, 2.0, 2.6, 3.5, 5.0, 8.0, 15.0, 100.0]


def odds_band_strategies() -> dict[str, Strategy]:
    """Favoritt/longshot: avkastning per oddsintervall og utfallstype."""
    s = {}
    names = {"H": "Hjemme", "D": "Uavgjort", "A": "Borte"}
    for sel in OUTS:
        for lo, hi in zip(ODDS_BANDS, ODDS_BANDS[1:]):
            def fn(g, sel=sel, lo=lo, hi=hi):
                o = g.odds.get("PSC", {}).get(sel)
                return [sel] if o and lo <= o < hi else []
            s[f"{names[sel]} odds {lo:g}–{hi:g}"] = fn
    return s


def totals_strategies() -> dict[str, Strategy]:
    s = {}
    for sel, name in (("O", "Over 2.5"), ("U", "Under 2.5")):
        for lo, hi in ((0.0, 0.40), (0.40, 0.50), (0.50, 0.60), (0.60, 0.70), (0.70, 1.0)):
            def fn(g, sel=sel, lo=lo, hi=hi):
                p = g.fair.get("O")
                return [sel] if p is not None and lo <= p < hi else []
            s[f"{name}, sanns. for over {lo:.0%}–{hi:.0%}"] = fn
    return s


def league_strategies(games: list[Game]) -> dict[str, Strategy]:
    s = {}
    for lg in sorted({g.league for g in games}):
        for sel, name in (("H", "hjemme"), ("D", "uavgjort"), ("A", "borte"), ("O", "over 2.5"), ("U", "under 2.5")):
            s[f"{lg}: alltid {name}"] = lambda g, lg=lg, sel=sel: [sel] if g.league == lg else []
    return s


def situational_strategies() -> dict[str, Strategy]:
    def home_dog(g):
        o = g.odds.get("PSC", {})
        return ["H"] if o.get("H", 0) > o.get("A", 99) else []

    def away_fav_big(g):
        o = g.odds.get("PSC", {}).get("A")
        return ["A"] if o and o < 1.6 else []

    def tight_low_draw(g):
        f = g.fair
        if not all(k in f for k in ("H", "A", "U")):
            return []
        return ["D"] if abs(f["H"] - f["A"]) < 0.10 and f["U"] > 0.55 else []

    def open_value(g, src="Max", margin=0.03):
        # Handlingsbart: beste åpningskurs over Pinnacles åpningspris uten margin.
        out = []
        for sel in OUTS:
            o, p = g.odds.get(src, {}).get(sel), g.fair_open.get(sel)
            if o and p and o * p - 1 >= margin:
                out.append(sel)
        return out

    def steam(g, thr=0.03):
        # Ikke handlingsbart (bruker sluttkurs), men viser hvor mye kursbevegelser betyr.
        return [s for s in OUTS if s in g.fair and s in g.fair_open and g.fair[s] - g.fair_open[s] >= thr]

    def drift(g, thr=0.03):
        return [s for s in OUTS if s in g.fair and s in g.fair_open and g.fair_open[s] - g.fair[s] >= thr]

    return {
        "Hjemmelag som underdog": home_dog,
        "Bortefavoritt (odds < 1.6)": away_fav_big,
        "Uavgjort i jevne, målfattige kamper": tight_low_draw,
        "Åpnings-value: beste åpningskurs ≥3 % over Pinnacle åpning": open_value,
        "Steam: sannsynlighet steg ≥3 pp fra åpning til slutt (info)": steam,
        "Drift: sannsynlighet falt ≥3 pp (info)": drift,
    }


def form_strategies(games: list[Game], window: int = 6) -> dict[str, Strategy]:
    """Skudd mot mål vs. mål siste kamper. Lag som dominerer skuddene uten å
    score tilsvarende ('uheldige') bør regresjon gi verdi på – om markedet ikke
    allerede priser det inn."""
    hist: dict[tuple, deque] = defaultdict(lambda: deque(maxlen=window))
    feat: dict[int, dict] = {}
    for g in games:   # sortert på dato
        fh, fa = hist[(g.league, g.season, g.home)], hist[(g.league, g.season, g.away)]

        def luck(h):
            if len(h) < window:
                return None
            sf, sa = sum(x[0] for x in h), sum(x[1] for x in h)
            gf, ga = sum(x[2] for x in h), sum(x[3] for x in h)
            if sf + sa == 0 or gf + ga == 0:
                return None
            return sf / (sf + sa) - gf / (gf + ga)   # >0: skuddene bedre enn målene
        feat[id(g)] = {"home": luck(fh), "away": luck(fa)}
        if g.hst is not None and g.ast is not None:
            fh.append((g.hst, g.ast, g.hg, g.ag))
            fa.append((g.ast, g.hst, g.ag, g.hg))

    def unlucky(g, thr=0.15):
        f = feat.get(id(g), {})
        out = []
        if f.get("home") is not None and f["home"] >= thr:
            out.append("H")
        if f.get("away") is not None and f["away"] >= thr:
            out.append("A")
        return out

    def lucky_fade(g, thr=0.15):
        f = feat.get(id(g), {})
        out = []
        # Spill mot heldige lag: ta motstanderen.
        if f.get("home") is not None and f["home"] <= -thr:
            out.append("A")
        if f.get("away") is not None and f["away"] <= -thr:
            out.append("H")
        return out

    return {f"Uheldige lag (skudd på mål-andel ≥15 pp over målandel, siste {window})": unlucky,
            f"Mot heldige lag (målandel ≥15 pp over skudd-andel, siste {window})": lucky_fade}


def early_season_strategies(games: list[Game], first: int = 4) -> dict[str, Strategy]:
    count: dict[tuple, int] = defaultdict(int)
    early: set[int] = set()
    for g in games:
        kh, ka = (g.league, g.season, g.home), (g.league, g.season, g.away)
        if count[kh] < first and count[ka] < first:
            early.add(id(g))
        count[kh] += 1
        count[ka] += 1
    s = {}
    for sel, name in (("H", "hjemme"), ("D", "uavgjort"), ("A", "borte"), ("O", "over 2.5"), ("U", "under 2.5")):
        s[f"Sesongstart (første {first} runder): {name}"] = lambda g, sel=sel: [sel] if id(g) in early else []
    return s


def team_persistence(games: list[Game], top: int = 3) -> dict[str, Strategy]:
    """Lag som var lønnsomme å spille på i fjor: er de det i år også?"""
    seasons = sorted({g.season for g in games})
    prof: dict[tuple, float] = defaultdict(float)
    for g in games:
        for team, sel in ((g.home, "H"), (g.away, "A")):
            o = g.odds.get("AvgC", {}).get(sel)
            if o:
                prof[(g.league, g.season, team)] += (o - 1) if g.won(sel) else -1
    best: set[tuple] = set()
    worst: set[tuple] = set()
    for i, season in enumerate(seasons[1:], 1):
        prev = seasons[i - 1]
        for lg in {g.league for g in games}:
            ranked = sorted(((p, t) for (l, s, t), p in prof.items() if l == lg and s == prev), reverse=True)
            best |= {(lg, season, t) for _, t in ranked[:top]}
            worst |= {(lg, season, t) for _, t in ranked[-top:]}

    def back(g, pool):
        out = []
        if (g.league, g.season, g.home) in pool:
            out.append("H")
        if (g.league, g.season, g.away) in pool:
            out.append("A")
        return out
    return {f"Fjorårets {top} mest lønnsomme lag per liga": lambda g: back(g, best),
            f"Fjorårets {top} minst lønnsomme lag per liga": lambda g: back(g, worst)}


def all_strategies(games: list[Game]) -> dict[str, Strategy]:
    s = {}
    for part in (odds_band_strategies(), totals_strategies(), league_strategies(games),
                 situational_strategies(), form_strategies(games), early_season_strategies(games),
                 team_persistence(games)):
        s.update(part)
    return s
