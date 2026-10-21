"""The window: pywebview on the system WebKit, the game page and the JS bridge.

Data only ever crosses into the page as return values of bridge calls. Python never
builds JavaScript from event data: it only runs one constant wake-up call, and the page
then pulls the events through `Bridge.drain()`.
"""

import contextlib
import json
import os
import sys
import tempfile
import threading
import time
import urllib.parse
from collections.abc import Callable
from typing import TYPE_CHECKING, Any, Literal, TypedDict

from . import avatar, claude_settings, i18n, paths, replay, selfcheck
from .core import Core
from .db import DEFAULT_SETTINGS, Row
from .i18n import t
from .normalizer import Event

if TYPE_CHECKING:
    import webview  # only for the window's type; imported for real in run()

WAKE_JS = "window.__sidequestWake && window.__sidequestWake()"
MAX_QUEUE = 5000
GHOST_MIN_ACTIONS = 10  # shorter sessions make no match
GHOST_MAX_EVENTS = 20000

# A JSON object a bridge call returns to the page. Arguments that come from the page are
# typed Any: they are whatever the page sent.
Reply = dict[str, Any]


class LiveSession(TypedDict):
    session: str
    project: str | None
    status: str


def _file_url(path: str) -> str:
    # A file:// URL (not a bare path) keeps pywebview from starting its HTTP server.
    return "file://" + os.path.abspath(path)


