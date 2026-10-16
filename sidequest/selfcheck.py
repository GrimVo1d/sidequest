"""Self-check (PLAN.md 3.5): quick checks on start, control session, running counters."""

import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import threading
import time
from typing import TypedDict

from . import claude_settings
from .i18n import t
from .normalizer import HOOK_EVENTS

SELFTEST_EVENT = "SidequestSelfTest"
SLOW_HOOK_MS = 50

CLAUDE_CANDIDATES = [
    "~/.local/bin/claude",
    "~/.claude/local/claude",
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
]

# Fields every event of this kind had in stage 0 (docs/events.md); the control
# session reports any of them missing.
EXPECTED_FIELDS = {
    "SessionStart": {"session_id", "cwd", "source"},
    "SessionEnd": {"session_id", "reason"},
    "UserPromptSubmit": {"session_id", "cwd", "prompt_id"},
    "PreToolUse": {"session_id", "cwd", "tool_name", "tool_input", "tool_use_id"},
    "PermissionRequest": {"session_id", "tool_name"},
    "PostToolUse": {
        "session_id",
        "cwd",
        "tool_name",
        "tool_input",
        "tool_response",
        "tool_use_id",
        "duration_ms",
    },
    "PostToolUseFailure": {"session_id", "tool_name", "tool_use_id", "error", "is_interrupt"},
    "PostToolBatch": {"session_id", "tool_calls"},
    "Stop": {"session_id", "background_tasks"},
    "SubagentStart": {"session_id", "agent_id", "agent_type"},
    "SubagentStop": {"session_id", "agent_id", "agent_type"},
    "PreCompact": {"session_id", "trigger"},
    "PostCompact": {"session_id", "trigger"},
}
# Events any ordinary session with at least one tool call produces.
EXPECTED_EVENTS = [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PostToolBatch",
    "Stop",
    "SessionEnd",
]


class CheckResult(TypedDict):
    name: str
    ok: bool
    warn: bool
    detail: str
    fix: str | None


class Result:
    def __init__(
        self, name: str, ok: bool, detail: str, fix: str | None = None, warn: bool = False
    ) -> None:
        self.name, self.ok, self.detail, self.fix, self.warn = name, ok, detail, fix, warn

    def as_dict(self) -> CheckResult:
        return {
            "name": self.name,
            "ok": self.ok,
            "warn": self.warn,
            "detail": self.detail,
            "fix": self.fix,
        }


