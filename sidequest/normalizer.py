"""Turn raw Claude Code hook payloads into game events.

This is the only place that ever looks at raw payloads. File contents, edit text,
commands, prompts, tool output and transcript paths are read here at most to derive
a number or a category, and are never put into a game event. See docs/events.md for
the event semantics this module relies on.
"""
import os
import re
import shlex

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
    "npm": {"test", "t"}, "yarn": {"test"}, "pnpm": {"test"}, "bun": {"test"},
    "go": {"test"}, "cargo": {"test", "nextest"}, "make": {"test", "check"},
    "mvn": {"test", "verify"}, "gradle": {"test"}, "swift": {"test"},
    "dotnet": {"test"}, "mix": {"test"},
}
_PY_TEST_MODULES = {"pytest", "unittest"}
_BUILD_WORDS = {"make", "cmake", "ninja", "tsc", "gcc", "g++", "clang", "clang++",
                "xcodebuild", "webpack", "vite", "esbuild", "rollup", "bazel"}
_BUILD_SUBCOMMANDS = {
    "npm": {"build"}, "yarn": {"build"}, "pnpm": {"build"}, "bun": {"build"},
    "go": {"build"}, "cargo": {"build"}, "mvn": {"package", "compile", "install"},
    "gradle": {"build", "assemble"}, "swift": {"build"}, "dotnet": {"build"},
    "docker": {"build"},
}
_GIT_WORDS = {"git", "gh"}
# Looking around the code. Grep and Glob tools do not exist in 2.1.286, so the agent
# searches with Bash (docs/events.md); these commands count as scouting.
_SEARCH_WORDS = {"grep", "egrep", "fgrep", "rg", "ag", "ack", "find", "fd", "ls", "tree",
                 "cat", "head", "tail", "less", "more", "wc", "file", "stat", "du"}
# Harmless glue around a search: `cd src && ls`, `ls; echo ---; ls tests`.
_NEUTRAL_WORDS = {"cd", "pushd", "popd", "echo", "printf", "true", "pwd"}

_SEGMENT_SPLIT = re.compile(r"&&|\|\||[;|&\n]")
_EXIT_CODE = re.compile(r"^Exit code (-?\d+)")


def _words(segment):
    try:
        words = shlex.split(segment)
    except ValueError:
        words = segment.split()
    # Drop leading VAR=value assignments and wrapper words.
    while words and ("=" in words[0] and not words[0].startswith("=")
                     or words[0] in _WRAPPERS):
        words = words[1:]
    if len(words) >= 2 and (words[0], words[1]) in _RUNNERS:
        words = words[2:]
    return [os.path.basename(w) if i == 0 else w for i, w in enumerate(words)]


def _segment_category(words):
    if not words:
        return None
    head, rest = words[0], words[1:]
    sub = rest[0] if rest else None
    if sub == "run" and len(rest) > 1:  # npm run test, yarn run build
        sub = rest[1]
    if head in _TEST_WORDS or sub in _TEST_SUBCOMMANDS.get(head, ()):
        return "test"
    if re.fullmatch(r"python[0-9.]*", head) and len(rest) >= 2 and rest[0] == "-m" \
            and rest[1] in _PY_TEST_MODULES:
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


def bash_category(command):
    """Classify a shell command as test, build, git, search or other.

    The command itself is discarded. "search" needs every part of the command to be
    a search or neutral glue: `cat data.txt | python3 run.py` runs a script, so "other".
    """
    found = set()
    for segment in _SEGMENT_SPLIT.split(command or ""):
        words = _words(segment)
        if words:
            found.add(_segment_category(words))
    for category in ("test", "build", "git"):
        if category in found:
            return category
    if "search" in found and found <= {"search", "neutral"}:
        return "search"
    return "other"


def _count_patch(patch):
    added = removed = 0
    for hunk in patch or []:
        for line in hunk.get("lines") or []:
            if line.startswith("+"):
                added += 1
            elif line.startswith("-"):
                removed += 1
    return added, removed


def _line_count(text):
    if not text:
        return 0
    return text.count("\n") + (0 if text.endswith("\n") else 1)


def _parse_exit_code(error):
    match = _EXIT_CODE.match(error or "")
    return int(match.group(1)) if match else None


class _Session:
    def __init__(self, project):
        self.project = project
        self.prompt_id = None
        self.waiting = None          # None or {"agent": agent_id or None, "tool": name}
        self.pending = {}            # tool_use_id -> tool_name, seen in PreToolUse
        self.finished = set()        # tool_use_ids with PostToolUse / Failure / Denied
        self.subagents = set()       # agent_ids announced by SubagentStart