class Bridge:
    """Methods callable from the game page as window.pywebview.api.<name>(...).

    The page never gets the Bridge itself: see `exposed()` and `create_window()`."""

    def __init__(self, core: Core, dev: bool, settings_path: str) -> None:
        self._core = core
        self._dev = dev
        self._settings_path = settings_path
        self._queue: list[Event] = []
        self._queue_lock = threading.Lock()
        self._window: webview.Window | None = None
        self._wake_pending = threading.Event()
        self._checks: list[selfcheck.Result] = []
        self._first_event_seen = False
        self._player: replay.Player | None = None
        self._tainted = False  # dev panel or replay used during the current match
        core.subscribe(self._on_event)

    # --- events to the page -----------------------------------------------------

    def _on_event(self, event: Event) -> None:
        if not event.get("replay"):
            self._first_event_seen = True
        with self._queue_lock:
            self._queue.append(event)
            del self._queue[:-MAX_QUEUE]
        self._wake_pending.set()

    def _pusher(self) -> None:
        while True:
            self._wake_pending.wait()
            self._wake_pending.clear()
            if self._window is not None:
                with contextlib.suppress(Exception):
                    self._window.evaluate_js(WAKE_JS)
            time.sleep(0.02)  # coalesce bursts into one wake-up

    def drain(self) -> list[Event]:
        with self._queue_lock:
            events, self._queue = self._queue, []
        return events

    def report_error(self, message: Any) -> None:
        """JS errors of the page end up in the terminal log."""
        print(f"[page error] {str(message)[:2000]}", file=sys.stderr, flush=True)

    # --- status and self-check --------------------------------------------------

    def status(self) -> Reply:
        core = self._core
        paused = [
            {"session": s, "reason": reason, "project": self._project(s)}
            for s, reason in core.paused_sessions().items()
        ]
        return {
            "dev": self._dev,
            "connected": self._connected(),
            "indicator": self._indicator(),
            "checks": [r.as_dict() for r in self._checks],
            "waiting_first_event": not self._first_event_seen,
            "control": {
                "active": core.control is not None,
                "version": core.control.version if core.control else None,
                "report": core.control_report,
            },
            "unknown_events": dict(core.normalizer.unknown_events),
            "unknown_tools": dict(core.normalizer.unknown_tools),
            "paused": paused,
            "sessions": self._live_sessions(),
            "replaying": core.replaying,
            "tainted": self._tainted,
        }

    def _connected(self) -> bool:
        try:
            settings, _ = claude_settings.read_settings(self._settings_path)
        except claude_settings.SettingsError:
            return False
        return bool(claude_settings.find_entries(settings))

    def _project(self, session: str) -> str | None:
        state = self._core.normalizer.sessions.get(session)
        return state.project if state else None

    def _live_sessions(self) -> list[LiveSession]:
        core = self._core
        return [
            {"session": sid, "project": state.project, "status": core.session_status(sid)}
            for sid, state in list(core.normalizer.sessions.items())
        ]

    def _indicator(self) -> str:
        if not self._checks:
            return "yellow"
        if any(not r.ok for r in self._checks):
            return "red"
        core = self._core
        if (
            any(r.warn for r in self._checks)
            or core.control is not None
            or core.control_report
            or core.normalizer.unknown_events
            or core.normalizer.unknown_tools
        ):
            return "yellow"
        return "green"

    def run_check(self) -> list[selfcheck.CheckResult]:
        store = self._core.store
        # The script's hash is kept for the real install only; a copy is not held to it.
        real = paths.is_claude_settings(self._settings_path)
        expected = store.get_meta("emit_hash") if real else None
        results = [selfcheck.check_hooks(self._settings_path, paths.EMIT_SCRIPT, expected)]
        version_result, version = selfcheck.check_version(store.verified_version())
        results.append(version_result)
        if version and version != store.verified_version() and self._core.control is None:
            self._core.start_control_session(version)
        results.append(selfcheck.check_pipeline(paths.EMIT_SCRIPT, self._core.probe))
        self._checks = results
        return [r.as_dict() for r in results]

    # --- pause buttons ----------------------------------------------------------

    def resume(self, session: Any = None) -> None:
        self._core.resume(session)

    def end_match(self, session: Any) -> None:
        self._core.end_match(session)

    def quit(self) -> None:
        # Closing the window ends everything: "closing" cleans up as for the close button.
        if self._window is not None:
            self._window.destroy()

    # --- connect to Claude Code ---------------------------------------------------

    def install_preview(self) -> Reply:
        return self._preview(lambda s: claude_settings.plan_install(s, paths.EMIT_SCRIPT))

    def install_apply(self) -> Reply:
        os.chmod(paths.EMIT_SCRIPT, 0o755)
        result = self._apply(lambda s: claude_settings.plan_install(s, paths.EMIT_SCRIPT))
        if result["ok"] and paths.is_claude_settings(self._settings_path):
            self._core.store.set_meta("emit_hash", selfcheck.file_hash(paths.EMIT_SCRIPT))
        return result

    def uninstall_preview(self) -> Reply:
        return self._preview(claude_settings.plan_uninstall)

    def uninstall_apply(self, delete_core: Any = False, delete_game: Any = False) -> Reply:
        result = self._apply(claude_settings.plan_uninstall)
        if not result["ok"]:
            return result
        if delete_core is True:
            self._core.store.delete_all()
        if delete_game is True:
            paths.delete_game_data(paths.GAME_DATA_DIR)
        return result

    def _preview(self, planner: claude_settings.Planner) -> Reply:
        try:
            settings, _ = claude_settings.read_settings(self._settings_path)
            _, changes = planner(settings)
        except claude_settings.SettingsError as e:
            return {"ok": False, "error": str(e)}
        return {
            "ok": True,
            "path": self._settings_path,
            "script": paths.EMIT_SCRIPT,
            "changes": [{"event": e, "what": w} for e, w in changes],
        }

    def _apply(self, planner: claude_settings.Planner) -> Reply:
        try:
            changes, backup = claude_settings.apply(
                self._settings_path, planner, lambda _changes: True
            )
        except claude_settings.SettingsError as e:
            return {"ok": False, "error": str(e)}
        self.run_check()
        return {"ok": True, "changed": len(changes), "backup": backup}

    # --- profile, stats, journal, settings ----------------------------------------

    def profile(self) -> Reply:
        store = self._core.store
        # avatar None means the default one (SidequestAvatar.DEFAULT in game/avatar.js).
        return {
            "name": store.get_meta("profile.name", t("Игрок", "Player")),
            "avatar": store.get_meta("profile.avatar"),
            "stats": store.stats(),
        }

    def set_profile_name(self, name: object) -> str:
        name = str(name).strip()[:32] or t("Игрок", "Player")
        self._core.store.set_meta("profile.name", name)
        return name

    def set_avatar(self, value: object) -> avatar.PixelAvatar | avatar.PictureAvatar | None:
        """Store a checked avatar (see sidequest/avatar.py); None resets to the default."""
        value = None if value is None else avatar.clean(value)
        self._core.store.set_meta("profile.avatar", value)
        return value

    def journal(self, limit: Any = 100) -> list[Row]:
        return self._core.store.recent_events(min(int(limit), 500))

    def get_settings(self) -> dict[str, Any]:
        store = self._core.store
        settings = {name: store.get_setting(name) for name in DEFAULT_SETTINGS}
        settings["lang"] = i18n.language()  # "auto" resolved: what the window shows
        return settings

    def set_setting(self, name: Any, value: Any) -> Any:
        if name == "silence_pause_seconds":
            value = max(10, min(3600, int(value)))
        elif name == "fps_limit":
            value = 30 if int(value) <= 30 else 60
        elif name == "language":
            value = value if value in (*i18n.LANGS, "auto") else "en"
            i18n.set_language(i18n.resolve(value))
        elif name == "screen_shake":
            value = min((0, 0.5, 1), key=lambda v: abs(v - float(value)))
        elif name == "outline":
            value = value is True
        elif name == "ui_scale":
            value = min((1, 1.25, 1.5), key=lambda v: abs(v - float(value)))
        else:
            raise ValueError(f"unknown setting: {name!r}")
        self._core.store.set_setting(name, value)
        return value

    # --- the game's own data -----------------------------------------------------

    def balance(self) -> Any:
        """game/balance.json: the numbers and texts that ship with the game."""
        with open(os.path.join(paths.GAME_DIR, "balance.json"), encoding="utf-8") as f:
            return json.load(f)

    def load(self, key: Any) -> Any:
        try:
            fd = os.open(self._save_file(key), os.O_RDONLY | os.O_NOFOLLOW)
        except FileNotFoundError:
            return None
        with open(fd, encoding="utf-8") as f:
            return claude_settings.strict_json(f.read())

    def save(self, key: Any, value: Any) -> bool:
        path = self._save_file(key)
        os.makedirs(paths.GAME_DATA_DIR, mode=0o700, exist_ok=True)
        # A fresh temporary file, never through a link planted in the folder; the rename
        # replaces a link in place of the save itself rather than following it.
        fd, tmp = tempfile.mkstemp(dir=paths.GAME_DATA_DIR, prefix=key + ".", suffix=".tmp")
        try:
            with open(fd, "w", encoding="utf-8") as f:
                json.dump(value, f, ensure_ascii=False, allow_nan=False)
            os.replace(tmp, path)
        except BaseException:
            os.unlink(tmp)
            raise
        return True

    def _save_file(self, key: Any) -> str:
        if not isinstance(key, str) or not paths.KEY_RE.match(key):
            raise ValueError("bad save key")
        # Saves stay inside the project: a link in place of the folder is refused.
        if os.path.islink(paths.GAME_DATA_DIR):
            raise ValueError("the saves folder is a link")
        return os.path.join(paths.GAME_DATA_DIR, key + ".json")

    def match_start(self) -> Reply:
        self._tainted = self._core.replaying
        return {"counted": not self._tainted}

    def match_end(self, result: Any) -> Reply:
        """Record a finished match unless the dev panel or a replay touched it."""
        counted = not self._tainted and not self._core.replaying
        if counted:
            stats = self.load("stats") or {"matches": 0, "results": []}
            stats["matches"] += 1
            stats["results"] = (stats["results"] + [result])[-100:]
            self.save("stats", stats)
        self._tainted = False
        return {"counted": counted}

    # --- past sessions: the game replays one by itself, on its own clock (a "ghost") --

    def past_sessions(self) -> list[Reply]:
        """Past sessions to replay: when, which project, how long and how busy."""
        rows = self._core.store.session_summaries(30, GHOST_MIN_ACTIONS)
        return [
            {
                "session": r["id"],
                "project": r["project"],
                "started_at": r["started_at"],
                "duration": round(max(0.0, r["last_ts"] - r["started_at"]), 1),
                "actions": r["actions"],
            }
            for r in rows
        ]

    def live_sessions(self) -> list[LiveSession]:
        """Sessions open right now with their status, so a new match can pick up an agent
        that is already at work instead of waiting for its next event."""
        return self._live_sessions()

    def session_events(self, session: Any) -> list[Event]:
        """One past session's events, already normalized, with "t" in seconds from its start."""
        events = self._core.store.session_events(str(session))[:GHOST_MAX_EVENTS]
        if not events:
            return []
        start = events[0]["ts"]
        out = []
        for event in events:
            e = {k: v for k, v in event.items() if k not in ("ts", "replay")}
            e["t"] = round(event["ts"] - start, 3)
            out.append(e)
        return out

    # --- dev panel (only with --dev) ----------------------------------------------

    def _require_dev(self) -> None:
        if not self._dev:
            raise PermissionError("dev panel is only available with --dev")

    def dev_taint(self) -> None:
        """A game command of the dev panel was used: the current match is not counted."""
        self._require_dev()
        self._tainted = True

    def dev_sources(self) -> list[dict[str, str]]:
        self._require_dev()
        out = []
        for folder in ("recordings", "scenarios"):
            root = os.path.join(paths.PROJECT_DIR, "dev", folder)
            if os.path.isdir(root):
                out += [
                    {"folder": folder, "name": n}
                    for n in sorted(os.listdir(root))
                    if n.endswith(".jsonl")
                ]
        return out

    def dev_replay_start(self, folder: Any, name: Any, speed: Any = 1) -> Reply:
        self._require_dev()
        if folder not in ("recordings", "scenarios") or "/" in name or name.startswith("."):
            raise ValueError("bad source")
        self.dev_replay_stop()
        events = replay.load(os.path.join(paths.PROJECT_DIR, "dev", folder, name))
        self._tainted = True
        self._core.replaying = True
        self._player = replay.Player(
            events, self._core.publish, int(speed), on_finish=self._replay_finished
        )
        self._player.start()
        return {"duration": self._player.duration, "events": len(events)}

    def _replay_finished(self) -> None:
        self._core.replaying = False
        self._core.clear_replay_pauses()

    def dev_replay_control(self, action: Any, value: Any = None) -> Reply | None:
        self._require_dev()
        player = self._player
        if player is None:
            return None
        if action == "pause":
            player.pause(bool(value))
        elif action == "step":
            player.step()
        elif action == "seek":
            player.seek(float(value))
        elif action == "speed":
            player.set_speed(int(value))
        return {"position": player.position, "duration": player.duration}

    def dev_replay_stop(self) -> None:
        self._require_dev()
        if self._player is not None:
            self._player.stop()
            self._player = None
        self._core.replaying = False
        self._core.clear_replay_pauses()

    def dev_send(self, kind: Any, fields: Any = None) -> None:
        """Send one hand-made event into the game (marks the match as not counted)."""
        self._require_dev()
        allowed = {
            "tool",
            "tool_error",
            "blocked",
            "waiting",
            "resumed",
            "silent",
            "compact",
            "subagent_start",
            "subagent_stop",
            "todo",
            "stop",
            "prompt",
        }
        if kind not in allowed:
            raise ValueError(kind)
        self._tainted = True
        event = {
            "ts": time.time(),
            "session": "dev",
            "project": "dev",
            "kind": kind,
            "replay": True,
        }
        for key, value in (fields or {}).items():
            if isinstance(value, (str, int, float, bool)) or value is None:
                event[str(key)[:32]] = value
            elif isinstance(value, list) and all(isinstance(v, str) for v in value):
                event[str(key)[:32]] = [v[:32] for v in value[:4]]  # git: ["commit"]
        self._core.publish(event)

    def dev_export(self, session: Any, name: Any = None) -> str:
        self._require_dev()
        return replay.export_session(self._core.store, session, paths.RECORDINGS_DIR, name)

    def dev_sessions(self) -> list[Row]:
        self._require_dev()
        return self._core.store.sessions(30)


