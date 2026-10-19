"""Turn raw Claude Code hook payloads into game events.

This is the only place that ever looks at raw payloads. File contents, edit text,
commands, prompts, tool output and transcript paths are read here at most to derive
a number or a category, and are never put into a game event. See docs/events.md for
the event semantics this module relies on.
"""

import math
import os
import re
import shlex
from typing import Any

# A raw hook payload once it is known to be a JSON object. Its values are untrusted: every
# one is read through _text / _number or an isinstance check, so a field of another type
# or length than Claude Code sends never reaches a game event or crashes a handler.
Payload = dict[str, Any]
# A game event: "ts", "session", "project", "kind" plus the fields of that kind.
Event = dict[str, Any]

# Hook events Sidequest subscribes to (also used by install and the self-check).
HOOK_EVENTS = [
    "SessionStart",
    "SessionEnd",
    "UserPromptSubmit",
    "PreToolUse",
    "PermissionRequest",
    "PermissionDenied",
    "PostToolUse",
    "PostToolUseFailure",
    "PostToolBatch",
    "Stop",
    "StopFailure",
    "SubagentStart",
    "SubagentStop",
    "PreCompact",
    "PostCompact",
    "TaskCreated",
    "TaskCompleted",
]

# Events that are known but carry nothing for the game.
IGNORED_EVENTS = {"InstructionsLoaded", "Notification", "MessageDisplay"}

TOOL_ACTIONS = {
    "Edit": "attack",
    "MultiEdit": "attack",
    "Write": "attack",
    "NotebookEdit": "attack",
    "Read": "scout",
    "Grep": "scout",
    "Glob": "scout",
    "Bash": "cast",
    "WebSearch": "scout_far",
    "WebFetch": "scout_far",
    "Agent": "summon",
    "Task": "summon",
    "TodoWrite": "todo",
}

KNOWN_TOOLS = set(TOOL_ACTIONS) | {"AskUserQuestion", "ToolSearch"}

FILE_TOOLS = {"Edit", "MultiEdit", "Write", "NotebookEdit", "Read"}

# Command words that only wrap the real command.
_WRAPPERS = {"sudo", "time", "nice", "env", "command", "exec", "npx", "bunx"}
_RUNNERS = {("uv", "run"), ("poetry", "run"), ("pipenv", "run"), ("bundle", "exec")}

_TEST_WORDS = {"pytest", "jest", "vitest", "mocha", "rspec", "tox", "nox", "ctest", "phpunit"}
_TEST_SUBCOMMANDS = {
    "npm": {"test", "t"},
    "yarn": {"test"},
    "pnpm": {"test"},
    "bun": {"test"},
    "go": {"test"},
    "cargo": {"test", "nextest"},
    "make": {"test", "check"},
    "mvn": {"test", "verify"},
    "gradle": {"test"},
    "swift": {"test"},
    "dotnet": {"test"},
    "mix": {"test"},
}
_PY_TEST_MODULES = {"pytest", "unittest"}
_BUILD_WORDS = {
    "make",
    "cmake",
    "ninja",
    "tsc",
    "gcc",
    "g++",
    "clang",
    "clang++",
    "xcodebuild",
    "webpack",
    "vite",
    "esbuild",
    "rollup",
    "bazel",
}
_BUILD_SUBCOMMANDS = {
    "npm": {"build"},
    "yarn": {"build"},
    "pnpm": {"build"},
    "bun": {"build"},
    "go": {"build"},
    "cargo": {"build"},
    "mvn": {"package", "compile", "install"},
    "gradle": {"build", "assemble"},
    "swift": {"build"},
    "dotnet": {"build"},
    "docker": {"build"},
}
_GIT_WORDS = {"git", "gh"}
# Looking around the code. Grep and Glob tools do not exist in 2.1.286, so the agent
# searches with Bash (docs/events.md); these commands count as scouting.
_SEARCH_WORDS = {
    "grep",
    "egrep",
    "fgrep",
    "rg",
    "ag",
    "ack",
    "find",
    "fd",
    "ls",
    "tree",
    "cat",
    "head",
    "tail",
    "less",
    "more",
    "wc",
    "file",
    "stat",
    "du",
}
# Harmless glue around a search: `cd src && ls`, `ls; echo ---; ls tests`.
_NEUTRAL_WORDS = {"cd", "pushd", "popd", "echo", "printf", "true", "pwd"}

_SEGMENT_SPLIT = re.compile(r"&&|\|\||[;|&\n]")
_EXIT_CODE = re.compile(r"^Exit code (-?\d+)")

