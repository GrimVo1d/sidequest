"""The classes, the campaign and the stars (classes.js, modes.js, meta.js), checked in jsc."""

import itertools
import json
import os
import subprocess
import unittest

from sidequest import paths

from .test_avatar import JSC

HARNESS = os.path.join(os.path.dirname(__file__), "classes_harness.js")


@unittest.skipUnless(os.path.exists(JSC), "JavaScriptCore jsc not found")
class ClassesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        run = subprocess.run(
            [JSC, HARNESS, "--", paths.PROJECT_DIR], capture_output=True, text=True, timeout=120
        )
        if run.returncode:
            raise AssertionError(run.stdout + run.stderr)
        cls.result = json.loads(run.stdout)
        with open(os.path.join(paths.GAME_DIR, "balance.json"), encoding="utf-8") as f:
            cls.balance = json.load(f)
        cls.classes = {c["id"]: c for c in cls.balance["classes"]}

    def test_each_class_starts_with_its_weapon_and_stats(self):
        start = self.result["start"]
        for cid, c in self.classes.items():
            got = start[cid]
            expected = ["pistol"] + ([c["weapon"]] if c["weapon"] else [])
            self.assertEqual(got["weapons"], expected, cid)
            self.assertEqual(got["ability"], c.get("ability", {}).get("id"), cid)
            hp = self.balance["player"]["hp"] * c.get("stats", {}).get("max_hp", 1)
            self.assertAlmostEqual(got["max_hp"], hp, msg=cid)
            self.assertAlmostEqual(got["hp"], hp, msg=cid)
        self.assertEqual(start["junior"]["xp"], 1.5)
        self.assertEqual(start["unknown"], "developer")

    def test_classes_unlock_with_real_achievements(self):
        ids = {a["id"] for a in self.balance["achievements"]}
        for c in self.classes.values():
            self.assertTrue(c["unlock"] is None or c["unlock"] in ids, c["id"])
            for key in ("name_en", "text_en"):
                self.assertNotRegex(c[key], "[а-яё]", c["id"])

    def test_junior_pulls_everything_and_waits_for_the_cooldown(self):
        j = self.result["junior"]
        self.assertTrue(j["used"] and j["pulled"] and j["item_at_player"])
        self.assertFalse(j["again"])
        self.assertEqual(j["ready"], self.classes["junior"]["ability"]["cooldown"])

    def test_dash_goes_its_distance_untouched(self):
        dash, a = self.result["dash"], self.classes["frontender"]["ability"]
        self.assertAlmostEqual(dash["moved"], a["distance"], delta=2)
        self.assertTrue(dash["invulnerable_during"])
        self.assertFalse(dash["again"])

    def test_backender_keeps_at_most_its_turrets(self):
        a = self.classes["backender"]["ability"]
        self.assertEqual(self.result["turret"]["counts"], [1, a["max"], a["max"]])
        self.assertEqual(self.result["turret"]["seconds"], a["seconds"])

    def test_rollback_returns_the_place_and_the_health(self):
        r, a = self.result["rollback"], self.classes["devops"]["ability"]
        self.assertGreater(r["away"], 200)
        self.assertLess(r["back"], 5)
        self.assertEqual(r["hp"], self.balance["player"]["hp"])
        self.assertGreaterEqual(r["invulnerable"], a["invulnerable"])

    def test_only_the_tester_crits_and_the_test_run_crits_every_hit(self):
        c = self.result["crit"]
        self.assertGreater(c["tester"], 0)
        self.assertEqual(c["developer"], 0)
        self.assertGreater(c["test_run"]["crits"], 0)
        self.assertEqual(c["test_run"]["until"], self.classes["tester"]["ability"]["seconds"])

    def test_bonuses_add_up_within_their_price_lists(self):
        perks = {p["id"]: p for p in self.balance["stars"]["perks"]}
        p = self.result["perks"]
        hp = self.balance["player"]["hp"] + 2 * perks["hp"]["add"]
        self.assertEqual(p["max_hp"], hp)
        self.assertEqual(p["hp"], hp)
        self.assertAlmostEqual(p["damage"], perks["damage"]["mul"])
        self.assertEqual(p["rerolls"], self.balance["build"]["rerolls"] + 1)
        speed = self.balance["player"]["speed"] * perks["speed"]["mul"] ** len(
            perks["speed"]["cost"]
        )
        self.assertAlmostEqual(p["speed"], speed)

    def test_the_campaign_goes_through_every_stage_and_carries_the_run(self):
        K = self.balance["campaign"]
        stages = self.result["campaign"]["stages"]
        self.assertEqual([s["at"]["map"] for s in stages], [st["map"] for st in K["stages"]])
        self.assertEqual([s["reason"] for s in stages], ["stage"] * (len(stages) - 1) + ["win"])
        self.assertEqual([s["stage"] for s in stages], list(range(1, len(stages) + 1)))
        for before, after in itertools.pairwise(stages):
            # The clock, the level and the score go on where the last stage ended.
            self.assertAlmostEqual(after["at"]["time"], before["end_time"])
            self.assertEqual(after["at"]["level"], before["level"])
            self.assertAlmostEqual(
                after["at"]["final_at"], after["at"]["time"] + K["stage_seconds"]
            )
            self.assertEqual(after["at"]["hp"], after["at"]["max_hp"])
        self.assertTrue(all(s["finals"] for s in stages))
        last = self.result["campaign"]["last"]
        self.assertEqual(
            (last["mode"], last["reason"], last["stage"], last["class"]),
            ("campaign", "win", 5, "tester"),
        )
        self.assertEqual(last["bosses"], len(K["stages"]))
        self.assertIsNone(self.result["campaign"]["out_of_range"])

    def test_stars_for_a_match(self):
        S, st = self.balance["stars"], self.result["stars"]
        self.assertEqual(st["lost_early"], S["match"])
        self.assertEqual(
            st["classic_win"], min(S["max"], S["match"] + 4 * S["per_boss"] + S["win"] + 4)
        )
        self.assertEqual(
            st["campaign_third"], S["match"] + 2 * S["per_boss"] + 2 * S["per_stage"] + 2
        )
        self.assertEqual(st["capped"], S["max"])

    def test_meta_save_is_cleaned_and_bought_from(self):
        m = self.result["meta"]
        hp_levels = len(next(p for p in self.balance["stars"]["perks"] if p["id"] == "hp")["cost"])
        self.assertEqual(
            m["clean"],
            {"stars": 7, "earned": 0, "perks": {"hp": hp_levels}, "weapons": {}, "evolutions": {}},
        )
        self.assertTrue(m["safe"])
        cost = next(p for p in self.balance["stars"]["perks"] if p["id"] == "damage")["cost"]
        self.assertEqual(m["buy"], [True, True, False, 7 - cost[0] - cost[1], 2, cost[2]])
        self.assertFalse(m["unknown"])
        self.assertEqual(m["found"]["weapons"], {"pistol": 1, "laser": 1})
        self.assertEqual(m["found"]["evolutions"], {"laser": 1})
        self.assertEqual(m["found"]["stars"], self.balance["stars"]["match"])

    def test_class_achievements(self):
        a = self.result["awards"]
        n = len(self.classes)
        full = next(x for x in self.balance["achievements"] if x["id"] == "fullstack")
        self.assertEqual(full["when"], {"kinds_min": {"classes": n}})
        # The developer was already played in the old save: the 1st new match makes 1 of 6.
        self.assertEqual([s[0] for s in a["steps"]], [0] * (n - 1) + [1])
        self.assertEqual([s[1] for s in a["steps"]], list(range(1, n + 1)))
        self.assertEqual(a["classes"], sorted(self.classes))
        self.assertTrue(a["safe"])
        self.assertEqual(a["abilities"], 3)


if __name__ == "__main__":
    unittest.main()
