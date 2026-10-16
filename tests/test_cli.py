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
        store.add_event(
            {"kind": "session_start", "session": SID, "project": "my-app", "ts": 100.0}
        )
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
    def test_dlc_data_outside_its_folder_is_never_deleted(self):
        root = temp_dir(self)
        dlc_data = os.path.join(root, "data", "dlc")
        os.makedirs(os.path.join(dlc_data, "arena"))
        settings = os.path.join(root, "settings.json")
        with mock.patch.object(cli.paths, "DLC_DATA_DIR", dlc_data):
            err = io.StringIO()
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
                cli.main(
                    [
                        "uninstall",
                        "--settings",
                        settings,
                        "--yes",
                        "--delete-dlc-data",
                        "..",
                        "arena",
                    ]
                )
        self.assertTrue(os.path.isdir(dlc_data))
        self.assertFalse(os.path.exists(os.path.join(dlc_data, "arena")))
        self.assertIn("..", err.getvalue())

    def test_dlc_id_with_a_newline_is_refused(self):
        self.assertIsNone(cli.paths.DLC_ID_RE.match("arena\n"))


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
