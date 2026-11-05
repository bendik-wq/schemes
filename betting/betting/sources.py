"""Odds uten API-nøkkel, fra datastrømmene bookmakernes egne nettsider bruker.

* Pinnacle (guest.api.arcadia.pinnacle.com) – skarp referanse
* Kambi (Unibet, Paf, LeoVegas m.fl.) – myk bok

Dette er ikke offisielle API-er. Bruk kan bryte bookmakernes vilkår, og
formatet kan endres uten varsel. Hent sjelden (ikke oftere enn hvert minutt).

Alt gjøres om til samme format som The Odds API, og kampene matches på tvers
av kilder via lagnavn (normalisert + fuzzy) og avsparkstid.
"""
from __future__ import annotations

import difflib
import json
import re
import unicodedata
import urllib.request
from datetime import datetime, timezone

UA = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
PINNACLE = "https://guest.api.arcadia.pinnacle.com/0.1"
KAMBI = "https://eu-offering-api.kambicdn.com/offering/v2018"
KAMBI_BRANDS = {"ub": "Unibet", "paf": "Paf", "leo": "LeoVegas"}


def _get(url: str) -> object:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def american_to_decimal(a: float) -> float:
    return round(1 + (a / 100 if a > 0 else 100 / -a), 4)


def _ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)


# ---------------- Pinnacle ----------------

def parse_pinnacle(matchups: list[dict], markets: list[dict]) -> list[dict]:
    games = {}
    for m in matchups:
        if m.get("type") != "matchup" or m.get("parentId") or m.get("isLive"):
            continue
        parts = {p.get("alignment"): p.get("name") for p in m.get("participants", [])}
        if "home" not in parts or "away" not in parts:
            continue
        games[m["id"]] = {
            "id": f"pin{m['id']}", "sport_key": "soccer",
            "league": (m.get("league") or {}).get("name", ""),
            "commence_time": m.get("startTime", ""),
            "home_team": parts["home"], "away_team": parts["away"], "_mk": [],
        }
    for mk in markets:
        g = games.get(mk.get("matchupId"))
        if not g or mk.get("period") != 0 or mk.get("status", "open") != "open":
            continue
        prices = {p["designation"]: p for p in mk.get("prices", []) if "designation" in p}
        t = mk.get("type")
        if t == "moneyline" and {"home", "away", "draw"} <= prices.keys():
            g["_mk"].append({"key": "h2h", "outcomes": [
                {"name": g["home_team"], "price": american_to_decimal(prices["home"]["price"])},
                {"name": "Draw", "price": american_to_decimal(prices["draw"]["price"])},
                {"name": g["away_team"], "price": american_to_decimal(prices["away"]["price"])}]})
        elif t == "total" and {"over", "under"} <= prices.keys():
            pt = prices["over"].get("points")
            g["_mk"].append({"key": "totals", "outcomes": [
                {"name": "Over", "price": american_to_decimal(prices["over"]["price"]), "point": pt},
                {"name": "Under", "price": american_to_decimal(prices["under"]["price"]), "point": pt}]})
        elif t == "spread" and {"home", "away"} <= prices.keys():
            pt = prices["home"].get("points")
            g["_mk"].append({"key": "spreads", "outcomes": [
                {"name": g["home_team"], "price": american_to_decimal(prices["home"]["price"]), "point": pt},
                {"name": g["away_team"], "price": american_to_decimal(prices["away"]["price"]), "point": -pt}]})
    out = []
    for g in games.values():
        mks = g.pop("_mk")
        if mks:
            g["bookmakers"] = [{"key": "pinnacle", "title": "Pinnacle", "markets": mks}]
            out.append(g)
    return out


def fetch_pinnacle(sport_id: int = 29) -> list[dict]:
    """sport_id 29 = fotball."""
    return parse_pinnacle(_get(f"{PINNACLE}/sports/{sport_id}/matchups"),
                          _get(f"{PINNACLE}/sports/{sport_id}/markets/straight"))


# ---------------- Kambi ----------------

