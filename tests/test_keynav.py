"""The menus' arrow keys (keynav.js) on boxes laid out like the main menu, in jsc."""

import json
import os
import subprocess
import unittest

from sidequest import paths

from .test_avatar import JSC

HARNESS = os.path.join(os.path.dirname(__file__), "keynav_harness.js")


@unittest.skipUnless(os.path.exists(JSC), "JavaScriptCore jsc not found")
class KeynavTest(unittest.TestCase):
    def test_arrows_stay_in_the_row_and_go_straight_down(self):
        run = subprocess.run(
            [JSC, HARNESS, "--", paths.PROJECT_DIR], capture_output=True, text=True, timeout=60
        )
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        moves = {(id_, way): to for id_, way, to in json.loads(run.stdout)}
        expected = {
            ("agent", "right"): "classic",
            # Past a row's end: nowhere, not the next row or the top bar.
            ("ghost", "right"): None,
            ("trials", "right"): None,
            ("rush_plus", "right"): None,
            ("oldschool", "right"): None,
            # Down to the button below, not the bottom bar under the column.
            ("infinity", "down"): "rush",
            ("ghost", "down"): "trials",
            ("daily", "left"): "avatar",
            ("rush", "right"): "rush_plus",
            ("oldschool", "left"): "clean",
            ("avatar", "right"): "rush",
            ("clean", "down"): "play",
        }
        self.assertEqual(moves, expected)