def exposed(bridge: Bridge) -> list[Callable[..., Any]]:
    """The Bridge's public methods as plain functions for `window.expose`.

    Given as js_api, pywebview would resolve any dotted name the page sends by getattr,
    private ones too ("_core.store._db.execute"). An exposed function is found only by
    its exact name, and the Bridge behind it is out of reach."""

    def wrap(name: str) -> Callable[..., Any]:
        method = getattr(bridge, name)

        def call(*args: Any) -> Any:
            return method(*args)

        call.__name__ = name
        return call

    return [
        wrap(name)
        for name in dir(Bridge)
        if not name.startswith("_") and callable(getattr(Bridge, name))
    ]


# pywebview's backend for each system, and only these: the bridge guard below exists for them.
# Without it pywebview may pick another one (Qt on Linux) that the guard does not cover.
GUI: dict[str, Literal["cocoa", "gtk"]] = {"darwin": "cocoa", "linux": "gtk"}

_guarded = False


def is_game_page(uri: object) -> bool:
    """Whether a page address is the game page itself (file://, any percent-encoding)."""
    if not isinstance(uri, str):
        return False
    parts = urllib.parse.urlsplit(uri)
    return (
        parts.scheme == "file"
        and parts.netloc in ("", "localhost")
        and urllib.parse.unquote(parts.path) == paths.GAME_PAGE
    )


