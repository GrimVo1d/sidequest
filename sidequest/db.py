"""sqlite storage for game events, sessions and core settings.

Only normalized game events are stored. Every query is parameterized.
"""

import json
import os
import sqlite3
import threading
from typing import Any, TypedDict

# A JSON object read from or written to the database: a game event or a table row.
Row = dict[str, Any]


class Stats(TypedDict):
    sessions: int
    agent_seconds: int
    actions: int
    errors: int
    blocked: int
    lines_added: int


SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    project     TEXT,
    started_at  REAL NOT NULL,
    ended_at    REAL,
    joined      INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS events (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    session  TEXT,
    ts       REAL NOT NULL,
    kind     TEXT NOT NULL,
    data     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_session ON events (session, ts);
CREATE TABLE IF NOT EXISTS meta (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
"""

# Core settings editable in the game; values are JSON. Code reads them via get_setting.
DEFAULT_SETTINGS: dict[str, Any] = {
    # Seconds without events before the "agent is silent" pause (PLAN.md 3.4).
    "silence_pause_seconds": 90,
    "fps_limit": 60,
    # English unless the player picks Russian; "auto" follows the system (sidequest/i18n.py).
    "language": "en",
}

# Last Claude Code version whose events were verified (stage 0, docs/events.md).
STAGE0_VERIFIED_VERSION = "2.1.286"


class Store:
    def __init__(self, path: str) -> None:
        self.path = path
        self._lock = threading.Lock()
        new = not os.path.exists(path)
        self._db = sqlite3.connect(path, check_same_thread=False)
        if new and path != ":memory:":
            os.chmod(path, 0o600)
        self._db.executescript(SCHEMA)
        self._db.commit()

    def close(self) -> None:
        with self._lock:
            self._db.close()

    # --- events -------------------------------------------------------------------

    def add_event(self, event: Row) -> None:
        """Store one game event and keep the sessions table in step with it."""
        kind = event["kind"]
        session = event.get("session")
        with self._lock, self._db:
            if kind == "session_start" and session:
                self._db.execute(
                    "INSERT OR IGNORE INTO sessions (id, project, started_at, joined)"
                    " VALUES (?, ?, ?, ?)",
                    (session, event.get("project"), event["ts"], int(bool(event.get("joined")))),
                )
            elif kind == "session_end" and session:
                self._db.execute(
                    "UPDATE sessions SET ended_at = ? WHERE id = ?", (event["ts"], session)
                )
            self._db.execute(
                "INSERT INTO events (session, ts, kind, data) VALUES (?, ?, ?, ?)",
                (
                    session,
                    event["ts"],
                    kind,
                    json.dumps(event, ensure_ascii=False, allow_nan=False),
                ),
            )

    def session_events(self, session: str) -> list[Row]:
        with self._lock:
            rows = self._db.execute(
                "SELECT data FROM events WHERE session = ? ORDER BY ts, id", (session,)
            ).fetchall()
        return [json.loads(row[0]) for row in rows]

    def sessions(self, limit: int = 50) -> list[Row]:
        with self._lock:
            rows = self._db.execute(
                "SELECT id, project, started_at, ended_at, joined FROM sessions"
                " ORDER BY started_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        keys = ("id", "project", "started_at", "ended_at", "joined")
        return [dict(zip(keys, row, strict=False)) for row in rows]

    def session_summaries(self, limit: int = 30, min_actions: int = 1) -> list[Row]:
        """Past sessions with how long they ran and how many actions the agent took."""
        with self._lock:
            rows = self._db.execute(
                "SELECT s.id, s.project, s.started_at, MAX(e.ts),"
                " SUM(e.kind IN ('tool', 'tool_error')) AS actions"
                " FROM sessions s JOIN events e ON e.session = s.id"
                " GROUP BY s.id HAVING actions >= ?"
                " ORDER BY s.started_at DESC LIMIT ?",
                (min_actions, limit),
            ).fetchall()
        keys = ("id", "project", "started_at", "last_ts", "actions")
        return [dict(zip(keys, row, strict=False)) for row in rows]

    def recent_events(self, limit: int = 100) -> list[Row]:
        with self._lock:
            rows = self._db.execute(
                "SELECT data FROM events ORDER BY ts DESC, id DESC LIMIT ?", (limit,)
            ).fetchall()
        return [json.loads(row[0]) for row in rows]

    def stats(self) -> Stats:
        """Overall profile statistics, computed from stored events."""
        with self._lock:
            sessions, agent_time = self._db.execute(
                "SELECT COUNT(*), COALESCE(SUM(ended_at - started_at), 0) FROM sessions"
                " WHERE ended_at IS NOT NULL"
            ).fetchone()
            counts = dict(
                self._db.execute("SELECT kind, COUNT(*) FROM events GROUP BY kind").fetchall()
            )
            lines = self._db.execute(
                "SELECT COALESCE(SUM(json_extract(data, '$.lines_added')), 0) FROM events"
                " WHERE kind = 'tool'"
            ).fetchone()[0]
        return {
            "sessions": sessions,
            "agent_seconds": round(agent_time),
            "actions": counts.get("tool", 0),
            "errors": counts.get("tool_error", 0),
            "blocked": counts.get("blocked", 0),
            "lines_added": lines,
        }

    def delete_all(self) -> None:
        with self._lock, self._db:
            self._db.execute("DELETE FROM events")
            self._db.execute("DELETE FROM sessions")
            self._db.execute("DELETE FROM meta")

    # --- meta and settings --------------------------------------------------------

    def get_meta(self, key: str, default: Any = None) -> Any:
        with self._lock:
            row = self._db.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def set_meta(self, key: str, value: Any) -> None:
        with self._lock, self._db:
            self._db.execute(
                "INSERT INTO meta (key, value) VALUES (?, ?)"
                " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, json.dumps(value, allow_nan=False)),
            )

    def get_setting(self, name: str) -> Any:
        return self.get_meta("setting." + name, DEFAULT_SETTINGS[name])

    def set_setting(self, name: str, value: Any) -> None:
        if name not in DEFAULT_SETTINGS:
            raise KeyError(name)
        self.set_meta("setting." + name, value)

    def verified_version(self) -> str:
        version: str = self.get_meta("verified_version", STAGE0_VERIFIED_VERSION)
        return version
