"""The first match's tutorial (tutorial.js), followed on a real match in jsc."""

import json
import os
import subprocess
import unittest

from sidequest import paths

from .test_avatar import JSC

HARNESS = os.path.join(os.path.dirname(__file__), "tutorial_harness.js")


@unittest.skipUnless(os.path.exists(JSC), "JavaScriptCore jsc not found")
class TutorialTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        run = subprocess.run(
            [JSC, HARNESS, "--", paths.PROJECT_DIR], capture_output=True, text=True, timeout=120
        )
        if run.returncode:
            raise AssertionError(run.stdout + run.stderr)
        cls.result = json.loads(run.stdout)
        with open(os.path.join(paths.GAME_DIR, "balance.json"), encoding="utf-8") as f:
            cls.steps = json.load(f)["tutorial"]["steps"]

    def test_steps_come_in_order_and_skip_what_does_not_apply(self):
        ids = [st["id"] for st in self.steps]
        self.assertEqual(self.result["junior"]["order"], ids)
        plain = [st["id"] for st in self.steps if not st.get("only")]
        self.assertEqual(self.result["developer"]["order"], plain)
        at = self.result["developer"]["at"]
        self.assertEqual([at[i]["index"] for i in plain], list(range(len(plain))))
        self.assertTrue(all(at[i]["count"] == len(plain) for i in plain))

    def test_each_step_waits_for_its_goal(self):
        need = {st["id"]: st["need"] for st in self.steps}
        at = self.result["developer"]["at"]
        # The step after a goal starts only once that goal is met.
        self.assertGreaterEqual(at["level"]["kills"], need["kills"]["kills"])
        self.assertGreaterEqual(at["pause"]["level"], need["level"]["level"])
        self.assertLess(at["kills"]["kills"], need["kills"]["kills"])
        junior = self.result["junior"]["at"]
        self.assertGreaterEqual(
            junior["pause"]["time"] - junior["agent"]["time"], need["agent"]["seconds"] - 0.05
        )

    def test_the_tutorial_ends(self):
        for name in ("developer", "junior"):
            r = self.result[name]
            self.assertTrue(r["done"], name)
            self.assertIsNone(r["after"], name)
        self.assertTrue(self.result["none"])

    def test_texts_in_both_languages(self):
        for st in self.steps:
            for key in ("name", "text"):
                self.assertTrue(st[key] and st[key + "_en"], st["id"])
                self.assertNotRegex(st[key + "_en"], "[а-яё]", st["id"])


if __name__ == "__main__":
    unittest.main()
