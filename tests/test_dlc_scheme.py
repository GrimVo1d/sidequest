"""The sidequest:// scheme serves DLC and SDK files and nothing else."""

import os
import unittest

from sidequest import dlc_scheme, paths

from .helpers import temp_dir

ROOTS = [os.path.join(paths.PROJECT_DIR, "dlc"), os.path.join(paths.PROJECT_DIR, "sdk")]
ARENA = os.path.join(paths.PROJECT_DIR, "dlc", "last-commit-standing", "index.html")


class SchemeTest(unittest.TestCase):
    def test_dlc_and_sdk_files_are_served(self):
        url = dlc_scheme.url_for(ARENA)
        self.assertEqual(url, "sidequest://app/dlc/last-commit-standing/index.html")
        status, mime, body = dlc_scheme.read(url, ROOTS)
        self.assertEqual((status, mime), (200, "text/html; charset=utf-8"))
        with open(ARENA, "rb") as f:
            self.assertEqual(body, f.read())
        status, mime, _ = dlc_scheme.read("sidequest://app/sdk/sidequest-sdk.js", ROOTS)
        self.assertEqual((status, mime), (200, "text/javascript; charset=utf-8"))

    def test_nothing_else_is_served(self):
        refused = [
            "sidequest://app/data/sidequest.db",
            "sidequest://app/sidequest/app.py",
            "sidequest://app/hub/index.html",
            "sidequest://app/dlc/../sidequest/core.py",
            "sidequest://app/dlc/%2e%2e/data/sidequest.db",
            "sidequest://app/dlc/../../../../etc/passwd",
            "sidequest://app/dev/dlc/sdk-test/index.html",  # dev DLCs only with --dev
            "sidequest://other/dlc/last-commit-standing/index.html",
            "file:///etc/passwd",
            "sidequest://app/dlc/last-commit-standing/",
            "sidequest://app/dlc/last-commit-standing/manifest.txt",
        ]
        for url in refused:
            with self.subTest(url=url):
                self.assertEqual(dlc_scheme.read(url, ROOTS), (404, "text/plain", b""))

    def test_symlink_out_of_a_root_is_refused(self):
        outside = os.path.join(temp_dir(self), "secret.json")
        with open(outside, "w") as f:
            f.write("{}")
        root = temp_dir(self)
        os.symlink(outside, os.path.join(root, "link.json"))
        url = dlc_scheme.url_for(os.path.join(root, "link.json"))
        self.assertEqual(dlc_scheme.read(url, [root])[0], 404)


if __name__ == "__main__":
    unittest.main()
