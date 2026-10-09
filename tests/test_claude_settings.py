import json
import os
import unittest

from sidequest import claude_settings as cs
from sidequest.normalizer import HOOK_EVENTS

from .helpers import temp_dir

EMIT = "/Users/someone/sidequest/hooks/sidequest-emit.sh"

FOREIGN = {
    "model": "opus",
    "hooks": {
        "PostToolUse": [
            {"matcher": "Edit", "hooks": [{"type": "command", "command": "prettier-hook"}]},
        ],
        "Notification": [{"hooks": [{"type": "command", "command": "say hi"}]}],
    },
    "permissions": {"deny": ["Bash(rm -rf *)"]},
}


def yes(_changes):
    return True


class PlanTest(unittest.TestCase):
    def test_install_adds_every_event_and_keeps_foreign_hooks(self):
        new, changes = cs.plan_install(FOREIGN, EMIT)
        self.assertEqual(sorted(e for e, _ in changes), sorted(HOOK_EVENTS))
        self.assertEqual(new["hooks"]["PostToolUse"][0], FOREIGN["hooks"]["PostToolUse"][0])
        self.assertEqual(new["hooks"]["Notification"], FOREIGN["hooks"]["Notification"])
        self.assertEqual(cs.find_entries(new),
                         {event: [EMIT] for event in HOOK_EVENTS})
        entry = new["hooks"]["Stop"][0]["hooks"][0]
        self.assertEqual(entry["command"], "/bin/sh")
        self.assertEqual(entry["args"], [EMIT])
        self.assertNotIn("async", entry)

    def test_install_is_idempotent(self):
        once, _ = cs.plan_install(FOREIGN, EMIT)
        twice, changes = cs.plan_install(once, EMIT)
        self.assertEqual(changes, [])
        self.assertEqual(once, twice)

    def test_moved_project_updates_path(self):
        once, _ = cs.plan_install({}, "/old/place/hooks/sidequest-emit.sh")
        moved, changes = cs.plan_install(once, EMIT)
        self.assertEqual({what for _, what in changes}, {"update"})
        self.assertEqual(cs.find_entries(moved), {event: [EMIT] for event in HOOK_EVENTS})

    def test_duplicates_are_removed(self):
        once, _ = cs.plan_install({}, EMIT)
        once["hooks"]["Stop"].append({"hooks": [cs.hook_entry(EMIT)]})
        fixed, changes = cs.plan_install(once, EMIT)
        self.assertIn(("Stop", "dedupe"), changes)
        self.assertEqual(cs.find_entries(fixed)["Stop"], [EMIT])

    def test_uninstall_restores_original(self):
        installed, _ = cs.plan_install(FOREIGN, EMIT)
        removed, changes = cs.plan_uninstall(installed)
        self.assertEqual(removed, FOREIGN)
        self.assertEqual(len(changes), len(HOOK_EVENTS))

    def test_uninstall_drops_empty_hooks_section(self):
        installed, _ = cs.plan_install({"model": "x"}, EMIT)
        removed, _ = cs.plan_uninstall(installed)
        self.assertEqual(removed, {"model": "x"})

    def test_uninstall_finds_legacy_command_form(self):
        legacy = {"hooks": {"Stop": [{"matcher": "*", "hooks": [
            {"type": "command", "command": "/somewhere/hooks/sidequest-emit.sh"}]}]}}
        removed, changes = cs.plan_uninstall(legacy)
        self.assertEqual(removed, {})
        self.assertEqual(changes, [("Stop", "remove")])

    def test_rejects_wrong_types(self):
        with self.assertRaises(cs.SettingsError):
            cs.plan_install({"hooks": []}, EMIT)
        with self.assertRaises(cs.SettingsError):
            cs.plan_install({"hooks": {"Stop": {}}}, EMIT)


class FileTest(unittest.TestCase):
    def setUp(self):
        self.dir = temp_dir(self)
        self.path = os.path.join(self.dir, "settings.json")
        self.backups = os.path.join(self.dir, "backups")

    def write(self, data):
        with open(self.path, "w") as f:
            f.write(data if isinstance(data, str) else json.dumps(data))

    def load(self):
        with open(self.path) as f:
            return json.load(f)

    def install(self, confirm=yes):
        return cs.apply(self.path, lambda s: cs.plan_install(s, EMIT), confirm,
                        backup_dir=self.backups)

    def test_missing_file_is_created_without_backup(self):
        changes, backup = self.install()
        self.assertTrue(changes)
        self.assertIsNone(backup)
        self.assertEqual(cs.find_entries(self.load())["Stop"], [EMIT])
        self.assertEqual(os.stat(self.path).st_mode & 0o777, 0o600)

    def test_backup_and_round_trip(self):
        self.write(FOREIGN)
        os.chmod(self.path, 0o644)
        changes, backup = self.install()
        self.assertEqual(os.path.dirname(backup), self.backups)
        with open(backup) as f:
            self.assertEqual(json.load(f), FOREIGN)
        self.assertEqual(os.stat(backup).st_mode & 0o777, 0o600)  # private copy
        self.assertEqual(os.stat(self.backups).st_mode & 0o777, 0o700)
        self.assertEqual(os.stat(self.path).st_mode & 0o777, 0o644)  # mode is kept
        _, second = cs.apply(self.path, cs.plan_uninstall, yes, backup_dir=self.backups)
        self.assertNotEqual(second, backup)  # same second, still two copies
        self.assertEqual(len(os.listdir(self.backups)), 2)
        self.assertEqual(self.load(), FOREIGN)
        self.assertEqual(sorted(os.listdir(self.dir)), ["backups", "settings.json"])

    def test_invalid_json_is_left_alone(self):
        self.write("{ not json")
        with self.assertRaises(cs.SettingsError):
            self.install()
        with open(self.path) as f:
            self.assertEqual(f.read(), "{ not json")
        self.assertEqual(os.listdir(self.dir), ["settings.json"])

    def test_declined_confirmation_changes_nothing(self):
        self.write(FOREIGN)
        with self.assertRaises(cs.SettingsError):
            self.install(confirm=lambda changes: False)
        self.assertEqual(self.load(), FOREIGN)
        self.assertEqual(os.listdir(self.dir), ["settings.json"])

    def test_concurrent_change_is_retried(self):
        self.write(FOREIGN)
        calls = []

        def confirm(changes):
            if not calls:  # Claude Code rewrites the file while we ask
                self.write(dict(FOREIGN, theme="dark"))
            calls.append(1)
            return True

        self.install(confirm)
        result = self.load()
        self.assertEqual(result["theme"], "dark")
        self.assertEqual(cs.find_entries(result)["Stop"], [EMIT])

    def test_nothing_to_do(self):
        self.install()
        changes, backup = self.install()
        self.assertEqual((changes, backup), ([], None))


if __name__ == "__main__":
    unittest.main()
