"""The gamepad (gamepad.js) on a made-up pad in jsc."""

import json
import os
import subprocess
import unittest

from sidequest import paths

from .test_avatar import JSC

HARNESS = os.path.join(os.path.dirname(__file__), "gamepad_harness.js")
STILL = {"x": 0, "y": 0}


@unittest.skipUnless(os.path.exists(JSC), "JavaScriptCore jsc not found")
class GamepadTest(unittest.TestCase):
    result: dict

    @classmethod
    def setUpClass(cls):
        run = subprocess.run(
            [JSC, HARNESS, "--", paths.PROJECT_DIR], capture_output=True, text=True, timeout=60
        )
        if run.returncode:
            raise AssertionError(run.stdout + run.stderr)
        cls.result = json.loads(run.stdout)

    def test_no_pad_or_an_unknown_one_does_nothing(self):
        self.assertEqual(self.result["none"], STILL)
        self.assertEqual(self.result["broken"], STILL)
        self.assertEqual(self.result["unmapped"], [STILL, 0])

    def test_the_stick_and_the_dpad_move_the_hero(self):
        self.assertEqual(self.result["dead"], STILL)
        self.assertEqual(self.result["full"], {"x": 1, "y": 0})
        self.assertEqual(self.result["half"], {"x": 0, "y": -0.5})
        self.assertEqual(self.result["dpad"], {"x": 1, "y": 1})

    def test_buttons_become_keys_once_per_press(self):
        # A held for two polls, let go, pressed again with X.
        self.assertEqual(
            self.result["buttons"],
            ["Enter", "Enter", "Space", "Escape", "KeyR", "KeyX", "Escape"],
        )

    def test_menus_get_arrows_with_a_repeat(self):
        moves, keys = self.result["menu"]["moves"], self.result["menu"]["keys"]
        self.assertTrue(all(m[1] == STILL for m in moves))
        # Pressed at 100 ms: again at 500, then every 150 ms.
        self.assertEqual([m[2] for m in moves], [1, 1, 1, 2, 2, 3, 4])
        self.assertEqual(keys[-1], "ArrowLeft")
        self.assertEqual(set(keys[:-1]), {"ArrowDown"})

    def test_a_menu_opening_under_a_held_stick_waits(self):
        self.assertEqual(self.result["levelup"]["held"], 0)
        self.assertEqual(self.result["levelup"]["after"], ["ArrowRight"])


if __name__ == "__main__":
    unittest.main()
