"""Unix socket receiver: one connection per hook call, payload = the whole stream."""

import contextlib
import json
import os
import socket
import threading
import time
from collections.abc import Callable

MAX_PAYLOAD = 64 * 1024 * 1024  # Write / Read payloads carry whole files
READ_TIMEOUT = 1.0  # matches `nc -w 1` in sidequest-emit.sh
# A whole connection gets this long, so a client that trickles a byte a second cannot
# hold the single receiver thread and stall the events behind it.
READ_DEADLINE = 3.0
MAX_SOCKET_PATH = 103  # sun_path on macOS is 104 bytes with the closing zero


class SocketPathTooLongError(Exception):
    pass


class AlreadyRunningError(Exception):
    pass


class Receiver:
    """Accepts connections on `path` and calls `on_payload(payload, ts)` in order.

    Connections are handled one at a time on a single thread, so events are delivered
    in the order Claude Code sent them.
    """

    def __init__(self, path: str, on_payload: Callable[[object, float], object]) -> None:
        self.path = path
        self.on_payload = on_payload
        self._sock: socket.socket | None = None
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()

    def start(self) -> None:
        if len(os.fsencode(self.path)) > MAX_SOCKET_PATH:
            raise SocketPathTooLongError(self.path)
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
        self._thread = threading.Thread(target=self._loop, name="sidequest-receiver", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)
        if self._sock:
            self._sock.close()
        with contextlib.suppress(FileNotFoundError):
            os.unlink(self.path)

    def _loop(self) -> None:
        assert self._sock is not None  # start() sets it before the thread runs
        while not self._stop.is_set():
            try:
                conn, _ = self._sock.accept()
            except TimeoutError:
                continue
            except OSError:
                break
            try:
                self._handle(conn)
            except Exception:  # a bad event must never stop the receiver
                import traceback

                traceback.print_exc()

    def _handle(self, conn: socket.socket) -> None:
        ts = time.time()
        with conn:
            raw = _read_all(conn)
        if not raw:  # oversized, timed out, or an empty probe connection
            return
        payload: object
        try:
            payload = json.loads(raw, parse_constant=reject_constant)
        except (ValueError, RecursionError):  # not JSON, or nested too deep to parse
            payload = None
        self.on_payload(payload, ts)


def reject_constant(name: str) -> None:
    """`parse_constant` for json.loads: NaN and Infinity are not JSON and are refused."""
    raise ValueError(f"{name} is not allowed")


def _read_all(conn: socket.socket) -> bytes | None:
    deadline = time.monotonic() + READ_DEADLINE
    chunks: list[bytes] = []
    size = 0
    try:
        while True:
            left = deadline - time.monotonic()
            if left <= 0:
                return None
            conn.settimeout(min(READ_TIMEOUT, left))
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


def _remove_stale_socket(path: str) -> None:
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
    raise AlreadyRunningError(path)