def file_hash(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


# --- a) hooks are in place -----------------------------------------------------------


def check_hooks(settings_path: str, emit_path: str, expected_hash: str | None) -> Result:
    try:
        settings, raw = claude_settings.read_settings(settings_path)
    except claude_settings.SettingsError as e:
        return Result(
            t("Хуки", "Hooks"),
            False,
            str(e),
            t("Исправьте settings.json вручную", "Fix settings.json by hand"),
        )
    if raw is None:
        return Result(
            t("Хуки", "Hooks"),
            False,
            t("settings.json нет", "no settings.json"),
            t("Нажмите «Подключить к Claude Code»", "Press “Connect to Claude Code”"),
        )
    if settings.get("disableAllHooks") is True:
        return Result(
            t("Хуки", "Hooks"),
            False,
            t("в settings.json включено disableAllHooks", "disableAllHooks is on in settings.json"),
            t(
                "Уберите disableAllHooks, иначе Claude Code не вызывает хуки",
                "Remove disableAllHooks, or Claude Code calls no hooks",
            ),
        )
    entries = claude_settings.find_entries(settings)
    missing = [e for e in HOOK_EVENTS if e not in entries]
    if missing and len(missing) == len(HOOK_EVENTS):
        return Result(
            t("Хуки", "Hooks"),
            False,
            t("Sidequest не подключён к Claude Code", "Sidequest is not connected to Claude Code"),
            t("Нажмите «Подключить к Claude Code»", "Press “Connect to Claude Code”"),
        )
    if missing:
        return Result(
            t("Хуки", "Hooks"),
            False,
            t("нет записей для: ", "no entries for: ") + ", ".join(missing),
            t("Нажмите «Подключить» ещё раз", "Press “Connect” again"),
        )
    paths = {p for ps in entries.values() for p in ps}
    if paths != {emit_path}:
        return Result(
            t("Хуки", "Hooks"),
            False,
            t(
                "записи указывают на другой путь — папку переместили?",
                "the entries point to another path — was the folder moved?",
            ),
            t("Нажмите «Подключить» ещё раз", "Press “Connect” again"),
        )
    if not os.path.isfile(emit_path):
        return Result(
            t("Хуки", "Hooks"),
            False,
            t(f"нет файла {emit_path}", f"no file {emit_path}"),
            t("Восстановите проект", "Restore the project"),
        )
    if expected_hash and file_hash(emit_path) != expected_hash:
        return Result(
            t("Хуки", "Hooks"),
            False,
            t(
                "sidequest-emit.sh изменился после установки",
                "sidequest-emit.sh changed after it was installed",
            ),
            t(
                "Проверьте скрипт и нажмите «Подключить» ещё раз",
                "Check the script and press “Connect” again",
            ),
        )
    return Result(
        t("Хуки", "Hooks"),
        True,
        t(f"все {len(HOOK_EVENTS)} событий подключены", f"all {len(HOOK_EVENTS)} events connected"),
    )


# --- b) Claude Code version ----------------------------------------------------------


def find_claude() -> str | None:
    found = shutil.which("claude")
    if found:
        return found
    for candidate in CLAUDE_CANDIDATES:
        path = os.path.expanduser(candidate)
        if os.access(path, os.X_OK):
            return path
    return None


def claude_version(timeout: float = 3) -> str | None:
    exe = find_claude()
    if not exe:
        return None
    try:
        out = subprocess.run(
            [exe, "--version"], capture_output=True, text=True, timeout=timeout
        ).stdout
    except (OSError, subprocess.TimeoutExpired):
        return None
    match = re.search(r"\d+\.\d+\.\d+", out)
    return match.group(0) if match else None


def check_version(verified: str) -> tuple[Result, str | None]:
    version = claude_version()
    if version is None:
        return Result(
            t("Версия Claude Code", "Claude Code version"),
            False,
            t("claude не найден или не ответил за 3 сек", "claude not found or no answer in 3 sec"),
            t("Проверьте, что Claude Code установлен", "Check that Claude Code is installed"),
        ), None
    if version == verified:
        return Result(
            t("Версия Claude Code", "Claude Code version"),
            True,
            t(f"{version}, проверена", f"{version}, verified"),
        ), version
    return Result(
        t("Версия Claude Code", "Claude Code version"),
        True,
        t(
            f"{version} — новая (проверена {verified}); следующая сессия станет контрольной",
            f"{version} is new (verified: {verified}); the next session is the control one",
        ),
        warn=True,
    ), version


# --- c) pipeline ---------------------------------------------------------------------


class PipelineProbe:
    """Receiver side of the pipeline check: the app hands it SidequestSelfTest payloads."""

    def __init__(self) -> None:
        self._token: str | None = None
        self._got = threading.Event()

    def arm(self) -> str:
        self._token = secrets.token_hex(16)
        self._got.clear()
        return self._token

    def offer(self, payload: object) -> bool:
        """Return True if the payload is a self-test (it is then consumed, not stored)."""
        if not isinstance(payload, dict) or payload.get("hook_event_name") != SELFTEST_EVENT:
            return False
        if self._token and payload.get("token") == self._token:
            self._got.set()
        return True

    def wait(self, timeout: float) -> bool:
        return self._got.wait(timeout)


def check_pipeline(emit_path: str, probe: PipelineProbe, timeout: float = 1.0) -> Result:
    token = probe.arm()
    payload = json.dumps({"hook_event_name": SELFTEST_EVENT, "token": token}).encode()
    start = time.monotonic()
    try:
        proc = subprocess.run(["/bin/sh", emit_path], input=payload, capture_output=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired) as e:
        return Result(
            t("Конвейер", "Pipeline"),
            False,
            t(f"хук не запустился: {e}", f"the hook did not run: {e}"),
            t("Проверьте hooks/sidequest-emit.sh", "Check hooks/sidequest-emit.sh"),
        )
    elapsed_ms = (time.monotonic() - start) * 1000
    if proc.returncode != 0 or proc.stdout:
        return Result(
            t("Конвейер", "Pipeline"),
            False,
            t(
                f"хук вышел с кодом {proc.returncode} или что-то напечатал",
                f"the hook exited with code {proc.returncode} or printed something",
            ),
            t("Проверьте hooks/sidequest-emit.sh", "Check hooks/sidequest-emit.sh"),
        )
    if not probe.wait(timeout):
        return Result(
            t("Конвейер", "Pipeline"),
            False,
            t("событие не дошло до сокета за 1 сек", "the event did not reach the socket in 1 sec"),
            t("Перезапустите Sidequest", "Restart Sidequest"),
        )
    if elapsed_ms > SLOW_HOOK_MS:
        return Result(
            t("Конвейер", "Pipeline"),
            True,
            t(
                f"работает, но хук занял {elapsed_ms:.0f} мс — на столько он "
                "задерживает каждое действие агента",
                f"works, but the hook took {elapsed_ms:.0f} ms — it delays every "
                "agent action by that much",
            ),
            warn=True,
        )
    return Result(
        t("Конвейер", "Pipeline"),
        True,
        t(f"работает, хук — {elapsed_ms:.0f} мс", f"works, the hook takes {elapsed_ms:.0f} ms"),
    )


# --- 2) control session --------------------------------------------------------------


class ControlSession:
    """Collects event and field names of one session and compares them to stage 0."""

    def __init__(self, version: str) -> None:
        self.version = version
        self.session: object = None
        self.fields: dict[object, set[str]] = {}  # event name -> field names

    def observe(self, payload: object) -> list[str] | None:
        """Feed every raw payload; returns a report list once the session ends."""
        if not isinstance(payload, dict):
            return None
        session = payload.get("session_id")
        name = payload.get("hook_event_name")
        if self.session is None:
            if name != "SessionStart":
                return None  # wait for a session that starts while we watch
            self.session = session
        if session != self.session:
            return None
        self.fields.setdefault(name, set()).update(payload)
        if name == "SessionEnd":
            if "PreToolUse" not in self.fields:
                # No tool was called: nothing to compare, watch the next session.
                self.session, self.fields = None, {}
                return None
            return self.report()
        return None

    def report(self) -> list[str]:
        remarks: list[str] = []
        for name in EXPECTED_EVENTS:
            if name not in self.fields:
                remarks.append(t(f"не было {name}", f"no {name}"))
        for name, expected in EXPECTED_FIELDS.items():
            if name in self.fields:
                for field in sorted(expected - self.fields[name]):
                    remarks.append(t(f"в {name} нет поля {field}", f"{name} has no field {field}"))
        return remarks
