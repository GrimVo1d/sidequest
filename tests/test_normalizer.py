import json
import time
import unittest

from sidequest.normalizer import MAX_FILE, Normalizer, bash_category, git_ops

from .helpers import CWD, SID, batch, post, pre, raw

SECRET = "TOP-SECRET-CONTENT"


def kinds(events):
    return [e["kind"] for e in events]


class BashCategoryTest(unittest.TestCase):
    def test_categories(self):
        cases = {
            "python3 -m unittest": "test",
            "python -m pytest -q tests/": "test",
            "cd app && npm test": "test",
            "npm run test -- --watch=false": "test",
            "FOO=1 uv run pytest": "test",
            "go test ./...": "test",
            "cargo build --release": "build",
            "make": "build",
            "npm run build": "build",
            "git status": "git",
            "gh pr view 12": "git",
            "/usr/bin/git log | head": "git",
            "git add . && make test": "test",
            "ls -la": "search",
            'grep -rn "def" --include="*.py" src': "search",
            'find . -name "*.py"': "search",
            "cd src && ls": "search",
            "rg TODO | head -20": "search",
            "wc -l /x/calc.py": "search",
            "cat data.txt | python3 run.py": "other",
            "ls && rm -rf build": "other",
            "git grep foo": "git",
            "grep -q x f && pytest": "test",
            "cd src": "other",
            'echo "hi"': "other",
            'python3 -c "raise SystemExit(1)"': "other",
            "echo 'unterminated": "other",
            "": "other",
        }
        for command, expected in cases.items():
            with self.subTest(command=command):
                self.assertEqual(bash_category(command), expected)

    def test_huge_command_is_classified_by_its_start(self):
        command = "git commit -m x && cat <<'EOF' > big.txt\n" + "a b 'c\n" * 2_000_000
        start = time.monotonic()
        self.assertEqual(bash_category(command), "git")
        self.assertEqual(git_ops(command), ["commit"])
        self.assertLess(time.monotonic() - start, 1)

    def test_git_ops(self):
        cases = {
            'git commit -m "x"': ["commit"],
            "git add . && git commit -qm wip && git push": ["commit", "push"],
            "git -C repo push origin main": ["push"],
            "git -c user.name=x commit --amend": ["commit"],
            "gh pr create --fill": ["push"],
            "gh pr merge 12": ["push"],
            "gh pr view 12": [],
            "git status": [],
            "git log --grep commit": [],
            "echo push | git commit -F -": ["commit"],
            "": [],
        }
        for command, expected in cases.items():
            with self.subTest(command=command):
                self.assertEqual(git_ops(command), expected)


