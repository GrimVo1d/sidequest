"""Events named like Object.prototype members ("constructor", "__proto__") in every DLC."""

import json
import os
import subprocess
import unittest

from sidequest import paths

from .test_avatar import JSC

HARNESS = os.path.join(os.path.dirname(__file__), "hostile_keys_harness.js")


@unittest.skipUnless(os.path.exists(JSC), "JavaScriptCore jsc not found")
class HostileKeysTest(unittest.TestCase):
    def test_every_dlc_plays_on(self):
        run = subprocess.run(
            [JSC, HARNESS, "--", paths.PROJECT_DIR], capture_output=True, text=True, timeout=120
        )
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        results = [json.loads(line) for line in run.stdout.splitlines()]
        for r in results:
            with self.subTest(dlc=r["dlc"]):
                self.assertIsNone(r["error"])
                self.assertEqual((r["oddMet"], r["oddCls"]), ([], 0))
                self.assertLessEqual(set(r["mixKeys"]), {"read", "edit", "run"})
                self.assertGreater(r["events"], 100)


if __name__ == "__main__":
    unittest.main()
