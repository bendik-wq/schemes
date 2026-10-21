import unittest

from betting.markets import group_markets
from betting.sources import american_to_decimal, merge_events, norm_team, parse_kambi, parse_pinnacle
from betting.value import find_value_bets

PIN_MU = [{"id": 1, "type": "matchup", "startTime": "2026-10-25T15:00:00Z", "league": {"name": "EPL"},
           "participants": [{"alignment": "home", "name": "Manchester United"},
                            {"alignment": "away", "name": "Tottenham Hotspur"}]}]
PIN_MK = [
    {"matchupId": 1, "period": 0, "type": "moneyline", "status": "open", "prices": [
        {"designation": "home", "price": 110}, {"designation": "draw", "price": 260},
        {"designation": "away", "price": 230}]},
    {"matchupId": 1, "period": 0, "type": "total", "status": "open", "prices": [
        {"designation": "over", "price": -110, "points": 2.5}, {"designation": "under", "price": -105, "points": 2.5}]},
    {"matchupId": 1, "period": 1, "type": "moneyline", "prices": []},
]
KAMBI = {"events": [{"event": {"id": 9, "homeName": "Man Utd", "awayName": "Tottenham",
                               "start": "2026-10-25T15:05:00Z", "state": "NOT_STARTED", "group": "Premier League"},
                     "betOffers": [
                         {"criterion": {"label": "Full Time"}, "outcomes": [
                             {"type": "OT_ONE", "odds": 2300}, {"type": "OT_CROSS", "odds": 3500},
                             {"type": "OT_TWO", "odds": 3200}]},
                         {"criterion": {"label": "Total Goals"}, "outcomes": [
                             {"type": "OT_OVER", "odds": 1900, "line": 2500},
                             {"type": "OT_UNDER", "odds": 1900, "line": 2500}]}]}]}


class SourcesTest(unittest.TestCase):
    def test_american(self):
        self.assertAlmostEqual(american_to_decimal(150), 2.5)
        self.assertAlmostEqual(american_to_decimal(-200), 1.5)

    def test_norm_team(self):
        self.assertEqual(norm_team("Bodø/Glimt FK"), "bodo glimt")
        self.assertEqual(norm_team("Man Utd"), "man united")

    def test_parse_and_merge(self):
        pin = parse_pinnacle(PIN_MU, PIN_MK)
        self.assertEqual(len(pin), 1)
        self.assertEqual(len(pin[0]["bookmakers"][0]["markets"]), 2)
        kam = parse_kambi(KAMBI)
        self.assertEqual(kam[0]["bookmakers"][0]["markets"][0]["outcomes"][0]["price"], 2.3)
        merged = merge_events(pin, kam)
        self.assertEqual(len(merged), 1)
        self.assertEqual(len(merged[0]["bookmakers"]), 2)
        bets = find_value_bets(group_markets(merged))
        # Unibet 2.30 på hjemmelaget mot Pinnacle 2.10 skal være value, med Pinnacles lagnavn.
        self.assertIn(("Unibet", "Manchester United"), [(b.bookmaker, b.outcome) for b in bets])

    def test_no_merge_when_kickoff_differs(self):
        kam = parse_kambi(KAMBI)
        kam[0]["commence_time"] = "2026-10-26T15:00:00Z"
        self.assertEqual(merge_events(parse_pinnacle(PIN_MU, PIN_MK), kam), [])


if __name__ == "__main__":
    unittest.main()
