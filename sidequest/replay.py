"""Replay mode (PLAN.md 3.6): feed recorded or hand-written events with original pauses.

A recording / scenario is JSONL: one game event per line plus "t", seconds from the
start of the session. The player re-stamps "ts" with the current time when it emits.
"""
import json
import os
import re
import threading
import time

SPEEDS = (1, 2, 5, 10)


def load(path):
    events = []
    with open(path, encoding="utf-8") as f:
        for number, line in enumerate(f, 1):
            line = line.strip()
            if not line or line.startswith("//"):
                continue
            try:
                event = json.loads(line)
            except ValueError as e:
                raise ValueError(f"{path}:{number}: {e}") from None
            if not isinstance(event, dict) or "kind" not in event or "t" not in event:
                raise ValueError(f"{path}:{number}: нужны поля kind и t")
            events.append(event)
    events.sort(key=lambda e: e["t"])
    return events


def export_session(store, session, directory, name=None):
    """Save one session from the database as a recording; returns the file path."""
    events = store.session_events(session)
    if not events:
        raise ValueError("в сессии нет событий")
    start = events[0]["ts"]
    name = name or f"{events[0].get('project') or 'session'}-{session[:8]}"
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-") or "session"
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, name + ".jsonl")
    with open(path, "w", encoding="utf-8") as f:
        for event in events:
            line = dict(event, t=round(event["ts"] - start, 3))
            del line["ts"]
            f.write(json.dumps(line, ensure_ascii=False) + "\n")
    return path


class Player:
    """Plays events through `emit(event)`. Controls are safe to call from any thread."""

    def __init__(self, events, emit, speed=1, on_finish=None):
        if speed not in SPEEDS:
            raise ValueError(f"скорость должна быть одной из {SPEEDS}")
        self.events = events
        self.emit = emit
        self.on_finish = on_finish
        self._speed = speed
        self._index = 0
        self._clock = 0.0           # replay time in seconds since the first event
        self._paused = False
        self._stopped = False
        self._cond = threading.Condition()
        self._thread = None

    # --- controls ---------------------------------------------------------------

    def start(self):
        self._thread = threading.Thread(target=self._run, name="sidequest-replay",
                                        daemon=True)
        self._thread.start()

    def stop(self):
        with self._cond:
            self._stopped = True
            self._cond.notify_all()

    def pause(self, paused=True):
        with self._cond:
            self._paused = paused
            self._cond.notify_all()

    def set_speed(self, speed):
        if speed not in SPEEDS:
            raise ValueError(speed)
        with self._cond:
            self._speed = speed
            self._cond.notify_all()

    def step(self):
        """While paused: emit the next event immediately."""
        with self._cond:
            if self._index >= len(self.events):
                return
            event = self.events[self._index]
            self._index += 1
            self._clock = event["t"]
        self._emit(event)

    def seek(self, t):
        """Jump to replay time t; skipped events are not emitted."""
        with self._cond:
            self._clock = max(0.0, t)
            self._index = next((i for i, e in enumerate(self.events) if e["t"] >= self._clock),
                               len(self.events))
            self._cond.notify_all()

    @property
    def position(self):
        return self._clock

    @property
    def duration(self):
        return self.events[-1]["t"] if self.events else 0.0

    # --- playback ---------------------------------------------------------------

    def _run(self):
        last = time.monotonic()
        while True:
            with self._cond:
                if self._stopped:
                    return
                if self._index >= len(self.events):
                    break
                now = time.monotonic()
                if not self._paused:
                    self._clock += (now - last) * self._speed
                last = now
                event = self.events[self._index]
                if self._paused or event["t"] > self._clock:
                    wait = 0.05 if self._paused else \
                        min(0.05, (event["t"] - self._clock) / self._speed)
                    self._cond.wait(wait)
                    continue
                self._index += 1
            self._emit(event)
        if self.on_finish:
            self.on_finish()

    def _emit(self, event):
        out = dict(event, ts=time.time(), replay=True)
        del out["t"]
        self.emit(out)