MAX_TEXT = 128  # the longest name, id or reason a game event keeps, in characters
MAX_FILE = 256  # the longest file path a game event keeps
# Only the start of a shell command is classified: a heredoc of megabytes would hold the
# receiver in shlex long enough for other hooks to time out.
MAX_COMMAND = 64 * 1024


MAX_KINDS = 200  # the most different shapes, tools or events counted for the self-check
# What a payload of a shape nobody expected can raise while it is read.
BAD_INPUT = (TypeError, ValueError, AttributeError, KeyError, OverflowError)


def _text(value: object, limit: int = MAX_TEXT) -> str | None:
    """A non-empty string field cut to `limit`, or None for anything else."""
    return value[:limit] if isinstance(value, str) and value else None


def session_key(value: object) -> str | None:
    """A session id as game events carry it (cut like every name), or None."""
    return _text(value)


def _count(table: dict[Any, int], key: Any) -> None:
    """Count a kind; past MAX_KINDS different ones a new kind is not kept, so whatever
    writes to the socket cannot grow the tables without end."""
    if key in table or len(table) < MAX_KINDS:
        table[key] = table.get(key, 0) + 1


def _number(value: object) -> int | float | None:
    """A finite number field (not a bool), or None for anything else (an integer too big
    for a float too: JSON allows it, math.isfinite does not)."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    try:
        return value if math.isfinite(value) else None
    except OverflowError:
        return None


def _words(segment: str) -> list[str]:
    try:
        words = shlex.split(segment)
    except ValueError:
        words = segment.split()
    # Drop leading VAR=value assignments and wrapper words.
    while words and (("=" in words[0] and not words[0].startswith("=")) or words[0] in _WRAPPERS):
        words = words[1:]
    if len(words) >= 2 and (words[0], words[1]) in _RUNNERS:
        words = words[2:]
    return [os.path.basename(w) if i == 0 else w for i, w in enumerate(words)]


def _segment_category(words: list[str]) -> str | None:
    if not words:
        return None
    head, rest = words[0], words[1:]
    sub = rest[0] if rest else None
    if sub == "run" and len(rest) > 1:  # npm run test, yarn run build
        sub = rest[1]
    if head in _TEST_WORDS or sub in _TEST_SUBCOMMANDS.get(head, ()):
        return "test"
    if (
        re.fullmatch(r"python[0-9.]*", head)
        and len(rest) >= 2
        and rest[0] == "-m"
        and rest[1] in _PY_TEST_MODULES
    ):
        return "test"
    if head in _BUILD_WORDS or sub in _BUILD_SUBCOMMANDS.get(head, ()):
        return "build"
    if head in _GIT_WORDS:
        return "git"
    if head in _SEARCH_WORDS:
        return "search"
    if head in _NEUTRAL_WORDS:
        return "neutral"
    return None


def _command_head(command: object) -> str:
    return command[:MAX_COMMAND] if isinstance(command, str) else ""


def bash_category(command: object) -> str:
    """Classify a shell command as test, build, git, search or other.

    The command itself is discarded. "search" needs every part of the command to be
    a search or neutral glue: `cat data.txt | python3 run.py` runs a script, so "other".
    """
    found: set[str | None] = set()
    for segment in _SEGMENT_SPLIT.split(_command_head(command)):
        words = _words(segment)
        if words:
            found.add(_segment_category(words))
    for category in ("test", "build", "git"):
        if category in found:
            return category
    if "search" in found and found <= {"search", "neutral"}:
        return "search"
    return "other"


# git options that take a separate argument: `git -C repo commit`.
_GIT_OPTIONS_WITH_VALUE = {"-C", "-c", "--git-dir", "--work-tree", "--namespace"}


def _git_op(words: list[str]) -> str | None:
    head, rest = words[0], words[1:]
    if head == "gh":
        # gh pr create / gh pr merge publish the work, like a push.
        if rest[:1] == ["pr"] and len(rest) > 1 and rest[1] in ("create", "merge"):
            return "push"
        return None
    if head != "git":
        return None
    i = 0
    while i < len(rest) and rest[i].startswith("-"):
        i += 2 if rest[i] in _GIT_OPTIONS_WITH_VALUE else 1
    sub = rest[i] if i < len(rest) else None
    return sub if sub in ("commit", "push") else None


def git_ops(command: object) -> list[str]:
    """The git steps a shell command takes, from a fixed list: "commit", "push".

    Only these words leave the normalizer, never the command.
    """
    found: set[str | None] = set()
    for segment in _SEGMENT_SPLIT.split(_command_head(command)):
        words = _words(segment)
        if words:
            found.add(_git_op(words))
    return [op for op in ("commit", "push") if op in found]


def _count_patch(patch: list[Any]) -> tuple[int, int]:
    added = removed = 0
    for hunk in patch:
        lines = hunk.get("lines") if isinstance(hunk, dict) else None
        for line in lines if isinstance(lines, list) else []:
            if not isinstance(line, str):
                continue
            if line.startswith("+"):
                added += 1
            elif line.startswith("-"):
                removed += 1
    return added, removed


def _line_count(text: object) -> int:
    if not isinstance(text, str) or not text:
        return 0
    return text.count("\n") + (0 if text.endswith("\n") else 1)


def _parse_exit_code(error: object) -> int | None:
    match = _EXIT_CODE.match(error) if isinstance(error, str) else None
    return int(match.group(1)) if match else None


class _Session:
    def __init__(self, project: str | None) -> None:
        self.project = project
        self.prompt_id: str | None = None
        # None or {"agent": agent_id or None, "tool": name}
        self.waiting: dict[str, Any] | None = None
        self.pending: dict[str, str | None] = {}  # tool_use_id -> tool_name, from PreToolUse
        self.finished: set[str] = set()  # tool_use_ids with PostToolUse / Failure / Denied
        self.subagents: set[str | None] = set()  # agent_ids announced by SubagentStart


class Normalizer:
    """Stateful translator: one instance per running app, state is kept per session."""

    def __init__(self) -> None:
        self.sessions: dict[str, _Session] = {}
        # Names only: (event, sorted field names) -> count, and unknown tools/events.
        self.shapes: dict[tuple[str, tuple[str, ...]], int] = {}
        self.unknown_events: dict[str, int] = {}
        self.unknown_tools: dict[str, int] = {}

    def process(self, payload: object, ts: float) -> list[Event]:
        """Return the list of game events produced by one raw payload."""
        if not isinstance(payload, dict):
            return [self._unknown(ts, None, "_invalid")]
        name = _text(payload.get("hook_event_name"))
        if name is None:
            return [self._unknown(ts, None, "_invalid")]
        _count(self.shapes, (name, tuple(sorted(str(k)[:MAX_TEXT] for k in payload))))

        session_id = _text(payload.get("session_id"))
        if session_id is None:
            return [self._unknown(ts, None, name)]

        out: list[Event] = []
        session = self.sessions.get(session_id)
        if session is None:
            session = _Session(_project_name(payload.get("cwd")))
            self.sessions[session_id] = session
            joined = not (name == "SessionStart" and payload.get("source") != "compact")
            out.append(
                self._event(
                    ts,
                    session_id,
                    session,
                    "session_start",
                    joined=joined,
                    source=_text(payload.get("source")),
                )
            )
            if not joined:
                return out

        agent = _text(payload.get("agent_id"))
        # A background task notification is a UserPromptSubmit with the old prompt_id;
        # it says nothing about the user, so it must not end a pause.
        notification = (
            name == "UserPromptSubmit" and _text(payload.get("prompt_id")) == session.prompt_id
        )
        # Notification(permission_prompt) arrives during the wait itself, so ignored
        # events never end a pause either.
        if (
            session.waiting is not None
            and name != "PermissionRequest"
            and name not in IGNORED_EVENTS
            and not notification
            and agent == session.waiting["agent"]
        ):
            if name == "UserPromptSubmit" and agent is None:
                # A prompt while a permission request is unanswered means "No" or Esc.
                out.append(
                    self._event(
                        ts,
                        session_id,
                        session,
                        "blocked",
                        tool=session.waiting["tool"],
                        reason="rejected",
                        agent=agent,
                    )
                )
            out.append(self._event(ts, session_id, session, "resumed", agent=agent))
            session.waiting = None

        handler = getattr(self, "_on_" + name, None)
        if handler is not None:
            # Untrusted input: a payload of a shape no handler expects costs only its own
            # events, never the session_start or resume already in `out`.
            try:
                out.extend(handler(ts, session_id, session, payload, agent))
            except BAD_INPUT:
                _count(self.unknown_events, "_invalid")
        elif name not in IGNORED_EVENTS:
            out.append(self._unknown(ts, session_id, name, session))
        return out

    # --- per-event handlers -------------------------------------------------------

    def _on_SessionStart(
        self, ts: float, sid: str, session: _Session, payload: Payload, agent: Any
    ) -> list[Event]:
        # A second SessionStart with source "compact" is the end of compaction, which
        # PostCompact reports; a startup / resume of a known session changes nothing.
        return []

    def _on_SessionEnd(
        self, ts: float, sid: str, session: _Session, payload: Payload, agent: Any
    ) -> list[Event]:
        del self.sessions[sid]
        return [self._event(ts, sid, session, "session_end", reason=_text(payload.get("reason")))]

    def _on_UserPromptSubmit(
        self, ts: float, sid: str, session: _Session, payload: Payload, agent: Any
    ) -> list[Event]:
        prompt_id = _text(payload.get("prompt_id"))
        # Background task notifications arrive as a prompt with the same prompt_id.
        if prompt_id is not None and prompt_id == session.prompt_id:
            return []
        session.prompt_id = prompt_id
        # Tools that started but never finished were interrupted with Esc.
        session.pending.clear()
        session.finished.clear()
        return [self._event(ts, sid, session, "prompt")]

    def _on_PreToolUse(
        self, ts: float, sid: str, session: _Session, payload: Payload, agent: Any
    ) -> list[Event]:
        tool_use_id = _text(payload.get("tool_use_id"))
        if tool_use_id:
            session.pending[tool_use_id] = _text(payload.get("tool_name"))
        return []

    def _on_PermissionRequest(
        self, ts: float, sid: str, session: _Session, payload: Payload, agent: Any
    ) -> list[Event]:
        tool = _text(payload.get("tool_name"))
        session.waiting = {"agent": agent, "tool": tool}
        return [self._event(ts, sid, session, "waiting", tool=tool, agent=agent)]

    def _on_PermissionDenied(
        self, ts: float, sid: str, session: _Session, payload: Payload, agent: Any
    ) -> list[Event]:
        self._finish(session, payload.get("tool_use_id"))
        return [
            self._event(
                ts,
                sid,
                session,
                "blocked",
                tool=_text(payload.get("tool_name")),
                reason="denied",
                agent=agent,
            )
        ]

    def _on_PostToolUse(
        self, ts: float, sid: str, session: _Session, payload: Payload, agent: Any
    ) -> list[Event]:
        self._finish(session, payload.get("tool_use_id"))
        tool = payload.get("tool_name")
        event = self._tool_fields(session, tool, payload)
        event.update(ok=True, duration_ms=_number(payload.get("duration_ms")), agent=agent)
        lines = _changed_lines(tool, payload.get("tool_response"), payload.get("tool_input"))
        if lines is not None:
            event["lines_added"], event["lines_removed"] = lines
        return [self._event(ts, sid, session, "tool", **event)]

    def _on_PostToolUseFailure(
        self, ts: float, sid: str, session: _Session, payload: Payload, agent: Any
    ) -> list[Event]:
        self._finish(session, payload.get("tool_use_id"))
        tool = payload.get("tool_name")
        event = self._tool_fields(session, tool, payload)
        event.update(
            ok=False,
            exit_code=_parse_exit_code(payload.get("error")),
            interrupted=payload.get("is_interrupt") is True,
            duration_ms=_number(payload.get("duration_ms")),
            agent=agent,
        )
        return [self._event(ts, sid, session, "tool_error", **event)]

    def _on_PostToolBatch(
        self, ts: float, sid: str, session: _Session, payload: Payload, agent: Any
    ) -> list[Event]:
        # A call that is in the batch but never got PostToolUse / Failure was blocked
        # (permissions.deny or Claude Code itself), see docs/events.md.
        out: list[Event] = []
        calls = payload.get("tool_calls")
        for call in calls if isinstance(calls, list) else []:
            if not isinstance(call, dict):
                continue
            tool_use_id = _text(call.get("tool_use_id"))
            if tool_use_id in session.finished:
                session.finished.discard(tool_use_id)
            else:
                out.append(
                    self._event(
                        ts,
                        sid,
                        session,
                        "blocked",
                        tool=_text(call.get("tool_name")),
                        reason="rule",
                        agent=agent,
                    )
                )
            if tool_use_id:
                session.pending.pop(tool_use_id, None)
        return out

    def _on_Stop(
        self, ts: float, sid: str, session: _Session, payload: Payload, agent: Any
    ) -> list[Event]:
        tasks = payload.get("background_tasks")
        background = sum(
            1
            for task in (tasks if isinstance(tasks, list) else [])
            if isinstance(task, dict) and task.get("status") == "running"
        )
        return [
            self._event(
                ts, sid, session, "stop", ok=True, background=background, final=background == 0
            )
        ]

    def _on_StopFailure(
        self, ts: float, sid: str, session: _Session, payload: Payload, agent: Any
    ) -> list[Event]:
        return [self._event(ts, sid, session, "stop", ok=False, background=0, final=True)]

    def _on_SubagentStart(
        self, ts: float, sid: str, session: _Session, payload: Payload, agent: Any
    ) -> list[Event]:
        agent_type = _text(payload.get("agent_type"))
        if not agent_type:
            return []
        session.subagents.add(agent)
        return [
            self._event(
                ts,
                sid,
                session,
                "subagent_start",
                agent=agent,
                agent_type=agent_type,
            )
        ]

    def _on_SubagentStop(
        self, ts: float, sid: str, session: _Session, payload: Payload, agent: Any
    ) -> list[Event]:
        # Compaction runs a hidden agent with an empty type and no SubagentStart.
        if agent not in session.subagents:
            return []
        session.subagents.discard(agent)
        return [
            self._event(
                ts,
                sid,
                session,
                "subagent_stop",
                agent=agent,
                agent_type=_text(payload.get("agent_type")),
            )
        ]

    def _on_PreCompact(
        self, ts: float, sid: str, session: _Session, payload: Payload, agent: Any
    ) -> list[Event]:
        return [
            self._event(
                ts, sid, session, "compact", phase="start", trigger=_text(payload.get("trigger"))
            )
        ]

    def _on_PostCompact(
        self, ts: float, sid: str, session: _Session, payload: Payload, agent: Any
    ) -> list[Event]:
        return [
            self._event(
                ts, sid, session, "compact", phase="end", trigger=_text(payload.get("trigger"))
            )
        ]

    def _on_TaskCreated(
        self, ts: float, sid: str, session: _Session, payload: Payload, agent: Any
    ) -> list[Event]:
        # Never observed in 2.1.286 (no task tool); kept so a future version just works.
        return [self._event(ts, sid, session, "todo", change="created")]

    def _on_TaskCompleted(
        self, ts: float, sid: str, session: _Session, payload: Payload, agent: Any
    ) -> list[Event]:
        return [self._event(ts, sid, session, "todo", change="completed")]

    # --- helpers ------------------------------------------------------------------

    def _finish(self, session: _Session, raw_id: object) -> None:
        tool_use_id = _text(raw_id)
        if tool_use_id:
            session.pending.pop(tool_use_id, None)
            session.finished.add(tool_use_id)

    def _tool_fields(self, session: _Session, raw_tool: object, payload: Payload) -> dict[str, Any]:
        tool = _text(raw_tool) or "?"
        action = TOOL_ACTIONS.get(tool, "generic")
        if tool not in KNOWN_TOOLS:
            _count(self.unknown_tools, tool)
        fields: dict[str, Any] = {"tool": tool, "action": action}
        tool_input = payload.get("tool_input")
        if not isinstance(tool_input, dict):
            tool_input = {}
        if tool == "Bash":
            fields["category"] = bash_category(tool_input.get("command"))
            if fields["category"] == "search":
                fields["action"] = "scout"  # games treat it like Read
            if fields["category"] == "git":
                fields["git"] = git_ops(tool_input.get("command"))
        if tool in FILE_TOOLS:
            path = tool_input.get("file_path") or tool_input.get("notebook_path")
            fields["file"] = _relative_file(path, payload.get("cwd"))
        return fields

    def _event(self, ts: float, sid: str, session: _Session, kind: str, **fields: Any) -> Event:
        event = {"ts": ts, "session": sid, "project": session.project, "kind": kind}
        event.update(fields)
        return event

    def _unknown(
        self, ts: float, sid: str | None, name: str, session: _Session | None = None
    ) -> Event:
        _count(self.unknown_events, name)
        return {
            "ts": ts,
            "session": sid,
            "project": session.project if session else None,
            "kind": "unknown",
            "event": name,
        }


def _project_name(cwd: object) -> str | None:
    if not isinstance(cwd, str) or not cwd:
        return None
    return _text(os.path.basename(os.path.normpath(cwd)))


def _relative_file(path: object, cwd: object) -> str | None:
    if not isinstance(path, str) or not path:
        return None
    if isinstance(cwd, str) and cwd:
        try:
            rel = os.path.relpath(path, cwd)
        except ValueError:
            rel = None
        if rel and not rel.startswith(".."):
            return _text(rel, MAX_FILE)
    return _text(os.path.basename(path), MAX_FILE)


def _changed_lines(tool: object, response: object, tool_input: object) -> tuple[int, int] | None:
    if not isinstance(tool, str) or tool not in {"Edit", "MultiEdit", "Write", "NotebookEdit"}:
        return None
    if not isinstance(response, dict):
        return None
    patch = response.get("structuredPatch")
    if isinstance(patch, list) and patch:
        return _count_patch(patch)
    if tool == "Write" and isinstance(tool_input, dict):
        return _line_count(tool_input.get("content")), 0
    return None
