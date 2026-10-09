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

from sidequest import paths, selfcheck
from sidequest.receiver import AlreadyRunning, Receiver

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
        proc = subprocess.run(["/bin/sh", self.emit], input=data, capture_output=True,
                              timeout=10)
        return proc, time.monotonic() - start

    def test_payload_arrives_intact(self):
        self.start_receiver()
        payload = {"hook_event_name": "PostToolUse", "session_id": "s",
                   "tool_input": {"content": "ünïcode \"quotes\" $(rm -rf /) `x`\n" * 3}}
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

    def test_second_instance_refuses(self):
        self.start_receiver()
        with self.assertRaises(AlreadyRunning):
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
