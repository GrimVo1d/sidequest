"""The JS bridge without a window: what the hub and DLC can and cannot reach."""
import json
import os
import unittest
from unittest import mock

from sidequest import app, paths
from sidequest.core import Core

from .helpers import SID, raw, temp_dir


class BridgeTest(unittest.TestCase):
    def make(self, dev=False):
        self.dir = temp_dir(self)
        core = Core(db_path=os.path.join(self.dir, "t.db"),
                    socket_path=os.path.join(self.dir, "s.sock"))
        self.addCleanup(core.store.close)
        settings = os.path.join(self.dir, "settings.json")
        for name, folder in (("DLC_DATA_DIR", "dlc"), ("BACKUPS_DIR", "backups")):
            patcher = mock.patch.object(paths, name, os.path.join(self.dir, folder))
            patcher.start()
            self.addCleanup(patcher.stop)
        return core, app.Bridge(core, dev, settings)

    def test_events_are_pulled_as_data(self):
        core, bridge = self.make()
        core.on_payload(raw("SessionStart", source="startup"), 1.0)
        events = bridge.drain()
        self.assertEqual([e["kind"] for e in events], ["session_start"])
        self.assertEqual(bridge.drain(), [])
        json.dumps(bridge.status())  # everything the page gets is plain JSON

    def test_only_public_methods_are_exposed(self):
        _, bridge = self.make()
        public = [n for n in dir(bridge) if not n.startswith("_")]
        self.assertNotIn("core", public)
        for name in public:
            self.assertTrue(callable(getattr(bridge, name)), name)

    def test_dev_methods_need_dev_flag(self):
        _, bridge = self.make(dev=False)
        for call in (lambda: bridge.dev_send("tool"), bridge.dev_sources,
                     bridge.dev_taint, bridge.dev_sessions):
            with self.assertRaises(PermissionError):
                call()

    def test_dev_send_is_not_stored_and_taints_match(self):
        core, bridge = self.make(dev=True)
        bridge.match_start("arena")
        bridge.dev_send("tool", {"tool": "Edit", "nested": {"x": 1}})
        sent = bridge.drain()[-1]
        self.assertTrue(sent["replay"])
        self.assertNotIn("nested", sent)
        self.assertEqual(core.store.session_events("dev"), [])
        self.assertEqual(bridge.match_end("arena", {"score": 1}), {"counted": False})
        with self.assertRaises(ValueError):
            bridge.dev_send("session_end")

    def test_dlc_storage_is_confined(self):
        _, bridge = self.make()
        bridge.dlc_save("arena", "save", {"level": 3})
        self.assertEqual(bridge.dlc_load("arena", "save"), {"level": 3})
        self.assertIsNone(bridge.dlc_load("arena", "missing"))
        for dlc_id, key in (("../x", "save"), ("arena", "../../db"), ("Arena", "s"),
                            ("arena", "a/b"), ("", "s")):
            with self.assertRaises(ValueError):
                bridge.dlc_save(dlc_id, key, 1)

    def test_match_counted_normally(self):
        _, bridge = self.make()
        bridge.match_start("arena")
        self.assertEqual(bridge.match_end("arena", {"score": 7}), {"counted": True})
        self.assertEqual(bridge.dlc_load("arena", "stats")["matches"], 1)

    def test_avatar_is_checked_and_stored(self):
        _, bridge = self.make()
        self.assertIsNone(bridge.profile()["avatar"])
        value = {"source": "upload", "size": 16, "palette": ["#000000"],
                 "frames": [{"pixels": "0" * 256, "delay": 100}], "file": "/etc/passwd"}
        stored = bridge.set_avatar(value)
        self.assertNotIn("file", stored)
        self.assertEqual(bridge.profile()["avatar"], stored)
        with self.assertRaises(ValueError):
            bridge.set_avatar(dict(value, size=1000))
        self.assertEqual(bridge.profile()["avatar"], stored)
        self.assertIsNone(bridge.set_avatar(None))
        self.assertIsNone(bridge.profile()["avatar"])

    def test_settings_are_clamped(self):
        _, bridge = self.make()
        self.assertEqual(bridge.set_setting("silence_pause_seconds", 1), 10)
        self.assertEqual(bridge.set_setting("fps_limit", 45), 60)
        self.assertEqual(bridge.get_settings()["silence_pause_seconds"], 10)

    def test_install_and_uninstall_from_hub(self):
        _, bridge = self.make()
        preview = bridge.install_preview()
        self.assertTrue(preview["ok"] and preview["changes"])
        with mock.patch.object(app.selfcheck, "check_version",
                               return_value=(app.selfcheck.Result("v", True, "x"), "2.1.286")):
            self.assertTrue(bridge.install_apply()["ok"])
            self.assertTrue(bridge.status()["connected"])
            result = bridge.uninstall_apply()
        self.assertTrue(result["ok"])
        self.assertTrue(result["backup"].startswith(os.path.join(self.dir, "backups")))
        self.assertFalse(bridge.status()["connected"])

    def test_live_session_status(self):
        core, bridge = self.make()
        core.on_payload(raw("SessionStart", source="startup"), 1.0)
        core.on_payload(raw("UserPromptSubmit", prompt="x", prompt_id="p"), 2.0)
        core.on_payload(raw("PermissionRequest", tool_name="Write"), 3.0)
        status = bridge.status()
        self.assertEqual(status["sessions"], [{"session": SID, "project": "my-app",
                                               "status": "waiting"}])
        self.assertEqual(status["paused"][0]["reason"], "waiting")


if __name__ == "__main__":
    unittest.main()
