"""Test helpers: temp folders inside the project and stage-0 shaped payloads."""

import os
import shutil
import tempfile

from sidequest import paths

TMP_ROOT = os.path.join(paths.PROJECT_DIR, ".tmp")

SID = "11111111-2222-3333-4444-555555555555"
CWD = "/Users/someone/code/my-app"


def temp_dir(test):
    """A temp folder under <project>/.tmp/ removed after the test (or the test class,
    when called from setUpClass)."""
    os.makedirs(TMP_ROOT, mode=0o700, exist_ok=True)
    path = tempfile.mkdtemp(dir=TMP_ROOT)
    cleanup = test.addClassCleanup if isinstance(test, type) else test.addCleanup
    cleanup(shutil.rmtree, path, True)
    return path


def raw(name, sid=SID, **fields):
    """A payload with the common fields every stage-0 event had."""
    payload = {
        "session_id": sid,
        "transcript_path": f"/Users/someone/.claude/projects/x/{sid}.jsonl",
        "cwd": CWD,
        "scratchpad_dir": "/private/tmp/claude/x",
        "hook_event_name": name,
    }
    payload.update(fields)
    return payload


def pre(tool, tool_use_id, tool_input, **extra):
    return raw(
        "PreToolUse",
        tool_name=tool,
        tool_use_id=tool_use_id,
        tool_input=tool_input,
        permission_mode="default",
        prompt_id="p1",
        **extra,
    )


def post(tool, tool_use_id, tool_input, tool_response, **extra):
    return raw(
        "PostToolUse",
        tool_name=tool,
        tool_use_id=tool_use_id,
        tool_input=tool_input,
        tool_response=tool_response,
        duration_ms=12,
        permission_mode="default",
        prompt_id="p1",
        **extra,
    )


def batch(*calls, **extra):
    return raw(
        "PostToolBatch",
        prompt_id="p1",
        tool_calls=[
            {"tool_name": tool, "tool_input": {}, "tool_use_id": tid, "tool_response": "x"}
            for tool, tid in calls
        ],
        **extra,
    )
