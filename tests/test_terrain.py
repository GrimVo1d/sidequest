"""The map's objects (terrain.js) and every map's layout, checked in jsc."""

import json
import os
import subprocess
import unittest

from sidequest import paths

from .test_avatar import JSC

HARNESS = os.path.join(os.path.dirname(__file__), "terrain_harness.js")


@unittest.skipUnless(os.path.exists(JSC), "JavaScriptCore jsc not found")
class TerrainTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        run = subprocess.run(
            [JSC, HARNESS, "--", paths.PROJECT_DIR], capture_output=True, text=True, timeout=60
        )
        if run.returncode:
            raise AssertionError(run.stdout + run.stderr)
        cls.result = json.loads(run.stdout)
        with open(os.path.join(paths.GAME_DIR, "balance.json"), encoding="utf-8") as f:
            cls.terrain = json.load(f)["terrain"]

    def test_every_map_is_reachable_with_the_doors_shut(self):
        self.assertEqual(len(self.result["reach"]), 9)
        for name, reach in self.result["reach"].items():
            with self.subTest(name):
                self.assertTrue(reach["start"])
                self.assertEqual(reach["lost_count"], 0, reach["lost"])
                self.assertTrue(reach["pads_free"])

    def test_doors_open_warn_and_shut(self):
        door = self.result["door"]
        self.assertEqual(door["start"], {"closed": False, "warn": False, "wall": False})
        self.assertEqual(door["warn"], {"closed": False, "warn": True, "wall": False})
        self.assertEqual(door["shut"], {"closed": True, "warn": False, "wall": True})
        self.assertFalse(door["again"]["closed"])
        self.assertTrue(door["met"])

    def test_cracked_walls_break_for_good(self):
        crack = self.result["crack"]
        self.assertTrue(crack["first"] and crack["standing"] and crack["second"])
        self.assertTrue(crack["gone"])
        self.assertFalse(crack["after"])  # bullets fly through where it stood
        self.assertTrue(crack["crumble"])
        self.assertEqual(crack["met"], ["crack"])
        self.assertTrue(crack["blast"])

    def test_racks_blow_up_and_come_back(self):
        rack, k = self.result["rack"], self.terrain["rack"]
        self.assertEqual(rack["boom"], [200, 150, k["radius"], k["damage"]])
        self.assertEqual(rack["hurt"], [k["player_damage"]])
        self.assertEqual(rack["far_hurt"], 0)
        self.assertTrue(rack["down"])
        self.assertFalse(rack["back_under_player"])
        self.assertTrue(rack["back"])

    def test_belts_carry_all_but_the_rigid(self):
        belt, step = self.result["belt"], self.terrain["belt"]["speed"]
        self.assertAlmostEqual(belt["player"][0], 100 + step, delta=0.5)
        self.assertEqual(belt["player"][1], 120)
        self.assertAlmostEqual(belt["enemies"][0][0], 100 + step, delta=0.5)
        self.assertEqual(belt["enemies"][1], [100, 125])
        self.assertLess(belt["enemies"][2][1], 220)  # the "up" belt
        self.assertGreaterEqual(belt["enemies"][2][1], 199)  # and stops at its end

    def test_vents_burn_in_turn(self):
        vent, k = self.result["vent"], self.terrain["vent"]
        self.assertEqual(vent["warn"]["states"], ["warn", "idle"])
        self.assertEqual(vent["warn"]["player"], [])
        self.assertEqual(vent["burn0"]["states"], ["burn", "idle"])
        self.assertEqual(vent["burn0"]["player"], [k["damage"]])
        self.assertEqual(vent["burn1"]["states"], ["idle", "burn"])
        self.assertEqual(vent["burn1"]["player"], [])
        self.assertAlmostEqual(vent["burn1"]["enemy"][0], k["enemy_dps"] / 60)
        self.assertEqual(vent["idle"]["states"][0], "idle")

    def test_pits(self):
        pit = self.result["pit"]
        self.assertEqual(pit["fell"], [0])  # not the boss, not the ghost, not the one outside
        self.assertTrue(pit["player_out"])
        self.assertFalse(pit["walls_only"])  # bullets fly over a pit
        self.assertAlmostEqual(pit["knocked"], self.terrain["pit"]["knockback"])
        self.assertEqual(pit["flat_knock"], 0)
        self.assertEqual(
            self.result["cloud"], {"dead": True, "kills": 1, "fall": True, "met": True}
        )

    def test_pads_send_to_the_twin(self):
        pad = self.result["pad"]
        self.assertEqual(pad["first"], [350, 250])
        self.assertEqual(pad["stays"], [350, 250])  # no bouncing back while standing on it
        self.assertEqual(pad["back"], [50, 50])

    def test_the_night_is_dark(self):
        self.assertEqual(self.result["night"], {"met": True, "dark": True})


if __name__ == "__main__":
    unittest.main()
