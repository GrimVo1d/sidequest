"""Last Commit Standing: whole matches of the simulation, played by a bot in jsc."""
import json
import os
import subprocess
import unittest

from sidequest import paths

from .test_avatar import JSC

HARNESS = os.path.join(os.path.dirname(__file__), "arena_harness.js")
DLC = os.path.join(paths.PROJECT_DIR, "dlc", "last-commit-standing")


@unittest.skipUnless(os.path.exists(JSC), "JavaScriptCore jsc not found")
class ArenaTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        run = subprocess.run([JSC, HARNESS, "--", paths.PROJECT_DIR],
                             capture_output=True, text=True, timeout=120)
        if run.returncode:
            raise AssertionError(run.stdout + run.stderr)
        cls.result = json.loads(run.stdout)
        with open(os.path.join(DLC, "balance.json"), encoding="utf-8") as f:
            cls.balance = json.load(f)

    def matches(self):
        return {k: v for k, v in self.result.items() if isinstance(v, dict)}

    def test_no_broken_numbers(self):
        for name, match in self.matches().items():
            with self.subTest(name):
                self.assertIsNone(match["bad"])

    def test_match_ends_when_every_agent_is_done(self):
        for name in ("short-task", "long-task", "error-streak", "blocked",
                     "joined-mid-session", "unknown-tool", "busy_two"):
            with self.subTest(name):
                match = self.result[name]
                self.assertTrue(match["over"])
                self.assertEqual(match["results"]["reason"], "done")
                self.assertTrue(all(state == "gone" for state in match["allies"]))

    def test_one_agent_done_does_not_end_the_match(self):
        for name in ("two-agents", "busy_two_mid"):
            with self.subTest(name):
                match = self.result[name]
                self.assertFalse(match["over"])
                self.assertEqual(len(match["allies"]), 2)
                self.assertIn("active", match["allies"])

    def test_no_agent_no_finale(self):
        idle = self.result["idle"]
        self.assertFalse(idle["over"])
        self.assertEqual(idle["level"], 1)
        self.assertGreater(idle["max_enemies"], 0)

    def test_agent_actions_level_up(self):
        self.assertGreaterEqual(self.result["busy_two"]["level"], 5)
        self.assertGreater(self.result["busy_two"]["choices"], 0)

    def test_enemy_count_is_capped(self):
        spawn = self.balance["spawn"]
        bosses = 1 + 30 // spawn["boss_every_minutes"]
        for name, match in self.matches().items():
            with self.subTest(name):
                self.assertLessEqual(match["max_enemies"], spawn["max_alive"] + bosses)

    def test_same_seed_same_match(self):
        self.assertTrue(self.result["repeatable"])

    def test_step_is_fast(self):
        # A frame has ~16 ms; the simulation must leave nearly all of it to drawing.
        for name, match in self.matches().items():
            with self.subTest(name):
                self.assertLess(match["ms_per_step"], 2)


if __name__ == "__main__":
    unittest.main()