class Normalizer:
    """Stateful translator: one instance per running app, state is kept per session."""

    def __init__(self):
        self.sessions = {}
        # Names only: (event, sorted field names) -> count, and unknown tools/events.
        self.shapes = {}
        self.unknown_events = {}
        self.unknown_tools = {}

    def process(self, payload, ts):
        """Return the list of game events produced by one raw payload."""
        if not isinstance(payload, dict):
            return [self._unknown(ts, None, "_invalid")]
        name = payload.get("hook_event_name")
        if not isinstance(name, str):
            return [self._unknown(ts, None, "_invalid")]
        shape = (name, tuple(sorted(payload)))
        self.shapes[shape] = self.shapes.get(shape, 0) + 1

        session_id = payload.get("session_id")
        if not isinstance(session_id, str) or not session_id:
            return [self._unknown(ts, None, name)]

        out = []
        session = self.sessions.get(session_id)
        if session is None:
            session = _Session(_project_name(payload.get("cwd")))
            self.sessions[session_id] = session
            joined = not (name == "SessionStart" and payload.get("source") != "compact")
            out.append(self._event(ts, session_id, session, "session_start",
                                   joined=joined, source=payload.get("source")))
            if not joined:
                return out

        agent = payload.get("agent_id") or None
        # A background task notification is a UserPromptSubmit with the old prompt_id;
        # it says nothing about the user, so it must not end a pause.
        notification = name == "UserPromptSubmit" \
            and payload.get("prompt_id") == session.prompt_id
        # Notification(permission_prompt) arrives during the wait itself, so ignored
        # events never end a pause either.
        if session.waiting is not None and name != "PermissionRequest" \
                and name not in IGNORED_EVENTS and not notification \
                and agent == session.waiting["agent"]:
            if name == "UserPromptSubmit" and agent is None:
                # A prompt while a permission request is unanswered means "No" or Esc.
                out.append(self._event(ts, session_id, session, "blocked",
                                       tool=session.waiting["tool"], reason="rejected",
                                       agent=agent))
            out.append(self._event(ts, session_id, session, "resumed", agent=agent))
            session.waiting = None

        handler = getattr(self, "_on_" + name, None)
        if handler is not None:
            out.extend(handler(ts, session_id, session, payload, agent))
        elif name not in IGNORED_EVENTS:
            out.append(self._unknown(ts, session_id, name, session))
        return out

    # --- per-event handlers -------------------------------------------------------

    def _on_SessionStart(self, ts, sid, session, payload, agent):
        # A second SessionStart with source "compact" is the end of compaction, which
        # PostCompact reports; a startup / resume of a known session changes nothing.
        return []

    def _on_SessionEnd(self, ts, sid, session, payload, agent):
        del self.sessions[sid]
        return [self._event(ts, sid, session, "session_end", reason=payload.get("reason"))]

    def _on_UserPromptSubmit(self, ts, sid, session, payload, agent):
        prompt_id = payload.get("prompt_id")
        # Background task notifications arrive as a prompt with the same prompt_id.
        if prompt_id is not None and prompt_id == session.prompt_id:
            return []
        session.prompt_id = prompt_id
        # Tools that started but never finished were interrupted with Esc.
        session.pending.clear()
        session.finished.clear()
        return [self._event(ts, sid, session, "prompt")]

    def _on_PreToolUse(self, ts, sid, session, payload, agent):
        tool_use_id = payload.get("tool_use_id")
        if tool_use_id:
            session.pending[tool_use_id] = payload.get("tool_name")
        return []

    def _on_PermissionRequest(self, ts, sid, session, payload, agent):
        tool = payload.get("tool_name")
        session.waiting = {"agent": agent, "tool": tool}
        return [self._event(ts, sid, session, "waiting", tool=tool, agent=agent)]

    def _on_PermissionDenied(self, ts, sid, session, payload, agent):
        self._finish(session, payload.get("tool_use_id"))
        return [self._event(ts, sid, session, "blocked", tool=payload.get("tool_name"),
                            reason="denied", agent=agent)]

    def _on_PostToolUse(self, ts, sid, session, payload, agent):
        self._finish(session, payload.get("tool_use_id"))
        tool = payload.get("tool_name")
        event = self._tool_fields(session, tool, payload)
        event.update(ok=True, duration_ms=payload.get("duration_ms"), agent=agent)
        lines = _changed_lines(tool, payload.get("tool_response"), payload.get("tool_input"))
        if lines is not None:
            event["lines_added"], event["lines_removed"] = lines
        return [self._event(ts, sid, session, "tool", **event)]

    def _on_PostToolUseFailure(self, ts, sid, session, payload, agent):
        self._finish(session, payload.get("tool_use_id"))
        tool = payload.get("tool_name")
        event = self._tool_fields(session, tool, payload)
        event.update(ok=False, exit_code=_parse_exit_code(payload.get("error")),
                     interrupted=bool(payload.get("is_interrupt")),
                     duration_ms=payload.get("duration_ms"), agent=agent)
        return [self._event(ts, sid, session, "tool_error", **event)]

    def _on_PostToolBatch(self, ts, sid, session, payload, agent):
        # A call that is in the batch but never got PostToolUse / Failure was blocked
        # (permissions.deny or Claude Code itself), see docs/events.md.
        out = []
        for call in payload.get("tool_calls") or []:
            if not isinstance(call, dict):
                continue
            tool_use_id = call.get("tool_use_id")
            if tool_use_id in session.finished:
                session.finished.discard(tool_use_id)
            else:
                out.append(self._event(ts, sid, session, "blocked",
                                       tool=call.get("tool_name"), reason="rule",
                                       agent=agent))
            session.pending.pop(tool_use_id, None)
        return out

    def _on_Stop(self, ts, sid, session, payload, agent):
        background = sum(1 for task in payload.get("background_tasks") or []
                         if isinstance(task, dict) and task.get("status") == "running")
        return [self._event(ts, sid, session, "stop", ok=True, background=background,
                            final=background == 0)]

    def _on_StopFailure(self, ts, sid, session, payload, agent):
        return [self._event(ts, sid, session, "stop", ok=False, background=0, final=True)]

    def _on_SubagentStart(self, ts, sid, session, payload, agent):
        if not payload.get("agent_type"):
            return []
        session.subagents.add(agent)
        return [self._event(ts, sid, session, "subagent_start", agent=agent,
                            agent_type=payload.get("agent_type"))]

    def _on_SubagentStop(self, ts, sid, session, payload, agent):
        # Compaction runs a hidden agent with an empty type and no SubagentStart.
        if agent not in session.subagents:
            return []
        session.subagents.discard(agent)
        return [self._event(ts, sid, session, "subagent_stop", agent=agent,
                            agent_type=payload.get("agent_type"))]

    def _on_PreCompact(self, ts, sid, session, payload, agent):
        return [self._event(ts, sid, session, "compact", phase="start",
                            trigger=payload.get("trigger"))]

    def _on_PostCompact(self, ts, sid, session, payload, agent):
        return [self._event(ts, sid, session, "compact", phase="end",
                            trigger=payload.get("trigger"))]

    def _on_TaskCreated(self, ts, sid, session, payload, agent):
        # Never observed in 2.1.286 (no task tool); kept so a future version just works.
        return [self._event(ts, sid, session, "todo", change="created")]

    def _on_TaskCompleted(self, ts, sid, session, payload, agent):
        return [self._event(ts, sid, session, "todo", change="completed")]

    # --- helpers ------------------------------------------------------------------

    def _finish(self, session, tool_use_id):
        if tool_use_id:
            session.pending.pop(tool_use_id, None)
            session.finished.add(tool_use_id)

    def _tool_fields(self, session, tool, payload):
        if not isinstance(tool, str):
            tool = "?"
        action = TOOL_ACTIONS.get(tool, "generic")
        if tool not in KNOWN_TOOLS:
            self.unknown_tools[tool] = self.unknown_tools.get(tool, 0) + 1
        fields = {"tool": tool, "action": action}
        tool_input = payload.get("tool_input")
        if not isinstance(tool_input, dict):
            tool_input = {}
        if tool == "Bash":
            fields["category"] = bash_category(tool_input.get("command"))
            if fields["category"] == "search":
                fields["action"] = "scout"  # games treat it like Read
        if tool in FILE_TOOLS:
            path = tool_input.get("file_path") or tool_input.get("notebook_path")
            fields["file"] = _relative_file(path, payload.get("cwd"))
        return fields

    def _event(self, ts, sid, session, kind, **fields):
        event = {"ts": ts, "session": sid, "project": session.project, "kind": kind}
        event.update(fields)
        return event

    def _unknown(self, ts, sid, name, session=None):
        self.unknown_events[name] = self.unknown_events.get(name, 0) + 1
        return {"ts": ts, "session": sid,
                "project": session.project if session else None,
                "kind": "unknown", "event": name}


def _project_name(cwd):
    if not isinstance(cwd, str) or not cwd:
        return None
    return os.path.basename(os.path.normpath(cwd))


def _relative_file(path, cwd):
    if not isinstance(path, str) or not path:
        return None
    if isinstance(cwd, str) and cwd:
        try:
            rel = os.path.relpath(path, cwd)
        except ValueError:
            rel = None
        if rel and not rel.startswith(".."):
            return rel
    return os.path.basename(path)


def _changed_lines(tool, response, tool_input):
    if tool not in {"Edit", "MultiEdit", "Write", "NotebookEdit"}:
        return None
    if not isinstance(response, dict):
        return None
    patch = response.get("structuredPatch")
    if patch:
        return _count_patch(patch)
    if tool == "Write" and isinstance(tool_input, dict):
        return _line_count(tool_input.get("content")), 0
    return None
