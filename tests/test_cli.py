"""The command line commands that read the database, on a temporary one."""

import contextlib
import io
import os
import unittest
from unittest import mock

from sidequest import __main__ as cli
from sidequest.db import Store

from .helpers import SID, temp_dir


class SessionsCommandTest(unittest.TestCase):
    def setUp(self):
        db = os.path.join(temp_dir(self), "sidequest.db")
        store = Store(db)
        store.add_event({"kind": "session_start", "session": SID, "project": "my-app", "ts": 100.0})
        store.add_event(
            {
                "kind": "session_start",
                "session": "joined-1",
                "project": None,
                "ts": 200.0,
                "joined": True,
            }
        )
        store.close()
        patcher = mock.patch.object(cli, "_open_store", lambda: Store(db))
        patcher.start()
        self.addCleanup(patcher.stop)

    def run_cli(self, *argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = cli.main(list(argv))
        return code, out.getvalue()

    def test_sessions_lists_every_session(self):
        code, out = self.run_cli("sessions")
        self.assertEqual(code, 0)
        lines = out.splitlines()
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0].startswith("joined-1  ?  started=200"))
        self.assertTrue(lines[0].endswith(")"))  # the "joined" mark, in either language
        self.assertEqual(lines[1], f"{SID}  my-app  started=100")


class UninstallCommandTest(unittest.TestCase):
    def test_game_saves_are_deleted_and_nothing_else(self):
        root = temp_dir(self)
        data = os.path.join(root, "data")
        for folder in ("game", os.path.join("dlc", "last-commit-standing"), "backups"):
            os.makedirs(os.path.join(data, folder))
        settings = os.path.join(root, "settings.json")
        with (
            mock.patch.object(cli.paths, "DATA_DIR", data),
            mock.patch.object(cli.paths, "GAME_DATA_DIR", os.path.join(data, "game")),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            cli.main(["uninstall", "--settings", settings, "--yes", "--delete-game-data"])
        self.assertEqual(os.listdir(data), ["backups"])

    def test_a_linked_saves_folder_loses_only_the_link(self):
        root = temp_dir(self)
        outside = temp_dir(self)
        with open(os.path.join(outside, "keep.json"), "w") as f:
            f.write("{}")
        os.symlink(outside, os.path.join(root, "game"))
        cli.paths.delete_game_data(os.path.join(root, "game"))
        self.assertEqual(os.listdir(root), [])
        self.assertEqual(os.listdir(outside), ["keep.json"])

    def test_save_key_with_a_newline_is_refused(self):
        self.assertIsNone(cli.paths.KEY_RE.match("records\n"))


class MigrationTest(unittest.TestCase):
    def test_arena_saves_move_once(self):
        data = temp_dir(self)
        old = os.path.join(data, "dlc", "last-commit-standing")
        os.makedirs(old)
        with open(os.path.join(old, "records.json"), "w") as f:
            f.write("{}")
        cli.paths.migrate_game_data(data)
        self.assertEqual(os.listdir(os.path.join(data, "game")), ["records.json"])
        self.assertFalse(os.path.exists(old))

        # Saves already in place are never overwritten by an old copy.
        os.makedirs(old)
        cli.paths.migrate_game_data(data)
        self.assertTrue(os.path.isdir(old))
        self.assertEqual(os.listdir(os.path.join(data, "game")), ["records.json"])

    def test_a_linked_arena_folder_is_not_moved(self):
        data = temp_dir(self)
        outside = temp_dir(self)
        os.makedirs(os.path.join(data, "dlc"))
        os.symlink(outside, os.path.join(data, "dlc", "last-commit-standing"))
        cli.paths.migrate_game_data(data)
        self.assertFalse(os.path.lexists(os.path.join(data, "game")))


class InstallCommandTest(unittest.TestCase):
    def test_install_into_a_copy_leaves_the_real_database_alone(self):
        root = temp_dir(self)
        settings = os.path.join(root, "settings.json")
        never = mock.Mock(side_effect=AssertionError("the real database was opened"))
        with (
            mock.patch.object(cli, "_open_store", never),
            mock.patch.object(cli.claude_settings.paths, "BACKUPS_DIR", os.path.join(root, "b")),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            self.assertEqual(cli.main(["install", "--settings", settings, "--yes"]), 0)
        self.assertTrue(os.path.exists(settings))


if __name__ == "__main__":
    unittest.main()
