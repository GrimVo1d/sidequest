"""The real sidequest-emit.sh talking to the real receiver over a unix socket."""

import json
import os
import shutil
import socket
import stat
import subprocess
import threading
import time
import unittest
from unittest import mock

from sidequest import paths, receiver, selfcheck
from sidequest.receiver import (
    READ_DEADLINE,
    AlreadyRunningError,
    Receiver,
    SocketPathTooLongError,
)

from .helpers import temp_dir


class PipelineTest(unittest.TestCase):
    def setUp(self):
        root = temp_dir(self)
        os.makedirs(os.path.join(root, "hooks"))
        os.makedirs(os.path.join(root, "data"), mode=0o700)
        self.emit = os.path.join(root, "hooks", "sidequest-emit.sh")
        shutil.copy(paths.EMIT_SCRIPT, self.emit)
        self.sock = os.path.join(root, "data", "sidequest.sock")
        self.got = []
        self.arrived = threading.Event()

    def on_payload(self, payload, ts):
        self.got.append(payload)
        self.arrived.set()

    def start_receiver(self):
        receiver = Receiver(self.sock, self.on_payload)
        receiver.start()
        self.addCleanup(receiver.stop)
        return receiver

    def run_hook(self, data):
        start = time.monotonic()
        proc = subprocess.run(["/bin/sh", self.emit], input=data, capture_output=True, timeout=10)
        return proc, time.monotonic() - start

    def test_payload_arrives_intact(self):
        self.start_receiver()
        payload = {
            "hook_event_name": "PostToolUse",
            "session_id": "s",
            "tool_input": {"content": 'ünïcode "quotes" $(rm -rf /) `x`\n' * 3},
        }
        proc, _ = self.run_hook(json.dumps(payload).encode())
        self.assertEqual((proc.returncode, proc.stdout, proc.stderr), (0, b"", b""))
        self.assertTrue(self.arrived.wait(2))
        self.assertEqual(self.got, [payload])

    def test_large_payload(self):
        self.start_receiver()
        payload = {"hook_event_name": "PostToolUse", "blob": "a" * 5_000_000}
        proc, _ = self.run_hook(json.dumps(payload).encode())
        self.assertEqual(proc.returncode, 0)
        self.assertTrue(self.arrived.wait(5))
        self.assertEqual(len(self.got[0]["blob"]), 5_000_000)

    def test_receiver_survives_json_nested_too_deep(self):
        self.start_receiver()
        self.run_hook(b"[" * 200_000 + b"]" * 200_000)
        self.assertTrue(self.arrived.wait(5))
        self.assertEqual(self.got, [None])
        self.arrived.clear()
        self.run_hook(json.dumps({"hook_event_name": "Stop"}).encode())
        self.assertTrue(self.arrived.wait(2))
        self.assertEqual(self.got[-1], {"hook_event_name": "Stop"})

    def test_events_keep_order(self):
        self.start_receiver()
        for i in range(20):
            self.run_hook(json.dumps({"hook_event_name": "X", "i": i}).encode())
        deadline = time.monotonic() + 3
        while len(self.got) < 20 and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual([p["i"] for p in self.got], list(range(20)))

    def test_socket_is_private(self):
        self.start_receiver()
        self.assertEqual(stat.S_IMODE(os.stat(self.sock).st_mode), 0o600)

    def test_no_game_running(self):
        proc, elapsed = self.run_hook(b'{"hook_event_name": "Stop"}')
        self.assertEqual((proc.returncode, proc.stdout, proc.stderr), (0, b"", b""))
        self.assertLess(elapsed, 0.5)

    def test_stale_socket_after_crash(self):
        dead = socket.socket(socket.AF_UNIX)
        dead.bind(self.sock)
        dead.close()  # file stays, nobody listens
        proc, elapsed = self.run_hook(b'{"hook_event_name": "Stop"}')
        self.assertEqual((proc.returncode, proc.stdout), (0, b""))
        self.assertLess(elapsed, 0.5)
        self.start_receiver()  # the stale file is replaced
        self.run_hook(b'{"hook_event_name": "Stop"}')
        self.assertTrue(self.arrived.wait(2))

    def test_hung_receiver_does_not_hang_hook(self):
        server = socket.socket(socket.AF_UNIX)
        server.bind(self.sock)
        server.listen(1)  # accepts into the backlog but never reads
        self.addCleanup(server.close)
        proc, elapsed = self.run_hook(b"x" * 2_000_000)
        self.assertEqual(proc.returncode, 0)
        self.assertLess(elapsed, 3)

    def test_deep_project_folder(self):
        # The hook reaches the socket by a relative name, so a folder deeper than the
        # ~100 bytes a socket path may have still works.
        deep = os.path.join(temp_dir(self), "d" * 120)
        os.makedirs(os.path.join(deep, "hooks"))
        os.makedirs(os.path.join(deep, "data"), mode=0o700)
        shutil.copy(paths.EMIT_SCRIPT, os.path.join(deep, "hooks"))
        self.emit = os.path.join(deep, "hooks", "sidequest-emit.sh")
        self.addCleanup(os.chdir, os.getcwd())
        os.chdir(os.path.join(deep, "data"))  # the test receiver binds relatively too
        self.sock = "sidequest.sock"
        self.start_receiver()
        proc, _ = self.run_hook(b'{"hook_event_name": "Stop"}')
        self.assertEqual((proc.returncode, proc.stdout, proc.stderr), (0, b"", b""))
        self.assertTrue(self.arrived.wait(2))

    def test_too_long_socket_path_is_refused(self):
        with self.assertRaises(SocketPathTooLongError):
            Receiver("/" + "d" * 200 + "/sidequest.sock", self.on_payload).start()

    def test_path_does_not_choose_the_tools(self):
        self.start_receiver()
        fake = os.path.join(os.path.dirname(self.emit), "fake-bin")
        os.makedirs(fake)
        marker = os.path.join(fake, "ran")
        for tool in ("nc", "cat", "sleep"):
            with open(os.path.join(fake, tool), "w") as f:
                f.write(f"#!/bin/sh\ntouch '{marker}'\n")
            os.chmod(os.path.join(fake, tool), 0o700)
        env = dict(os.environ, PATH=fake)
        proc = subprocess.run(
            ["/bin/sh", self.emit], input=b'{"hook_event_name": "Stop"}', env=env, timeout=10
        )
        self.assertEqual(proc.returncode, 0)
        self.assertTrue(self.arrived.wait(2))
        self.assertFalse(os.path.exists(marker))

    def test_unread_input_is_drained(self):
        server = socket.socket(socket.AF_UNIX)
        server.bind(self.sock)
        server.listen(1)  # never reads: nc is stopped with most of the input unsent
        self.addCleanup(server.close)
        hook = subprocess.Popen(["/bin/sh", self.emit], stdin=subprocess.PIPE)
        try:
            hook.stdin.write(b"x" * 4_000_000)  # BrokenPipeError if the hook stops reading
            hook.stdin.close()
        finally:
            self.assertEqual(hook.wait(10), 0)

    def test_nan_is_not_json(self):
        self.start_receiver()
        self.run_hook(b'{"hook_event_name": "Stop", "duration_ms": NaN}')
        self.assertTrue(self.arrived.wait(2))
        self.assertEqual(self.got, [None])

    def test_slow_client_does_not_hold_the_receiver(self):
        self.start_receiver()
        stop = threading.Event()
        self.addCleanup(stop.set)

        def trickle():
            with socket.socket(socket.AF_UNIX) as slow:
                slow.connect(self.sock)
                while not stop.wait(0.5):
                    slow.send(b" ")

        threading.Thread(target=trickle, daemon=True).start()
        time.sleep(0.2)
        start = time.monotonic()
        self.run_hook(json.dumps({"hook_event_name": "Stop"}).encode())
        self.assertTrue(self.arrived.wait(READ_DEADLINE + 2))
        self.assertLess(time.monotonic() - start, READ_DEADLINE + 2)

    def test_whole_object_is_taken_while_the_client_keeps_the_line_open(self):
        # The nc on Linux does not close its side when its input ends.
        self.start_receiver()
        with socket.socket(socket.AF_UNIX) as client:
            client.connect(self.sock)
            start = time.monotonic()
            client.sendall(b'{"hook_event_name": "Stop", "x": "}"}\n')
            self.assertTrue(self.arrived.wait(2))
            self.assertLess(time.monotonic() - start, 0.5)
        self.assertEqual(self.got, [{"hook_event_name": "Stop", "x": "}"}])

    def test_a_big_payload_is_parsed_once(self):
        # Every chunk of it ends in "}", but it is parsed only once the data stops coming.
        parsed = []

        def parse(raw):
            parsed.append(len(raw))
            return real_parse(raw)

        real_parse = receiver._parse
        payload = {"hook_event_name": "PostToolUse", "content": "}" * 4_000_000}
        with mock.patch.object(receiver, "_parse", parse):
            self.start_receiver()
            with socket.socket(socket.AF_UNIX) as client:
                client.connect(self.sock)
                client.sendall(json.dumps(payload).encode())
                self.assertTrue(self.arrived.wait(5))
        self.assertEqual(self.got, [payload])
        self.assertLess(len(parsed), 10)

    @unittest.skipUnless(os.path.exists("/bin/dash"), "no dash")
    def test_hook_under_dash(self):
        # dash, the sh of Debian and Ubuntu, gives a background job /dev/null as its input.
        self.start_receiver()
        payload = {"hook_event_name": "Stop", "session_id": "s"}
        proc = subprocess.run(
            ["/bin/dash", self.emit], input=json.dumps(payload).encode(), capture_output=True
        )
        self.assertEqual((proc.returncode, proc.stdout, proc.stderr), (0, b"", b""))
        self.assertTrue(self.arrived.wait(2))
        self.assertEqual(self.got, [payload])

    def test_hook_without_stdin_still_exits_0(self):
        # A failed redirection on `exec` ends a POSIX sh with a non-zero code, and 2 tells
        # Claude Code to block the tool.
        self.start_receiver()
        for shell in ("/bin/sh", "/bin/dash"):
            if not os.path.exists(shell):
                continue
            with self.subTest(shell=shell):
                proc = subprocess.run(
                    [shell, "-c", f'{shell} "$0" <&-', self.emit], capture_output=True
                )
                self.assertEqual((proc.returncode, proc.stdout, proc.stderr), (0, b"", b""))

    def test_second_instance_refuses(self):
        self.start_receiver()
        with self.assertRaises(AlreadyRunningError):
            Receiver(self.sock, self.on_payload).start()

    def test_selfcheck_pipeline(self):
        probe = selfcheck.PipelineProbe()
        receiver = Receiver(self.sock, lambda payload, ts: probe.offer(payload))
        receiver.start()
        self.addCleanup(receiver.stop)
        result = selfcheck.check_pipeline(self.emit, probe)
        self.assertTrue(result.ok, result.detail)

    def test_selfcheck_pipeline_without_receiver(self):
        result = selfcheck.check_pipeline(self.emit, selfcheck.PipelineProbe(), timeout=0.2)
        self.assertFalse(result.ok)


if __name__ == "__main__":
    unittest.main()
