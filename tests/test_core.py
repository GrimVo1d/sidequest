import os
import threading
import time
import unittest

from sidequest import i18n, replay, selfcheck
from sidequest.core import Core
from sidequest.db import Store

from .helpers import SID, post, pre, raw, temp_dir


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class CoreTest(unittest.TestCase):
    def setUp(self):
        self.dir = temp_dir(self)
        self.clock = FakeClock()
        self.core = Core(
            db_path=os.path.join(self.dir, "t.db"),
            socket_path=os.path.join(self.dir, "s.sock"),
            clock=self.clock,
        )
        self.addCleanup(self.core.store.close)
        self.seen = []
        self.core.subscribe(self.seen.append)

    def feed(self, payload):
        self.core.on_payload(payload, self.clock.now)

    def kinds(self):
        return [e["kind"] for e in self.seen]

    def working_session(self):
        self.feed(raw("SessionStart", source="startup"))
        self.feed(raw("UserPromptSubmit", prompt="x", prompt_id="p1"))

    def test_events_are_stored(self):
        self.working_session()
        stored = self.core.store.session_events(SID)
        self.assertEqual([e["kind"] for e in stored], ["session_start", "prompt"])
        self.assertEqual(self.core.store.sessions()[0]["project"], "my-app")

    def test_silence_pause_and_resume_by_activity(self):
        self.working_session()
        self.clock.now += 89
        self.core.check_silence()
        self.assertNotIn("silent", self.kinds())
        self.clock.now += 2
        self.core.check_silence()
        self.core.check_silence()  # only once
        self.assertEqual(self.kinds().count("silent"), 1)
        self.assertEqual(self.core.paused_sessions(), {SID: "silent"})
        self.feed(post("Read", "t1", {"file_path": "/x"}, {}))
        self.assertEqual(self.kinds()[-2:], ["resumed", "tool"])
        self.assertEqual(self.core.paused_sessions(), {})

    def test_session_joined_midway_is_working(self):
        # Sidequest opened while the agent was already busy: no prompt, just its tools.
        self.feed(post("Read", "t1", {"file_path": "/x"}, {}))
        self.assertEqual(self.kinds(), ["session_start", "tool"])
        self.assertEqual(self.core.session_status(SID), "working")
        self.feed(raw("Stop", stop_hook_active=False))
        self.assertEqual(self.core.session_status(SID), "idle")

    def test_silence_threshold_is_a_setting(self):
        self.core.store.set_setting("silence_pause_seconds", 10)
        self.working_session()
        self.clock.now += 11
        self.core.check_silence()
        self.assertIn("silent", self.kinds())

    def test_no_silence_after_final_stop(self):
        self.working_session()
        self.feed(raw("Stop", background_tasks=[]))
        self.clock.now += 1000
        self.core.check_silence()
        self.assertNotIn("silent", self.kinds())

    def test_no_silence_while_waiting(self):
        self.working_session()
        self.feed(raw("PermissionRequest", tool_name="Write"))
        self.clock.now += 1000
        self.core.check_silence()
        self.assertNotIn("silent", self.kinds())
        self.assertEqual(self.core.paused_sessions(), {SID: "waiting"})

    def test_notification_does_not_count_as_activity(self):
        self.working_session()
        self.clock.now += 91
        self.core.check_silence()
        self.feed(raw("Notification", notification_type="idle_prompt", message="x"))
        self.assertEqual(self.core.paused_sessions(), {SID: "silent"})

    def test_continue_button(self):
        self.working_session()
        self.feed(raw("PermissionRequest", tool_name="Write"))
        self.core.resume()
        self.assertEqual(self.kinds()[-1], "resumed")
        self.assertEqual(self.seen[-1]["source"], "button")
        self.assertEqual(self.core.paused_sessions(), {})

    def test_end_match_button(self):
        self.working_session()
        self.clock.now += 91
        self.core.check_silence()
        self.core.end_match(SID)
        self.assertEqual(self.kinds()[-2:], ["resumed", "stop"])
        self.assertTrue(self.seen[-1]["final"] and self.seen[-1]["manual"])
        self.clock.now += 1000
        self.core.check_silence()
        self.assertEqual(self.kinds().count("silent"), 1)

    def test_selftest_payload_is_consumed(self):
        token = self.core.probe.arm()
        self.feed({"hook_event_name": selfcheck.SELFTEST_EVENT, "token": token})
        self.assertEqual(self.seen, [])
        self.assertTrue(self.core.probe.wait(0))

    def test_real_events_hidden_during_replay_but_stored(self):
        self.core.replaying = True
        self.working_session()
        self.assertEqual(self.seen, [])
        self.assertEqual(len(self.core.store.session_events(SID)), 2)
        self.core.publish({"ts": 1, "session": "r", "project": "p", "kind": "tool", "replay": True})
        self.assertEqual(self.kinds(), ["tool"])
        self.assertEqual(self.core.store.session_events("r"), [])  # replays never count

    def test_replayed_pause_shows_banner_but_is_never_stored(self):
        self.core.publish(
            {
                "ts": 1,
                "session": "r",
                "project": "p",
                "kind": "waiting",
                "tool": "Write",
                "replay": True,
            }
        )
        self.assertEqual(self.core.paused_sessions(), {"r": "waiting"})
        self.core.resume()
        self.assertTrue(self.seen[-1]["replay"])
        self.assertEqual(self.core.paused_sessions(), {})
        self.core.publish(
            {
                "ts": 2,
                "session": "r",
                "project": "p",
                "kind": "silent",
                "seconds": 90,
                "replay": True,
            }
        )
        self.core.clear_replay_pauses()
        self.assertEqual(self.core.paused_sessions(), {})
        self.assertEqual(self.core.store.session_events("r"), [])

    def test_control_session_marks_version_verified(self):
        self.core.start_control_session("9.9.9")
        self.working_session()
        tool_input = {"command": "ls"}
        self.feed(pre("Bash", "t1", tool_input))
        self.feed(post("Bash", "t1", tool_input, {}))
        self.feed(raw("PostToolBatch", tool_calls=[]))
        self.feed(raw("Stop", background_tasks=[]))
        self.feed(raw("SessionEnd", reason="exit"))
        self.assertEqual(self.core.control_report, [])
        self.assertEqual(self.core.store.verified_version(), "9.9.9")

    def test_control_session_reports_missing_fields(self):
        # The report is in the user's language; this checks the Russian texts.
        self.addCleanup(i18n.set_language, i18n.language())
        i18n.set_language("ru")
        self.core.start_control_session("9.9.9")
        self.working_session()
        p = pre("Bash", "t1", {"command": "ls"})
        del p["tool_use_id"]
        self.feed(p)
        self.feed(raw("SessionEnd", reason="exit"))
        self.assertIn("в PreToolUse нет поля tool_use_id", self.core.control_report)
        self.assertIn("не было PostToolUse", self.core.control_report)
        self.assertEqual(self.core.store.verified_version(), "2.1.286")