def _main_frame_only() -> None:
    """Drop bridge messages that do not come from the game page itself.

    WebKit gives every frame and every page the window navigates to
    window.webkit.messageHandlers.jsBridge, and pywebview's handler does not look at the
    sender, so ours does (pywebview is pinned in requirements.txt). A system with no guard
    here gets no window."""
    global _guarded
    if _guarded:
        return
    if sys.platform == "darwin":
        _guard_cocoa()
    elif sys.platform == "linux":
        _guard_gtk()
    else:
        raise RuntimeError(
            t("Sidequest работает на macOS и Linux", "Sidequest runs on macOS and Linux")
        )
    _guarded = True


def _guard_cocoa() -> None:
    """The main frame, and only while it shows the game."""
    from webview.platforms import cocoa

    handler = cocoa.BrowserView.JSBridge
    forward = handler.userContentController_didReceiveScriptMessage_

    # The method is replaced in place: pywebview creates BrowserView.JSBridge by that name.
    def from_game_only(self: Any, controller: Any, message: Any) -> None:
        frame = message.frameInfo()
        url = frame.request().URL()
        if frame.isMainFrame() and url.isFileURL() and url.path() == paths.GAME_PAGE:
            forward(self, controller, message)

    handler.userContentController_didReceiveScriptMessage_ = from_game_only  # type: ignore[method-assign]