class NormalizerTest(unittest.TestCase):
    def setUp(self):
        self.n = Normalizer()
        self.t = 0.0

    def feed(self, payload):
        self.t += 1
        return self.n.process(payload, self.t)

    def start(self):
        events = self.feed(raw("SessionStart", source="startup", model="m"))
        self.feed(raw("InstructionsLoaded", file_path="/x/CLAUDE.md", memory_type="User"))
        self.feed(raw("UserPromptSubmit", prompt=SECRET, prompt_id="p1", permission_mode="default"))
        return events

    def test_session_start_and_project(self):
        events = self.start()
        self.assertEqual(kinds(events), ["session_start"])
        self.assertFalse(events[0]["joined"])
        self.assertEqual(events[0]["project"], "my-app")

    def test_joined_mid_session(self):
        events = self.feed(raw("UserPromptSubmit", prompt="x", prompt_id="p1"))
        self.assertEqual(kinds(events), ["session_start", "prompt"])
        self.assertTrue(events[0]["joined"])

    def test_edit_counts_lines_and_drops_content(self):
        self.start()
        tool_input = {
            "file_path": "/Users/someone/code/my-app/src/auth.py",
            "old_string": SECRET,
            "new_string": SECRET,
            "replace_all": False,
        }
        response = {
            "filePath": tool_input["file_path"],
            "oldString": SECRET,
            "newString": SECRET,
            "originalFile": SECRET,
            "structuredPatch": [
                {
                    "oldStart": 1,
                    "oldLines": 2,
                    "newStart": 1,
                    "newLines": 4,
                    "lines": [" a", "-" + SECRET, "+b", "+c", "+d"],
                }
            ],
        }
        self.assertEqual(self.feed(pre("Edit", "t1", tool_input)), [])
        events = self.feed(post("Edit", "t1", tool_input, response))
        self.assertEqual(len(events), 1)
        e = events[0]
        self.assertEqual(
            (e["kind"], e["tool"], e["action"], e["file"]),
            ("tool", "Edit", "attack", "src/auth.py"),
        )
        self.assertEqual((e["lines_added"], e["lines_removed"], e["ok"]), (3, 1, True))
        self.assertNotIn(SECRET, json.dumps(events))
        self.assertEqual(self.feed(batch(("Edit", "t1"))), [])

    def test_write_new_file_counts_content_lines(self):
        self.start()
        tool_input = {"file_path": "/elsewhere/notes.txt", "content": "a\nb\nc\n"}
        response = {
            "type": "create",
            "filePath": "/elsewhere/notes.txt",
            "content": "a\nb\nc\n",
            "structuredPatch": [],
            "originalFile": None,
        }
        e = self.feed(post("Write", "t1", tool_input, response))[0]
        self.assertEqual((e["lines_added"], e["lines_removed"]), (3, 0))
        self.assertEqual(e["file"], "notes.txt")  # outside the project: name only

    def test_bash_failure_keeps_only_exit_code(self):
        self.start()
        tool_input = {"command": "git push --force origin main", "description": SECRET}
        self.feed(pre("Bash", "t1", tool_input))
        events = self.feed(
            raw(
                "PostToolUseFailure",
                tool_name="Bash",
                tool_use_id="t1",
                tool_input=tool_input,
                is_interrupt=False,
                duration_ms=5,
                error="Exit code 128\nfatal: " + SECRET,
            )
        )
        e = events[0]
        self.assertEqual(
            (e["kind"], e["category"], e["git"], e["exit_code"], e["ok"]),
            ("tool_error", "git", ["push"], 128, False),
        )
        self.assertNotIn(SECRET, json.dumps(events))
        self.assertNotIn("git push", json.dumps(events))

    def test_bash_search_is_scouting(self):
        self.start()
        tool_input = {"command": "grep -rn " + SECRET + " src", "description": "x"}
        e = self.feed(post("Bash", "t1", tool_input, {"stdout": SECRET}))[0]
        self.assertEqual((e["tool"], e["action"], e["category"]), ("Bash", "scout", "search"))
        self.assertNotIn(SECRET, json.dumps(e))
        e = self.feed(post("Bash", "t2", {"command": "make"}, {}))[0]
        self.assertEqual((e["action"], e["category"]), ("cast", "build"))
        self.assertNotIn("git", e)
        e = self.feed(post("Bash", "t3", {"command": "git commit -m " + SECRET}, {}))[0]
        self.assertEqual((e["category"], e["git"]), ("git", ["commit"]))
        self.assertNotIn(SECRET, json.dumps(e))

    def test_deny_rule_is_blocked_via_batch(self):
        self.start()
        self.feed(pre("Bash", "t1", {"command": "echo forbidden"}))
        self.feed(raw("MessageDisplay", delta=SECRET, final=True, index=0))
        events = self.feed(batch(("Bash", "t1")))
        self.assertEqual(kinds(events), ["blocked"])
        self.assertEqual((events[0]["tool"], events[0]["reason"]), ("Bash", "rule"))

    def test_claude_code_block_without_pre_tool_use(self):
        self.start()
        events = self.feed(batch(("Bash", "t9")))
        self.assertEqual(kinds(events), ["blocked"])

    def test_parallel_batch_only_flags_unfinished_calls(self):
        self.start()
        for tid in ("a", "b", "c"):
            self.feed(pre("Read", tid, {"file_path": "/x"}))
        self.feed(post("Read", "a", {"file_path": "/x"}, {}))
        self.feed(post("Read", "c", {"file_path": "/x"}, {}))
        events = self.feed(batch(("Read", "a"), ("Read", "b"), ("Read", "c")))
        self.assertEqual(kinds(events), ["blocked"])

    def test_permission_wait_and_resume(self):
        self.start()
        self.feed(pre("Write", "t1", {"file_path": "/x", "content": "y"}))
        events = self.feed(
            raw("PermissionRequest", tool_name="Write", tool_input={}, permission_suggestions=[])
        )
        self.assertEqual(kinds(events), ["waiting"])
        self.assertEqual(events[0]["tool"], "Write")
        self.assertEqual(
            self.feed(raw("Notification", notification_type="permission_prompt", message="x")), []
        )
        events = self.feed(
            post("Write", "t1", {"file_path": "/x", "content": "y"}, {"structuredPatch": []})
        )
        self.assertEqual(kinds(events), ["resumed", "tool"])

    def test_subagent_events_do_not_end_main_pause(self):
        self.start()
        self.feed(raw("SubagentStart", agent_id="ag1", agent_type="general-purpose"))
        self.feed(raw("PermissionRequest", tool_name="AskUserQuestion", tool_input={}))
        events = self.feed(
            post(
                "Bash",
                "s1",
                {"command": "wc -l x"},
                {},
                agent_id="ag1",
                agent_type="general-purpose",
            )
        )
        self.assertEqual(kinds(events), ["tool"])
        self.assertEqual(events[0]["agent"], "ag1")
        events = self.feed(
            raw(
                "SubagentStop",
                agent_id="ag1",
                agent_type="general-purpose",
                last_assistant_message=SECRET,
                background_tasks=[],
            )
        )
        self.assertEqual(kinds(events), ["subagent_stop"])
        events = self.feed(post("AskUserQuestion", "q1", {}, {}))
        self.assertEqual(kinds(events), ["resumed", "tool"])
        self.assertEqual(events[1]["action"], "generic")

    def test_rejection_is_reported_on_next_prompt(self):
        self.start()
        self.feed(pre("Write", "t1", {"file_path": "/x", "content": "y"}))
        self.feed(raw("PermissionRequest", tool_name="Write", tool_input={}))
        events = self.feed(raw("UserPromptSubmit", prompt="go on", prompt_id="p2"))
        self.assertEqual(kinds(events), ["blocked", "resumed", "prompt"])
        self.assertEqual(events[0]["reason"], "rejected")

    def test_task_notification_is_not_a_prompt_and_keeps_pause(self):
        self.start()
        self.feed(raw("PermissionRequest", tool_name="Write", tool_input={}))
        events = self.feed(raw("UserPromptSubmit", prompt="<task-notification>", prompt_id="p1"))
        self.assertEqual(events, [])
        self.assertIsNotNone(self.n.sessions[SID].waiting)

    def test_stop_with_background_tasks_is_not_final(self):
        self.start()
        e = self.feed(
            raw(
                "Stop",
                background_tasks=[{"id": "a", "status": "running"}],
                last_assistant_message=SECRET,
            )
        )[0]
        self.assertEqual((e["kind"], e["background"], e["final"]), ("stop", 1, False))
        e = self.feed(raw("Stop", background_tasks=[]))[0]
        self.assertTrue(e["final"])

    def test_compaction(self):
        self.start()
        self.assertEqual(
            kinds(self.feed(raw("PreCompact", trigger="manual", custom_instructions=None))),
            ["compact"],
        )
        # Hidden compaction agent: SubagentStop without SubagentStart, empty type.
        self.assertEqual(
            self.feed(
                raw("SubagentStop", agent_id="hidden", agent_type="", last_assistant_message=SECRET)
            ),
            [],
        )
        self.assertEqual(self.feed(raw("SessionStart", source="compact")), [])
        events = self.feed(raw("PostCompact", trigger="manual", compact_summary=SECRET))
        self.assertEqual(events[0]["phase"], "end")
        self.assertNotIn(SECRET, json.dumps(events))

    def test_unknown_event_and_tool(self):
        self.start()
        events = self.feed(raw("BrandNewEvent", foo=SECRET))
        self.assertEqual(events[0]["kind"], "unknown")
        self.assertEqual(events[0]["event"], "BrandNewEvent")
        self.assertNotIn(SECRET, json.dumps(events))
        e = self.feed(post("mcp__thing__do", "t1", {}, {}))[0]
        self.assertEqual(e["action"], "generic")
        self.assertEqual(self.n.unknown_tools, {"mcp__thing__do": 1})

    def test_session_end_forgets_session(self):
        self.start()
        events = self.feed(raw("SessionEnd", reason="prompt_input_exit"))
        self.assertEqual(kinds(events), ["session_end"])
        self.assertNotIn(SID, self.n.sessions)

    def test_garbage_payloads(self):
        self.assertEqual(self.n.process(None, 1)[0]["kind"], "unknown")
        self.assertEqual(self.n.process({"x": 1}, 1)[0]["kind"], "unknown")
        self.assertEqual(self.n.process({"hook_event_name": "Stop"}, 1)[0]["kind"], "unknown")

    def test_shapes_record_names_only(self):
        self.start()
        dumped = json.dumps([list(k) for k in self.n.shapes])
        self.assertNotIn(SECRET, dumped)
        self.assertIn("prompt", dumped)


