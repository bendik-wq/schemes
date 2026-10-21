import unittest

from betting import data
from betting.arbitrage import find_arbs
from betting.markets import group_markets
from betting.models import DixonColes, Elo
from betting.odds import (closing_line_value, devig, expected_value, kelly,
                          overround)
from betting.parlay import build_parlays, compounded_margin
from betting.value import find_value_bets


def event(eid, books):
    return {"id": eid, "sport_key": "x", "commence_time": "", "home_team": "A", "away_team": "B",
            "bookmakers": [{"key": t, "title": t, "markets": [
                {"key": "h2h", "outcomes": [{"name": n, "price": p} for n, p in prices.items()]}]}
                for t, prices in books.items()]}


class OddsTest(unittest.TestCase):
    def test_devig_sums_to_one(self):
        odds = [1.62, 4.45, 5.60]
        for method in ("shin", "power", "multiplicative", "additive"):
            self.assertAlmostEqual(sum(devig(odds, method)), 1.0, places=9, msg=method)

    def test_devig_fair_market_unchanged(self):
        for method in ("shin", "power", "multiplicative"):
            p = devig([2.0, 4.0, 4.0], method)
            for got, want in zip(p, [0.5, 0.25, 0.25]):
                self.assertAlmostEqual(got, want, places=6)

    def test_shin_and_power_take_more_margin_from_longshot(self):
        odds = [1.30, 4.50, 11.0]
        mult = devig(odds, "multiplicative")
        for method in ("shin", "power"):
            self.assertGreater(devig(odds, method)[0], mult[0])
            self.assertLess(devig(odds, method)[2], mult[2])

    def test_kelly(self):
        self.assertEqual(kelly(0.4, 2.0), 0.0)                       # negativ EV
        self.assertAlmostEqual(kelly(0.55, 2.0, 1.0, 1.0), 0.10)     # full Kelly
        self.assertAlmostEqual(expected_value(0.55, 2.0), 0.10)

    def test_overround_and_clv(self):
        self.assertAlmostEqual(overround([1.9, 1.9]), 2 / 1.9)
        self.assertAlmostEqual(closing_line_value(2.10, 0.5), 0.05)

    def test_compounded_margin(self):
        self.assertAlmostEqual(compounded_margin([0.05] * 5), 1 - 1.05 ** -5)


class ArbTest(unittest.TestCase):
    def test_finds_arb_and_equal_payout(self):
        ms = group_markets([event("e", {"X": {"A": 2.20, "B": 1.70}, "Y": {"A": 1.80, "B": 2.10}})])
        arbs = find_arbs(ms)
        self.assertEqual(len(arbs), 1)
        arb = arbs[0]
        self.assertAlmostEqual(arb.roi, 1 / (1 / 2.2 + 1 / 2.1) - 1)
        pay = arb.payouts(arb.stakes(1000))
        self.assertAlmostEqual(pay["A"], pay["B"], places=6)
        self.assertGreater(pay["A"], 0)

    def test_no_arb_in_normal_market(self):
        ms = group_markets([event("e", {"X": {"A": 1.90, "B": 1.90}, "Y": {"A": 1.92, "B": 1.88}})])
        self.assertEqual(find_arbs(ms), [])

    def test_spread_lines_grouped_from_home_side(self):
        ev = {"id": "e", "home_team": "A", "away_team": "B", "bookmakers": [
            {"key": k, "markets": [{"key": "spreads", "outcomes": [
                {"name": "A", "price": 1.9, "point": -1.5}, {"name": "B", "price": 1.9, "point": 1.5}]}]}
            for k in ("x", "y")]}
        ms = group_markets([ev])
        self.assertEqual(len(ms), 1)
        self.assertEqual(ms[0].line, -1.5)