class ReplayTest(unittest.TestCase):
    def setUp(self):
        self.dir = temp_dir(self)

    def scenario(self, lines):
        path = os.path.join(self.dir, "s.jsonl")
        with open(path, "w") as f:
            f.write("\n".join(lines) + "\n")
        return path

    def test_load_validates(self):
        with self.assertRaises(ValueError):
            replay.load(self.scenario(['{"kind": "tool"}']))
        events = replay.load(
            self.scenario(
                ["// comment", "", '{"t": 2, "kind": "stop"}', '{"t": 0, "kind": "prompt"}']
            )
        )
        self.assertEqual([e["kind"] for e in events], ["prompt", "stop"])

    def test_load_refuses_nan_and_odd_types(self):
        for line in (
            '{"t": NaN, "kind": "stop"}',
            '{"t": "1", "kind": "stop"}',
            '{"t": true, "kind": "stop"}',
            '{"t": 1, "kind": ["stop"]}',
            '{"t": 1, "kind": "stop", "session": ["s"]}',
        ):
            with self.subTest(line=line), self.assertRaises(ValueError):
                replay.load(self.scenario([line]))

    def test_store_refuses_nan(self):
        store = Store(os.path.join(self.dir, "t.db"))
        self.addCleanup(store.close)
        with self.assertRaises(ValueError):
            store.add_event({"ts": 1.0, "session": "s", "kind": "tool", "x": float("nan")})
        with self.assertRaises(ValueError):
            store.set_meta("k", float("inf"))
        self.assertEqual(store.session_events("s"), [])

    def test_export_round_trip(self):
        store = Store(os.path.join(self.dir, "t.db"))
        self.addCleanup(store.close)
        for ts, kind in ((100.0, "session_start"), (101.5, "prompt"), (110.25, "stop")):
            store.add_event({"ts": ts, "session": "abcdef123", "project": "my proj", "kind": kind})
        path = replay.export_session(store, "abcdef123", os.path.join(self.dir, "rec"))
        self.assertTrue(path.endswith("my-proj-abcdef12.jsonl"))
        events = replay.load(path)
        self.assertEqual([e["t"] for e in events], [0, 1.5, 10.25])
        self.assertNotIn("ts", events[0])

    def test_player_plays_in_order_with_speed(self):
        events = [{"t": i * 0.1, "kind": "tool", "i": i} for i in range(5)]
        out, done = [], threading.Event()
        player = replay.Player(events, out.append, speed=10, on_finish=done.set)
        start = time.monotonic()
        player.start()
        self.assertTrue(done.wait(2))
        self.assertLess(time.monotonic() - start, 0.3)  # 0.4 s of events at x10
        self.assertEqual([e["i"] for e in out], list(range(5)))
        self.assertTrue(all(e["replay"] and "t" not in e for e in out))

    def test_pause_step_and_seek(self):
        events = [{"t": t, "kind": "tool", "i": i} for i, t in enumerate((0, 50, 100))]
        out = []
        player = replay.Player(events, out.append)
        player.pause()
        player.start()
        self.addCleanup(player.stop)
        player.step()
        self.assertEqual([e["i"] for e in out], [0])
        player.seek(100)
        player.pause(False)
        deadline = time.monotonic() + 1
        while len(out) < 2 and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual([e["i"] for e in out], [0, 2])  # event 1 was skipped

    def test_bad_speed(self):
        with self.assertRaises(ValueError):
            replay.Player([], print, speed=3)


if __name__ == "__main__":
    unittest.main()
