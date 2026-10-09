"""The window: pywebview on the system WebKit, the hub page and the JS bridge.

Data only ever crosses into the page as return values of bridge calls. Python never
builds JavaScript from event data: it only runs one constant wake-up call, and the page
then pulls the events through `Bridge.drain()`.
"""
import json
import os
import re
import threading
import time

from . import claude_settings, paths, replay, selfcheck
from .core import Core
from .db import DEFAULT_SETTINGS

WAKE_JS = "window.__sidequestWake && window.__sidequestWake()"
MAX_QUEUE = 5000
_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def _file_url(path):
    # A file:// URL (not a bare path) keeps pywebview from starting its HTTP server.
    return "file://" + os.path.abspath(path)


class Bridge:
    """Methods callable from the hub page as window.pywebview.api.<name>(...)."""

    def __init__(self, core, dev, settings_path):
        self._core = core
        self._dev = dev
        self._settings_path = settings_path
        self._queue = []
        self._queue_lock = threading.Lock()
        self._window = None
        self._wake_pending = threading.Event()
        self._checks = []
        self._first_event_seen = False
        self._player = None
        self._tainted = False      # dev panel or replay used during the current match
        core.subscribe(self._on_event)

    # --- events to the page -----------------------------------------------------

    def _on_event(self, event):
        if not event.get("replay"):
            self._first_event_seen = True
        with self._queue_lock:
            self._queue.append(event)
            del self._queue[:-MAX_QUEUE]
        self._wake_pending.set()

    def _pusher(self):
        while True:
            self._wake_pending.wait()
            self._wake_pending.clear()
            if self._window is not None:
                try:
                    self._window.evaluate_js(WAKE_JS)
                except Exception:
                    pass
            time.sleep(0.02)  # coalesce bursts into one wake-up

    def drain(self):
        with self._queue_lock:
            events, self._queue = self._queue, []
        return events

    def report_error(self, message):
        """JS errors of the hub end up in the terminal log."""
        import sys
        print(f"[hub error] {str(message)[:2000]}", file=sys.stderr, flush=True)

    # --- status and self-check --------------------------------------------------

    def status(self):
        core = self._core
        paused = [{"session": s, "reason": reason,
                   "project": self._project(s)} for s, reason in core.paused_sessions().items()]
        return {
            "dev": self._dev,
            "connected": self._connected(),
            "indicator": self._indicator(),
            "checks": [r.as_dict() for r in self._checks],
            "waiting_first_event": not self._first_event_seen,
            "control": {"active": core.control is not None,
                        "version": core.control.version if core.control else None,
                        "report": core.control_report},
            "unknown_events": dict(core.normalizer.unknown_events),
            "unknown_tools": dict(core.normalizer.unknown_tools),
            "paused": paused,
            "sessions": self._live_sessions(),
            "replaying": core.replaying,
            "tainted": self._tainted,
        }

    def _connected(self):
        try:
            settings, _ = claude_settings.read_settings(self._settings_path)
        except claude_settings.SettingsError:
            return False
        return bool(claude_settings.find_entries(settings))

    def _project(self, session):
        state = self._core.normalizer.sessions.get(session)
        return state.project if state else None

    def _live_sessions(self):
        core = self._core
        return [{"session": sid, "project": state.project,
                 "status": core.session_status(sid)}
                for sid, state in list(core.normalizer.sessions.items())]

    def _indicator(self):
        if not self._checks:
            return "yellow"
        if any(not r.ok for r in self._checks):
            return "red"
        core = self._core
        if any(r.warn for r in self._checks) or core.control is not None \
                or core.control_report or core.normalizer.unknown_events \
                or core.normalizer.unknown_tools:
            return "yellow"
        return "green"

    def run_check(self):
        store = self._core.store
        results = [selfcheck.check_hooks(self._settings_path, paths.EMIT_SCRIPT,
                                          store.get_meta("emit_hash"))]
        version_result, version = selfcheck.check_version(store.verified_version())
        results.append(version_result)
        if version and version != store.verified_version() and self._core.control is None:
            self._core.start_control_session(version)
        results.append(selfcheck.check_pipeline(paths.EMIT_SCRIPT, self._core.probe))
        self._checks = results
        return [r.as_dict() for r in results]

    # --- pause buttons ----------------------------------------------------------

    def resume(self, session=None):
        self._core.resume(session)

    def end_match(self, session):
        self._core.end_match(session)

    # --- connect to Claude Code ---------------------------------------------------

    def install_preview(self):
        return self._preview(lambda s: claude_settings.plan_install(s, paths.EMIT_SCRIPT))

    def install_apply(self):
        os.chmod(paths.EMIT_SCRIPT, 0o755)
        result = self._apply(lambda s: claude_settings.plan_install(s, paths.EMIT_SCRIPT))
        if result["ok"]:
            self._core.store.set_meta("emit_hash", selfcheck.file_hash(paths.EMIT_SCRIPT))
        return result

    def uninstall_preview(self):
        return self._preview(claude_settings.plan_uninstall)

    def uninstall_apply(self, delete_core=False, delete_dlc=()):
        result = self._apply(claude_settings.plan_uninstall)
        if not result["ok"]:
            return result
        if delete_core:
            self._core.store.delete_all()
        for dlc_id in delete_dlc or ():
            if _ID_RE.match(dlc_id or ""):
                target = os.path.join(paths.DLC_DATA_DIR, dlc_id)
                if os.path.isdir(target):
                    import shutil
                    shutil.rmtree(target)
        return result

    def _preview(self, planner):
        try:
            settings, _ = claude_settings.read_settings(self._settings_path)
            _, changes = planner(settings)
        except claude_settings.SettingsError as e:
            return {"ok": False, "error": str(e)}
        return {"ok": True, "path": self._settings_path, "script": paths.EMIT_SCRIPT,
                "changes": [{"event": e, "what": w} for e, w in changes]}

    def _apply(self, planner):
        try:
            changes, backup = claude_settings.apply(self._settings_path, planner,
                                                    lambda _changes: True)
        except claude_settings.SettingsError as e:
            return {"ok": False, "error": str(e)}
        self.run_check()
        return {"ok": True, "changed": len(changes), "backup": backup}

    # --- profile, stats, journal, settings ----------------------------------------

    def profile(self):
        store = self._core.store
        return {"name": store.get_meta("profile.name", "Игрок"),
                "stats": store.stats()}

    def set_profile_name(self, name):
        name = str(name).strip()[:32] or "Игрок"
        self._core.store.set_meta("profile.name", name)
        return name

    def journal(self, limit=100):
        return self._core.store.recent_events(min(int(limit), 500))

    def get_settings(self):
        store = self._core.store
        return {name: store.get_setting(name) for name in DEFAULT_SETTINGS}

    def set_setting(self, name, value):
        if name == "silence_pause_seconds":
            value = max(10, min(3600, int(value)))
        elif name == "fps_limit":
            value = 30 if int(value) <= 30 else 60
        self._core.store.set_setting(name, value)
        return value

    # --- DLC --------------------------------------------------------------------

    def list_dlc(self):
        roots = [os.path.join(paths.PROJECT_DIR, "dlc")]
        if self._dev:
            roots.append(os.path.join(paths.PROJECT_DIR, "dev", "dlc"))
        found = []
        for root in roots:
            if not os.path.isdir(root):
                continue
            for name in sorted(os.listdir(root)):
                manifest = os.path.join(root, name, "manifest.json")
                if not _ID_RE.match(name) or not os.path.isfile(manifest):
                    continue
                try:
                    with open(manifest, encoding="utf-8") as f:
                        data = json.load(f)
                except (OSError, ValueError):
                    continue
                entry = os.path.join(root, name, data.get("entry", "index.html"))
                found.append({"id": name, "name": str(data.get("name", name)),
                              "dev_only": root != roots[0],
                              "url": _file_url(entry)})
        return found

    def dlc_load(self, dlc_id, key):
        path = self._dlc_file(dlc_id, key)
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except FileNotFoundError:
            return None

    def dlc_save(self, dlc_id, key, value):
        path = self._dlc_file(dlc_id, key)
        os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(value, f, ensure_ascii=False)
        os.replace(tmp, path)
        return True

    def match_start(self, dlc_id):
        self._tainted = self._core.replaying
        return {"counted": not self._tainted}

    def match_end(self, dlc_id, result):
        """Record a finished match unless the dev panel or a replay touched it."""
        counted = not self._tainted and not self._core.replaying
        if counted:
            stats = self.dlc_load(dlc_id, "stats") or {"matches": 0, "results": []}
            stats["matches"] += 1
            stats["results"] = (stats["results"] + [result])[-100:]
            self.dlc_save(dlc_id, "stats", stats)
        self._tainted = False
        return {"counted": counted}

    def _dlc_file(self, dlc_id, key):
        if not _ID_RE.match(str(dlc_id)) or not _ID_RE.match(str(key)):
            raise ValueError("bad dlc id or key")
        return os.path.join(paths.DLC_DATA_DIR, dlc_id, key + ".json")

    # --- dev panel (only with --dev) ----------------------------------------------

    def _require_dev(self):
        if not self._dev:
            raise PermissionError("dev panel is only available with --dev")

    def dev_taint(self):
        """A DLC dev command was used: the current match is not counted."""
        self._require_dev()
        self._tainted = True

    def dev_sources(self):
        self._require_dev()
        out = []
        for folder in ("recordings", "scenarios"):
            root = os.path.join(paths.PROJECT_DIR, "dev", folder)
            if os.path.isdir(root):
                out += [{"folder": folder, "name": n} for n in sorted(os.listdir(root))
                        if n.endswith(".jsonl")]
        return out

    def dev_replay_start(self, folder, name, speed=1):
        self._require_dev()
        if folder not in ("recordings", "scenarios") or "/" in name or name.startswith("."):
            raise ValueError("bad source")
        self.dev_replay_stop()
        events = replay.load(os.path.join(paths.PROJECT_DIR, "dev", folder, name))
        self._tainted = True
        self._core.replaying = True
        self._player = replay.Player(events, self._core.publish, int(speed),
                                     on_finish=self._replay_finished)
        self._player.start()
        return {"duration": self._player.duration, "events": len(events)}

    def _replay_finished(self):
        self._core.replaying = False
        self._core.clear_replay_pauses()

    def dev_replay_control(self, action, value=None):
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

    def dev_replay_stop(self):
        self._require_dev()
        if self._player is not None:
            self._player.stop()
            self._player = None
        self._core.replaying = False
        self._core.clear_replay_pauses()

    def dev_send(self, kind, fields=None):
        """Send one hand-made event into the game (marks the match as not counted)."""
        self._require_dev()
        allowed = {"tool", "tool_error", "blocked", "waiting", "resumed", "silent",
                   "compact", "subagent_start", "subagent_stop", "todo", "stop", "prompt"}
        if kind not in allowed:
            raise ValueError(kind)
        self._tainted = True
        event = {"ts": time.time(), "session": "dev", "project": "dev", "kind": kind,
                 "replay": True}
        for key, value in (fields or {}).items():
            if isinstance(value, (str, int, float, bool)) or value is None:
                event[str(key)[:32]] = value
        self._core.publish(event)

    def dev_export(self, session, name=None):
        self._require_dev()
        return replay.export_session(self._core.store, session, paths.RECORDINGS_DIR, name)

    def dev_sessions(self):
        self._require_dev()
        return self._core.store.sessions(30)


def run(dev=False, settings_path=paths.CLAUDE_SETTINGS):
    import webview  # only the window needs pywebview

    os.umask(0o077)
    paths.ensure_data_dir()
    core = Core()
    core.start()
    bridge = Bridge(core, dev, settings_path)
    window = webview.create_window(
        "Sidequest", _file_url(os.path.join(paths.PROJECT_DIR, "hub", "index.html")),
        js_api=bridge, width=1100, height=720, min_size=(800, 560),
        background_color="#1b1b2f")
    bridge._window = window
    threading.Thread(target=bridge._pusher, name="sidequest-pusher", daemon=True).start()
    window.events.loaded += lambda: threading.Thread(target=bridge.run_check,
                                                     daemon=True).start()

    cleanup_lock = threading.Lock()
    cleaned = []

    def cleanup():
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
        webview.start(http_server=False, private_mode=True, debug=dev)
    finally:
        cleanup()
        # pywebview's bridge call threads are not daemons and can hang on a closed
        # window; everything is cleaned up, so leave without waiting for them.
        import sys
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(0)