class LiveDataTest(unittest.TestCase):
    def test_exchange_commission(self):
        ms = group_markets([event("e", {"Betfair": {"A": 3.0, "B": 1.5}})])
        self.assertAlmostEqual(ms[0].prices["Betfair"]["A"], 1 + 2.0 * 0.95)

    def test_started_events_skipped(self):
        ev = event("e", {"X": {"A": 2.2, "B": 1.7}, "Y": {"A": 1.8, "B": 2.1}})
        ev["commence_time"] = "2000-01-01T00:00:00Z"
        self.assertEqual(group_markets([ev]), [])
        self.assertEqual(len(group_markets([ev], skip_started=False)), 1)

    def test_placeholder_exchange_prices_ignored(self):
        books = {"Betfair": {"A": 1.1, "B": 1.1}, "Pinnacle": {"A": 1.95, "B": 1.95}, "Soft": {"A": 2.10, "B": 1.75}}
        bets = find_value_bets(group_markets([event("e", books)]))
        self.assertEqual([(b.bookmaker, b.outcome, b.source) for b in bets], [("Soft", "A", "Pinnacle")])

    def test_sharp_outlier_falls_back_to_consensus(self):
        books = {f"b{i}": {"A": 1.12, "B": 6.6} for i in range(5)}
        books["Pinnacle"] = {"A": 1.30, "B": 3.80}   # skarp bok langt unna resten
        from betting.value import fair_probabilities
        probs, source = fair_probabilities(group_markets([event("e", books)])[0])
        self.assertIn("konsensus", source)

    def test_rounded_stakes_never_lose(self):
        ms = group_markets([event("e", {"X": {"A": 1.17, "B": 6.0}, "Y": {"A": 1.12, "B": 7.5}})])
        arb = find_arbs(ms)[0]
        pay = arb.payouts(arb.stakes(1000, round_to=10))
        self.assertGreaterEqual(min(pay.values()), 0)


class ValueTest(unittest.TestCase):
    def test_soft_book_above_pinnacle_is_value(self):
        ms = group_markets([event("e", {
            "Pinnacle": {"A": 2.00, "B": 1.86},
            "Soft": {"A": 2.20, "B": 1.70},
        })])
        bets = find_value_bets(ms, min_edge=0.02)
        self.assertEqual([(b.bookmaker, b.outcome) for b in bets], [("Soft", "A")])
        self.assertGreater(bets[0].kelly_fraction, 0)

    def test_consensus_without_sharp(self):
        books = {f"b{i}": {"A": 1.90, "B": 1.90} for i in range(4)}
        books["Outlier"] = {"A": 2.15, "B": 1.70}
        bets = find_value_bets(group_markets([event("e", books)]))
        self.assertEqual(bets[0].bookmaker, "Outlier")
        self.assertIn("konsensus", bets[0].source)

    def test_parlays_never_combine_same_event(self):
        ms = group_markets(data.sample_events())
        for p in build_parlays(find_value_bets(ms), top=100):
            ids = [b.market.event_id for b in p.legs]
            self.assertEqual(len(ids), len(set(ids)))
            self.assertGreater(p.edge, 0)


class ModelTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.model = DixonColes().fit(data.simulate_results(seasons=3))

    def test_recovers_strongest_team(self):
        self.assertEqual(self.model.ratings()[0][0], "Bodø/Glimt")
        self.assertGreater(self.model.home_adv, 0)

    def test_probabilities_are_consistent(self):
        p = self.model.probs_1x2("Brann", "KFUM Oslo")
        self.assertAlmostEqual(sum(p.values()), 1.0, places=9)
        self.assertGreater(p["Brann"], p["KFUM Oslo"])
        t = self.model.probs_total("Brann", "KFUM Oslo", 2.5)
        self.assertAlmostEqual(t["Over"] + t["Under"], 1.0)
        both = self.model.joint("Brann", "KFUM Oslo", lambda h, a: h > a and h + a > 2.5)
        self.assertLess(both, min(p["Brann"], t["Over"]))

    def test_elo(self):
        elo = Elo()
        for _ in range(10):
            elo.update("A", "B", 3, 0)
        self.assertGreater(elo.win_prob("A", "B"), 0.8)


class CliTest(unittest.TestCase):
    def test_sample_scan_runs(self):
        import contextlib
        import io
        from betting.cli import main
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            main(["scan", "--sample"])
        self.assertIn("ARBITRASJE (1)", buf.getvalue())


if __name__ == "__main__":
    unittest.main()
