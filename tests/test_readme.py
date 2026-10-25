"""The numbers README.md quotes match the game, so the front page of the repository never
drifts from it."""

import json
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as f:
        return f.read()


class ReadmeTest(unittest.TestCase):
    def setUp(self):
        self.readme = read("README.md")

    def quoted(self, pattern):
        found = re.search(pattern, self.readme)
        self.assertIsNotNone(found, pattern)
        return int(found.group(1)) if found else 0

    def test_counts_match_the_game(self):
        balance = json.loads(read("game/balance.json"))
        maps = len(re.findall(r'^    \{id: "', read("game/maps.js"), re.MULTILINE))
        modes = len(re.findall(r"^    \w+: \{solo: ", read("game/modes.js"), re.MULTILINE))
        self.assertEqual(self.quoted(r"There are (\d+) weapons"), len(balance["weapons"]))
        self.assertEqual(self.quoted(r"(\d+) classes"), len(balance["classes"]))
        self.assertEqual(self.quoted(r"(\d+) maps"), maps)
        self.assertEqual(self.quoted(r"(\d+) modes"), modes)

    def test_agent_numbers_match_the_balance(self):
        agent = json.loads(read("game/balance.json"))["agent"]
        self.assertEqual(
            self.quoted(r"turret next to the ally for (\d+) seconds"), agent["turret"]["seconds"]
        )
        self.assertEqual(self.quoted(r"more often for (\d+) seconds"), agent["red_ci"]["seconds"])

    def test_hook_size(self):
        with open(os.path.join(ROOT, "hooks", "sidequest-emit.sh")) as f:
            lines = len(f.read().splitlines())
        self.assertEqual(self.quoted(r"\[(\d+) lines of shell\]"), lines)


if __name__ == "__main__":
    unittest.main()
