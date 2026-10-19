"""The JS bridge without a window: what the game page can and cannot reach."""

import json
import os
import unittest
from unittest import mock

from sidequest import app, i18n, paths
from sidequest.core import Core

from .helpers import SID, raw, temp_dir


class GamePageTest(unittest.TestCase):
    """The GTK bridge guard takes messages only while the window shows this page."""

    def test_only_the_game_page_counts(self):
        page = paths.GAME_PAGE
        spaced = "/home/someone/My Projects/sidequest/game/index.html"
        self.assertTrue(app.is_game_page("file://" + page))
        self.assertTrue(app.is_game_page("file://localhost" + page))
        with mock.patch.object(paths, "GAME_PAGE", spaced):
            self.assertTrue(
                app.is_game_page("file:///home/someone/My%20Projects/sidequest/game/index.html")
            )
        for other in (
            "file://" + page + ".evil.html",
            "file:///tmp/evil.html",
            "file://evil.example" + page,
            "https://example.com" + page,
            "about:blank",
            None,
            "",
        ):
            with self.subTest(other=other):
                self.assertFalse(app.is_game_page(other))


class BridgeTest(unittest.TestCase):
    def make(self, dev=False):
        self.dir = temp_dir(self)
        core = Core(
            db_path=os.path.join(self.dir, "t.db"), socket_path=os.path.join(self.dir, "s.sock")
        )
        self.addCleanup(core.store.close)
        settings = os.path.join(self.dir, "settings.json")
        for name, folder in (("GAME_DATA_DIR", "game"), ("BACKUPS_DIR", "backups")):
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

    def test_page_gets_functions_not_the_bridge(self):
        _, bridge = self.make()
        exposed = {f.__name__: f for f in app.exposed(bridge)}
        self.assertIn("drain", exposed)
        self.assertFalse([n for n in exposed if n.startswith("_") or "." in n])
        self.assertEqual(exposed["drain"](), [])
        # pywebview finds an exposed function by its exact name; with no js_api object
        # there is nothing to walk a dotted name like "_core.store._db.execute" through.
        self.assertNotIn("_core", dir(exposed["drain"]))

    def test_quit_closes_the_window(self):
        _, bridge = self.make()
        bridge.quit()  # no window yet: nothing to close
        bridge._window = mock.Mock()
        bridge.quit()
        bridge._window.destroy.assert_called_once_with()

    def test_dev_methods_need_dev_flag(self):
        _, bridge = self.make(dev=False)
        for call in (
            lambda: bridge.dev_send("tool"),
            bridge.dev_sources,
            bridge.dev_taint,
            bridge.dev_sessions,
        ):
            with self.assertRaises(PermissionError):
                call()

    def test_dev_send_is_not_stored_and_taints_match(self):
        core, bridge = self.make(dev=True)
        bridge.match_start()
        bridge.dev_send("tool", {"tool": "Edit", "nested": {"x": 1}})
        sent = bridge.drain()[-1]
        self.assertTrue(sent["replay"])
        self.assertNotIn("nested", sent)
        bridge.dev_send("tool", {"tool": "Bash", "git": ["commit", "push"], "bad": [1]})
        sent = bridge.drain()[-1]
        self.assertEqual(sent["git"], ["commit", "push"])
        self.assertNotIn("bad", sent)
        self.assertEqual(core.store.session_events("dev"), [])
        self.assertEqual(bridge.match_end({"score": 1}), {"counted": False})
        with self.assertRaises(ValueError):
            bridge.dev_send("session_end")

    def test_past_sessions_for_a_ghost(self):
        core, bridge = self.make()
        core.on_payload(raw("SessionStart", source="startup"), 100.0)
        for i in range(app.GHOST_MIN_ACTIONS):
            core.on_payload(
                raw(
                    "PreToolUse",
                    tool_name="Read",
                    tool_use_id=f"t{i}",
                    tool_input={"file_path": "/x/a.py"},
                ),
                101.0 + i,
            )
            core.on_payload(
                raw(
                    "PostToolUse",
                    tool_name="Read",
                    tool_use_id=f"t{i}",
                    tool_input={"file_path": "/x/a.py"},
                    tool_response={},
                ),
                101.5 + i,
            )
        other = "99999999-2222-3333-4444-555555555555"
        core.on_payload(raw("SessionStart", sid=other, source="startup"), 200.0)
        sessions = bridge.past_sessions()
        self.assertEqual([s["session"] for s in sessions], [SID])  # too short: not listed
        self.assertEqual(sessions[0]["actions"], app.GHOST_MIN_ACTIONS)
        self.assertEqual(sessions[0]["duration"], 10.5)
        events = bridge.session_events(SID)
        self.assertEqual(events[0]["t"], 0)
        self.assertEqual(events[-1]["t"], 10.5)
        self.assertTrue(all("ts" not in e for e in events))
        self.assertEqual(bridge.session_events("nope"), [])
        json.dumps(sessions + events)

    def test_language_setting(self):
        _, bridge = self.make()
        self.addCleanup(i18n.set_language, i18n.language())
        self.assertEqual(bridge.get_settings()["language"], "en")  # English by default
        self.assertEqual(bridge.set_setting("language", "fr"), "en")  # unknown -> English
        self.assertEqual(bridge.set_setting("language", "auto"), "auto")
        self.assertEqual(bridge.set_setting("language", "en"), "en")
        self.assertEqual(bridge.get_settings()["lang"], "en")
        self.assertEqual(bridge.profile()["name"], "Player")
        bridge.set_setting("language", "ru")
        self.assertEqual(bridge.get_settings()["lang"], "ru")

    def test_saves_are_confined(self):
        _, bridge = self.make()
        bridge.save("save", {"level": 3})
        self.assertEqual(bridge.load("save"), {"level": 3})
        self.assertIsNone(bridge.load("missing"))
        for key in ("../../db", "Save", "a/b", "", "save\n", None, ["save"]):
            with self.subTest(key=key), self.assertRaises(ValueError):
                bridge.save(key, 1)
        self.assertEqual(os.listdir(os.path.join(self.dir, "game")), ["save.json"])

    def test_saves_refuse_a_linked_folder(self):
        _, bridge = self.make()
        outside = temp_dir(self)
        os.symlink(outside, os.path.join(self.dir, "game"))
        with self.assertRaises(ValueError):
            bridge.save("save", 1)
        self.assertEqual(os.listdir(outside), [])

    def test_saves_do_not_follow_links_inside_the_folder(self):
        _, bridge = self.make()
        bridge.save("save", 1)
        outside = os.path.join(temp_dir(self), "secret.json")
        with open(outside, "w") as f:
            f.write('"keep"')
        game = os.path.join(self.dir, "game")
        os.symlink(outside, os.path.join(game, "linked.json"))
        with self.assertRaises(OSError):
            bridge.load("linked")
        bridge.save("linked", 2)  # replaces the link, never writes through it
        with open(outside) as f:
            self.assertEqual(f.read(), '"keep"')
        self.assertFalse(os.path.islink(os.path.join(game, "linked.json")))
        self.assertEqual(sorted(os.listdir(game)), ["linked.json", "save.json"])

    def test_saves_refuse_nan(self):
        _, bridge = self.make()
        with self.assertRaises(ValueError):
            bridge.save("save", {"x": float("nan")})
        # A save edited by hand with NaN or 1e400 is refused on the way back too: the page
        # could not read it.
        for text in ('{"x": NaN}', '{"x": 1e400}'):
            with open(os.path.join(paths.GAME_DATA_DIR, "edited.json"), "w") as f:
                f.write(text)
            with self.assertRaises(ValueError):
                bridge.load("edited")

    def test_balance_is_the_games(self):
        _, bridge = self.make()
        self.assertIn("player", bridge.balance())

    def test_match_counted_normally(self):
        _, bridge = self.make()
        bridge.match_start()
        self.assertEqual(bridge.match_end({"score": 7}), {"counted": True})
        self.assertEqual(bridge.load("stats")["matches"], 1)

    def test_avatar_is_checked_and_stored(self):
        _, bridge = self.make()
        self.assertIsNone(bridge.profile()["avatar"])
        value = {
            "source": "upload",
            "size": 16,
            "palette": ["#000000"],
            "frames": [{"pixels": "0" * 256, "delay": 100}],
            "file": "/etc/passwd",
        }
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
        self.assertEqual(bridge.set_setting("screen_shake", 0.3), 0.5)
        self.assertEqual(bridge.set_setting("screen_shake", -5), 0)
        self.assertIs(bridge.set_setting("outline", "yes"), False)
        self.assertIs(bridge.set_setting("outline", True), True)
        self.assertEqual(bridge.set_setting("ui_scale", 9), 1.5)
        self.assertEqual(bridge.get_settings()["ui_scale"], 1.5)
        with self.assertRaises(ValueError):
            bridge.set_setting("anything", 1)

    def test_install_and_uninstall_from_the_page(self):
        _, bridge = self.make()
        preview = bridge.install_preview()
        self.assertTrue(preview["ok"] and preview["changes"])
        with mock.patch.object(
            app.selfcheck,
            "check_version",
            return_value=(app.selfcheck.Result("v", True, "x"), "2.1.286"),
        ):
            self.assertTrue(bridge.install_apply()["ok"])
            self.assertTrue(bridge.status()["connected"])
            result = bridge.uninstall_apply()
        self.assertTrue(result["ok"])
        self.assertTrue(result["backup"].startswith(os.path.join(self.dir, "backups")))
        self.assertFalse(bridge.status()["connected"])

    def test_uninstall_may_delete_the_saves(self):
        _, bridge = self.make()
        bridge.save("records", {"x": 1})
        self.assertTrue(bridge.install_apply()["ok"])
        self.assertTrue(bridge.uninstall_apply(False, "yes")["ok"])  # only True deletes
        self.assertEqual(bridge.load("records"), {"x": 1})
        self.assertTrue(bridge.install_apply()["ok"])
        os.makedirs(os.path.join(self.dir, "dlc", "last-commit-standing"))
        self.assertTrue(bridge.uninstall_apply(False, True)["ok"])
        self.assertIsNone(bridge.load("records"))
        self.assertFalse(os.path.exists(os.path.join(self.dir, "dlc")))

    def test_live_session_status(self):
        core, bridge = self.make()
        core.on_payload(raw("SessionStart", source="startup"), 1.0)
        core.on_payload(raw("UserPromptSubmit", prompt="x", prompt_id="p"), 2.0)
        core.on_payload(raw("PermissionRequest", tool_name="Write"), 3.0)
        status = bridge.status()
        self.assertEqual(
            status["sessions"], [{"session": SID, "project": "my-app", "status": "waiting"}]
        )
        self.assertEqual(status["paused"][0]["reason"], "waiting")
        self.assertEqual(bridge.live_sessions(), status["sessions"])


if __name__ == "__main__":
    unittest.main()