def parse_kambi(data: dict, title: str = "Unibet") -> list[dict]:
    out = []
    for item in data.get("events", []):
        ev = item.get("event", {})
        if ev.get("state") not in (None, "NOT_STARTED") or "homeName" not in ev:
            continue
        home, away = ev["homeName"], ev["awayName"]
        mks = []
        for bo in item.get("betOffers", []):
            label = (bo.get("criterion") or {}).get("englishLabel") or (bo.get("criterion") or {}).get("label", "")
            outs = [o for o in bo.get("outcomes", []) if o.get("status", "OPEN") == "OPEN" and "odds" in o]
            if label in ("Full Time", "Match Odds", "1X2") and len(outs) == 3:
                names = {"OT_ONE": home, "OT_CROSS": "Draw", "OT_TWO": away}
                if all(o.get("type") in names for o in outs):
                    mks.append({"key": "h2h", "outcomes": [
                        {"name": names[o["type"]], "price": o["odds"] / 1000} for o in outs]})
            elif label == "Total Goals" and len(outs) == 2:
                names = {"OT_OVER": "Over", "OT_UNDER": "Under"}
                if all(o.get("type") in names and "line" in o for o in outs):
                    mks.append({"key": "totals", "outcomes": [
                        {"name": names[o["type"]], "price": o["odds"] / 1000, "point": o["line"] / 1000} for o in outs]})
        if mks:
            out.append({
                "id": f"kambi{ev['id']}", "sport_key": "soccer",
                "league": ev.get("group", ""), "commence_time": ev.get("start", ""),
                "home_team": home, "away_team": away,
                "bookmakers": [{"key": title.lower(), "title": title, "markets": mks}],
            })
    return out


def fetch_kambi(brand: str = "ub") -> list[dict]:
    url = (f"{KAMBI}/{brand}/listView/football/all/all/all/matches.json"
           "?lang=en_GB&market=GB&useCombined=true")
    return parse_kambi(_get(url), KAMBI_BRANDS.get(brand, brand))


# ---------------- sammenslåing ----------------

_STOP = {"fc", "fk", "if", "sk", "afc", "cf", "sc", "ac", "bk", "il", "the", "club", "de", "calcio", "1"}


def norm_team(name: str) -> str:
    s = name.lower().translate(str.maketrans({"ø": "o", "æ": "ae", "ß": "ss", "ł": "l", "đ": "d"}))
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = s.replace("&", " and ").replace("utd", "united")
    words = [w for w in re.split(r"[^a-z0-9]+", s) if w and w not in _STOP]
    return " ".join(words)


def _same_team(a: str, b: str) -> float:
    na, nb = norm_team(a), norm_team(b)
    if not na or not nb:
        return 0.0
    if na == nb or na in nb or nb in na:
        return 1.0
    # Forkortelser: hvert ord i det korte navnet er starten på et ord i det lange
    # ("man united" ~ "manchester united").
    for short, long_ in ((na.split(), nb.split()), (nb.split(), na.split())):
        if all(any(w.startswith(x) for w in long_) for x in short):
            return 0.95
    return difflib.SequenceMatcher(None, na, nb).ratio()


def merge_events(*sources: list[dict], max_minutes: int = 20, min_score: float = 0.75) -> list[dict]:
    """Slå sammen samme kamp fra flere kilder. Første kilde er basis (bruk Pinnacle først).

    Lagnavnene fra basiskilden brukes, så h2h-utfallene får samme navn hos alle bøker.
    """
    base = [dict(e, bookmakers=list(e["bookmakers"])) for e in sources[0]]
    for src in sources[1:]:
        for ev in src:
            t = _ts(ev["commence_time"]) if ev.get("commence_time") else None
            best, best_score = None, min_score
            for b in base:
                if t and b.get("commence_time") and abs((_ts(b["commence_time"]) - t).total_seconds()) > max_minutes * 60:
                    continue
                score = min(_same_team(b["home_team"], ev["home_team"]), _same_team(b["away_team"], ev["away_team"]))
                if score >= best_score:
                    best, best_score = b, score
            if best is None:
                continue
            rename = {ev["home_team"]: best["home_team"], ev["away_team"]: best["away_team"]}
            for bm in ev["bookmakers"]:
                mks = [{"key": mk["key"], "outcomes": [dict(o, name=rename.get(o["name"], o["name"])) for o in mk["outcomes"]]}
                       for mk in bm["markets"]]
                best["bookmakers"].append(dict(bm, markets=mks))
    return [e for e in base if len(e["bookmakers"]) >= 2]


def fetch_free(kambi_brands: tuple[str, ...] = ("ub",)) -> list[dict]:
    """Pinnacle + Kambi-bøker, sammenslått. Feiler én kilde, brukes de andre."""
    results = []
    for fn, arg in [(fetch_pinnacle, None)] + [(fetch_kambi, b) for b in kambi_brands]:
        try:
            results.append(fn() if arg is None else fn(arg))
        except Exception as e:  # noqa: BLE001 – én død kilde skal ikke stoppe resten
            print(f"advarsel: {fn.__name__}({arg or ''}) feilet: {e}")
            results.append([])
    return merge_events(*results)