class HostileShapeTest(unittest.TestCase):
    """Any local process can write to the socket, so every field may have any type."""

    def setUp(self):
        self.n = Normalizer()
        self.n.process(raw("SessionStart", source="startup"), 1)
        self.n.process(raw("UserPromptSubmit", prompt_id="p1"), 2)

    def test_odd_types_never_raise(self):
        file = {"file_path": CWD + "/a"}
        shapes = [
            post("Bash", "t1", {"command": 123}, {}),
            post("Bash", "t2", {"command": ["git", "push"]}, {}),
            post("Read", ["x"], file, {}),
            pre("Read", {"a": 1}, file),
            post("Edit", "t3", file, {"structuredPatch": "abc"}),
            post("Edit", "t4", file, {"structuredPatch": [{"lines": [1, 2]}, "hunk"]}),
            post("Write", "t5", {"file_path": CWD + "/a", "content": ["a"]}, {}),
            post(["Edit"], "t6", file, {"structuredPatch": []}),
            raw("PostToolUseFailure", tool_name="Bash", tool_use_id="t7", error=1),
            raw("SubagentStart", agent_id=["a"], agent_type="x"),
            raw("SubagentStop", agent_id={"a": 1}, agent_type="x"),
            raw("PostToolBatch", tool_calls=[{"tool_use_id": ["q"], "tool_name": "Bash"}]),
            raw("PostToolBatch", tool_calls="calls"),
            raw("Stop", background_tasks=7),
            raw(["SessionStart"]),
        ]
        for t, payload in enumerate(shapes, start=3):
            with self.subTest(payload=payload):
                for event in self.n.process(payload, t):
                    self.assertIsInstance(event["kind"], str)

    def test_values_of_another_type_are_dropped(self):
        secret = {"code": SECRET}
        events = []
        events += self.n.process(raw("PermissionRequest", tool_name=secret), 3)
        events += self.n.process(
            post("Read", "z1", {"file_path": CWD + "/b"}, {}, agent_id=secret), 4
        )
        events += self.n.process(raw("PreCompact", trigger=secret), 5)
        events += self.n.process(raw("SessionEnd", reason=["x"]), 6)
        self.assertNotIn(SECRET, json.dumps(events))

    def test_odd_numbers_are_dropped(self):
        for value in (True, {"stdout": SECRET}, float("inf"), float("nan")):
            with self.subTest(value=value):
                payload = post("Read", "z2", {"file_path": CWD + "/b"}, {})
                payload["duration_ms"] = value
                self.assertIsNone(self.n.process(payload, 3)[0]["duration_ms"])

    def test_long_strings_are_cut(self):
        long = "x" * 100_000
        events = self.n.process(raw("SessionEnd", reason=long, sid="s" * 100_000), 3)
        self.assertLessEqual(len(json.dumps(events)), 2000)
        events = self.n.process(post("Read", "z3", {"file_path": CWD + "/" + long}, {}), 4)
        self.assertEqual(len(events[0]["file"]), MAX_FILE)

    def test_first_event_of_odd_shape_still_starts_the_session(self):
        n = Normalizer()
        payload = raw("PostToolUseFailure", sid="joined", tool_name="Bash", tool_use_id="a")
        payload["tool_input"] = {"command": "ls"}
        payload["error"] = {"msg": "x"}
        events = n.process(payload, 1)
        self.assertEqual(kinds(events)[0], "session_start")
        self.assertIn("joined", n.sessions)


if __name__ == "__main__":
    unittest.main()
