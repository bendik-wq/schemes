"""Bygg den statiske nettsiden for GitHub Pages i mappen _site/.

    python3 build_site.py              # med resultatdata fra football-data.co.uk
    python3 build_site.py --no-data    # uten nedlasting (rask test)

Siden kjører Python-koden i nettleseren (Pyodide), så den trenger bare
HTML-en, .py-filene og CSV-ene med historiske resultater.
"""
from __future__ import annotations

import argparse
import shutil
import sys
import time
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).parent
PKG = ROOT / "betting"
LEAGUES = ["E0", "E1", "SP1", "D1", "I1", "F1", "N1", "SC0"]


def seasons(today: date, n: int = 3) -> list[str]:
    """Siste n sesonger i football-data-format, f.eks. 2425, 2526, 2627."""
    start = today.year if today.month >= 7 else today.year - 1
    return [f"{(y) % 100:02d}{(y + 1) % 100:02d}" for y in range(start - n + 1, start + 1)]


def download(url: str, dest: Path) -> bool:
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "betting-algo site builder"})
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read()
            if b"HomeTeam" not in body[:500]:
                return False
            dest.write_bytes(body)
            return True
        except Exception as e:  # noqa: BLE001
            print(f"  feil ({e}), prøver igjen", file=sys.stderr)
            time.sleep(2 ** attempt)
    return False


def build(out: Path, with_data: bool) -> None:
    if out.exists():
        shutil.rmtree(out)
    (out / "py" / "betting").mkdir(parents=True)
    (out / "data").mkdir()
    shutil.copy(PKG / "ui.html", out / "index.html")
    for f in PKG.glob("*.py"):
        shutil.copy(f, out / "py" / "betting" / f.name)
    (out / ".nojekyll").write_text("")
    if with_data:
        for league in LEAGUES:
            for season in seasons(date.today()):
                url = f"https://www.football-data.co.uk/mmz4281/{season}/{league}.csv"
                ok = download(url, out / "data" / f"{league}_{season}.csv")
                print(f"{'ok ' if ok else 'mangler'} {league} {season}")
    print(f"Bygget {out}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "_site"))
    ap.add_argument("--no-data", action="store_true")
    a = ap.parse_args()
    build(Path(a.out), not a.no_data)