def _guard_gtk() -> None:
    """Only while the window shows the game. WebKitGTK does not say which frame sent a
    message, but the game page has no frames: its CSP (default-src 'none') loads none."""
    from webview.platforms import gtk

    forward = gtk.BrowserView.on_js_bridge_call

    # Replaced on the class before the window exists: BrowserView connects the signal to
    # self.on_js_bridge_call when it is made.
    def from_game_only(self: Any, manager: Any, message: Any) -> None:
        if is_game_page(self.webview.get_uri()):
            forward(self, manager, message)

    gtk.BrowserView.on_js_bridge_call = from_game_only  # type: ignore[method-assign]


def create_window(bridge: Bridge, title: str, **options: Any) -> "webview.Window":
    """The game window with the bridge exposed function by function, never as an object."""
    import webview

    _main_frame_only()
    # No page in the window may read local files with fetch or XHR: a page dropped onto the
    # window would get no CSP of ours. Our own scripts load by <script>, which this keeps.
    webview.settings["ALLOW_FILE_URLS"] = False
    window = webview.create_window(title, _file_url(paths.GAME_PAGE), **options)
    # None only when a window is created while the GUI runs and its "initialized"
    # handler cancels it; this one is made before webview.start().
    assert window is not None
    window.expose(*exposed(bridge))
    bridge._window = window
    return window


def run(dev: bool = False, settings_path: str = paths.CLAUDE_SETTINGS) -> None:
    import webview  # only the window needs pywebview

    os.umask(0o077)
    paths.ensure_data_dir()
    paths.migrate_game_data()
    core = Core()
    core.start()
    i18n.set_language(i18n.resolve(core.store.get_setting("language")))
    bridge = Bridge(core, dev, settings_path)
    window = create_window(
        bridge,
        "Sidequest",
        width=1100,
        height=720,
        min_size=(800, 560),
        background_color="#1b1b2f",
    )
    threading.Thread(target=bridge._pusher, name="sidequest-pusher", daemon=True).start()
    window.events.loaded += lambda: threading.Thread(target=bridge.run_check, daemon=True).start()

    cleanup_lock = threading.Lock()
    cleaned: list[bool] = []

    def cleanup() -> None:
        # Runs once; a second caller waits until the first one has finished.
        with cleanup_lock:
            if cleaned:
                return
            if bridge._player:
                bridge._player.stop()
            core.stop()  # closes the database and removes the socket
            cleaned.append(True)

    # Ctrl+C is handled by PyObjC, which terminates the app through Cocoa without
    # returning from webview.start(). "closing" runs synchronously on every path
    # (close button, Cmd+Q, Ctrl+C, kill), unlike "closed" which runs in a thread.
    window.events.closing += cleanup
    import signal

    signal.signal(signal.SIGTERM, lambda *_: window.destroy())
    try:
        # http_server=False plus a file:// URL: no port is ever opened.
        webview.start(gui=GUI[sys.platform], http_server=False, private_mode=True, debug=dev)
    finally:
        cleanup()
        # pywebview's bridge call threads are not daemons and can hang on a closed
        # window; everything is cleaned up, so leave without waiting for them.
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(0)
