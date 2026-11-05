import unittest

from betting.safeparlay import analyse_event, best_ticket


def ev(eid, home, away, books):
    return {"id": eid, "home_team": home, "away_team": away, "commence_time": "2099-01-01T00:00:00Z",
            "bookmakers": [{"key": t.lower(), "title": t, "markets": mk} for t, mk in books.items()]}


def mk(home, away, h, d, a, over, under, line=2.5):
    return [{"key": "h2h", "outcomes": [{"name": home, "price": h}, {"name": "Draw", "price": d}, {"name": away, "price": a}]},
            {"key": "totals", "outcomes": [{"name": "Over", "price": over, "point": line},
                                           {"name": "Under", "price": under, "point": line}]},
            {"key": "double_chance", "outcomes": [{"name": f"{home} or Draw", "price": 1.15}]}]


class SafeParlayTest(unittest.TestCase):
    def setUp(self):
        self.events = [ev(f"e{i}", f"H{i}", f"A{i}", {
            "Pinnacle": mk(f"H{i}", f"A{i}", 1.60, 4.0, 5.5, 1.70, 2.20),
            "Soft": mk(f"H{i}", f"A{i}", 1.58, 3.9, 5.3, 1.72, 2.10)}) for i in range(3)]

    def test_fit_reproduces_market(self):
        a = analyse_event(self.events[0])
        self.assertLess(a["fit_error"], 0.02)
        self.assertGreater(a["lambda"], a["mu"])

    def test_ticket_meets_target_and_one_leg_per_match(self):
        an = [analyse_event(e) for e in self.events]
        t = best_ticket(an, "Soft", 2.0)
        self.assertIsNotNone(t)
        self.assertGreaterEqual(t.odds, 2.0)
        self.assertEqual(len({l.event_id for l, _ in t.legs}), len(t.legs))
        self.assertLess(t.prob, 1 / t.odds * 1.1)   # ingen gratis lunsj ved fair priser


if __name__ == "__main__":
    unittest.main()
