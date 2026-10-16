"""Core of the running app: receiver -> normalizer -> storage -> listeners (the window).

Also owns the pause state (PLAN.md 3.4): sessions waiting for an answer and sessions
that went silent, plus the "continue" / "end match" buttons.
"""

import threading
import time
from collections.abc import Callable
from typing import Any

from . import paths, selfcheck
from .db import Store
from .normalizer import Event, Normalizer
from .receiver import Receiver

SILENCE_TICK = 1.0


# Kinds that show a session is busy with a task.
WORK_KINDS = frozenset(
    {"prompt", "tool", "tool_error", "blocked", "waiting", "subagent_start", "compact"}
)


class Core:
    def __init__(
        self,
        db_path: str = paths.DB_PATH,
        socket_path: str = paths.SOCKET_PATH,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.store = Store(db_path)
        self.normalizer = Normalizer()
        self.socket_path = socket_path
        self.receiver = Receiver(socket_path, self.on_payload)
        self.probe = selfcheck.PipelineProbe()
        self.clock = clock
        self.control: selfcheck.ControlSession | None = None  # while a new version is checked
        self.control_report: list[str] | None = None
        self.replaying = False  # real events are stored but not shown meanwhile
        self._listeners: list[Callable[[Event], None]] = []
        self._lock = threading.RLock()
        self._last_activity: dict[str, float] = {}  # session -> ts of the last raw payload
        # Sessions between a prompt (or any work) and their final stop.
        self._working: set[str] = set()
        self._paused: dict[str, str] = {}  # session -> "waiting" | "silent"
        self._replay_sessions: set[str] = set()  # sessions paused by replayed / dev events
        self._stop = threading.Event()
        self._ticker: threading.Thread | None = None

    # --- lifecycle --------------------------------------------------------------

    def start(self) -> None:
        paths.ensure_data_dir()
        self.receiver.start()
        self._ticker = threading.Thread(
            target=self._tick_loop, name="sidequest-silence", daemon=True
        )
        self._ticker.start()

    def stop(self) -> None:
        self._stop.set()
        self.receiver.stop()
        if self._ticker:
            self._ticker.join(timeout=2)
        self.store.close()

    def subscribe(self, listener: Callable[[Event], None]) -> None:
        """listener(event) is called for every game event that reaches the game."""
        self._listeners.append(listener)

    def start_control_session(self, version: str) -> None:
        self.control = selfcheck.ControlSession(version)

    # --- events -----------------------------------------------------------------

    def on_payload(self, payload: object, ts: float) -> None:
        if self.probe.offer(payload):
            return
        with self._lock:
            if self.control is not None:
                report = self.control.observe(payload)
                if report is not None:
                    self.control_report = report
                    if not report:
                        self.store.set_meta("verified_version", self.control.version)
                    self.control = None
            # Notifications are Claude Code calling the user, not the agent doing work.
            if (
                isinstance(payload, dict)
                and isinstance(payload.get("session_id"), str)
                and payload.get("hook_event_name") != "Notification"
            ):
                session = payload["session_id"]
                self._last_activity[session] = ts
                if self._paused.get(session) == "silent":
                    self.publish(self._core_event(session, "resumed", source="activity"))
            for event in self.normalizer.process(payload, ts):
                self.publish(event)

    def publish(self, event: Event) -> None:
        """Store a game event, update pause state and hand it to the listeners."""
        with self._lock:
            self._track(event)
            if not event.get("replay"):
                self.store.add_event(event)
            if self.replaying and not event.get("replay"):
                return
            listeners = list(self._listeners)
        for listener in listeners:
            listener(event)

    def _track(self, event: Event) -> None:
        # Normalized events always name a session except "unknown" ones, which are not kept.
        session: Any
        session, kind = event.get("session"), event["kind"]
        if event.get("replay"):
            # Replayed pauses show the banner too, so pause handling can be tested
            # without an agent; they never touch silence detection of real sessions.
            if kind in ("waiting", "silent"):
                self._paused[session] = kind
                self._replay_sessions.add(session)
            elif kind == "resumed":
                self._paused.pop(session, None)
            return
        # A session we joined midway shows no prompt: any work means it is working too.
        if kind in WORK_KINDS:
            self._working.add(session)
        elif kind == "stop":
            if event.get("final"):
                self._working.discard(session)
        elif kind == "session_end":
            self._working.discard(session)
            self._paused.pop(session, None)
            self._last_activity.pop(session, None)
        if kind == "waiting":
            self._paused[session] = "waiting"
        elif kind == "silent":
            self._paused[session] = "silent"
        elif kind == "resumed":
            self._paused.pop(session, None)

    # --- silence ----------------------------------------------------------------

    def _tick_loop(self) -> None:
        while not self._stop.wait(SILENCE_TICK):
            self.check_silence()

    def check_silence(self) -> None:
        threshold = self.store.get_setting("silence_pause_seconds")
        now = self.clock()
        with self._lock:
            silent = [
                s
                for s in self._working
                if s not in self._paused and now - self._last_activity.get(s, now) > threshold
            ]
        for session in silent:
            self.publish(self._core_event(session, "silent", seconds=threshold))

    # --- pause buttons ----------------------------------------------------------

    def paused_sessions(self) -> dict[str, str]:
        with self._lock:
            return dict(self._paused)

    def session_status(self, session: str) -> str:
        """ "waiting" / "silent" / "working" / "idle" for the hub's session list."""
        with self._lock:
            if session in self._paused:
                return self._paused[session]
            return "working" if session in self._working else "idle"

    def resume(self, session: str | None = None) -> None:
        """«Продолжить»: lift the pause for one session or for all of them."""
        with self._lock:
            sessions = [session] if session else list(self._paused)
        for s in sessions:
            if s in self._paused:
                event = self._core_event(s, "resumed", source="button")
                if s in self._replay_sessions:
                    event["replay"] = True  # never stored, like the pause itself
                self.publish(event)

    def clear_replay_pauses(self) -> None:
        """Drop pauses left by a replay that was stopped or has finished."""
        with self._lock:
            for s in self._replay_sessions:
                self._paused.pop(s, None)
            self._replay_sessions.clear()

    def end_match(self, session: str) -> None:
        """«Завершить матч» for a silent session: treat it as a finished task."""
        with self._lock:
            self._working.discard(session)
            replayed = session in self._replay_sessions
        for event in (
            self._core_event(session, "resumed", source="button"),
            self._core_event(session, "stop", ok=True, background=0, final=True, manual=True),
        ):
            if replayed:
                event["replay"] = True
            self.publish(event)

    def _core_event(self, session: str, kind: str, **fields: Any) -> Event:
        project = None
        state = self.normalizer.sessions.get(session)
        if state is not None:
            project = state.project
        event = {"ts": self.clock(), "session": session, "project": project, "kind": kind}
        event.update(fields)
        return event
