"""Unix socket receiver: one connection per hook call, payload = the whole stream."""
import json
import os
import socket
import threading
import time

MAX_PAYLOAD = 64 * 1024 * 1024   # Write / Read payloads carry whole files
READ_TIMEOUT = 1.0               # matches `nc -w 1` in sidequest-emit.sh


class AlreadyRunning(Exception):
    pass


class Receiver:
    """Accepts connections on `path` and calls `on_payload(payload, ts)` in order.

    Connections are handled one at a time on a single thread, so events are delivered
    in the order Claude Code sent them.
    """

    def __init__(self, path, on_payload):
        self.path = path
        self.on_payload = on_payload
        self._sock = None
        self._thread = None
        self._stop = threading.Event()

    def start(self):
        _remove_stale_socket(self.path)
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        old_umask = os.umask(0o177)  # the socket is created as 600, no window of 7xx
        try:
            sock.bind(self.path)
        finally:
            os.umask(old_umask)
        os.chmod(self.path, 0o600)
        sock.listen(64)
        sock.settimeout(0.2)
        self._sock = sock
        self._thread = threading.Thread(target=self._loop, name="sidequest-receiver",
                                        daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)
        if self._sock:
            self._sock.close()
        try:
            os.unlink(self.path)
        except FileNotFoundError:
            pass

    def _loop(self):
        while not self._stop.is_set():
            try:
                conn, _ = self._sock.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            ts = time.time()
            with conn:
                raw = _read_all(conn)
            if not raw:  # oversized, timed out, or an empty probe connection
                continue
            try:
                payload = json.loads(raw)
            except ValueError:
                payload = None
            try:
                self.on_payload(payload, ts)
            except Exception:  # a bad event must never stop the receiver
                import traceback
                traceback.print_exc()


def _read_all(conn):
    conn.settimeout(READ_TIMEOUT)
    chunks, size = [], 0
    try:
        while True:
            chunk = conn.recv(65536)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_PAYLOAD:
                return None
            chunks.append(chunk)
    except OSError:
        return None
    return b"".join(chunks)


def _remove_stale_socket(path):
    """Delete a socket left by a crash; refuse to start if another instance listens."""
    if not os.path.exists(path):
        return
    probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        probe.connect(path)
    except OSError:
        os.unlink(path)
        return
    finally:
        probe.close()
    raise AlreadyRunning(path)
