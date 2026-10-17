"""Install and uninstall Sidequest hooks in Claude Code's settings.json.

Sidequest entries are recognised by the unique file name of the hook script, so they
are found even if the project folder was moved. Nothing else in the file is changed.
"""

import copy
import datetime
import json
import os
import shutil
import tempfile
from collections.abc import Callable
from typing import Any, TypedDict

from . import paths
from .i18n import t
from .normalizer import HOOK_EVENTS

EMIT_NAME = "sidequest-emit.sh"
HOOK_TIMEOUT = 5

# Parsed settings.json: user data, its shape is checked where it is used.
Settings = dict[str, Any]
# (hook event, what happens to it): ("Stop", "add").
Change = tuple[str, str]
Planner = Callable[[Settings], tuple[Settings, list[Change]]]


class HookEntry(TypedDict):
    type: str
    command: str
    args: list[str]
    timeout: int


class SettingsError(Exception):
    pass


def hook_entry(emit_path: str) -> HookEntry:
    # Exec form: Claude Code starts /bin/sh directly, the path never goes through a shell.
    return {"type": "command", "command": "/bin/sh", "args": [emit_path], "timeout": HOOK_TIMEOUT}


def _script_parts(hook: dict[str, Any]) -> list[str]:
    """The strings of an entry that may be the script path: each of `args`, and a
    `command` that is only a path, maybe after `sh` (an entry written by hand).

    A command like `echo see sidequest-emit.sh` is the user's own and is not ours."""
    args = hook.get("args")
    parts = [a.strip() for a in args if isinstance(a, str)] if isinstance(args, list) else []
    command = hook.get("command")
    if isinstance(command, str):
        words = command.split()
        if words[:1] in (["sh"], ["/bin/sh"]):
            words = words[1:]
        if len(words) == 1:
            parts.append(words[0])
    return [p for p in parts if p == EMIT_NAME or p.endswith("/" + EMIT_NAME)]


def is_sidequest_hook(hook: object) -> bool:
    return isinstance(hook, dict) and bool(_script_parts(hook))


def hook_path(hook: dict[str, Any]) -> str | None:
    """The script path a Sidequest entry points to."""
    parts = _script_parts(hook)
    return parts[0] if parts else None


def _group_hooks(group: object) -> list[Any]:
    """The `hooks` array of a matcher group, or [] for a group of another shape."""
    hooks = group.get("hooks") if isinstance(group, dict) else None
    return hooks if isinstance(hooks, list) else []


def read_settings(path: str) -> tuple[Settings, bytes | None]:
    """Return (settings dict, raw bytes or None if the file does not exist)."""
    try:
        with open(path, "rb") as f:
            raw = f.read()
    except FileNotFoundError:
        return {}, None
    try:
        data = json.loads(raw.decode("utf-8")) if raw.strip() else {}
    except (ValueError, UnicodeDecodeError) as e:
        raise SettingsError(
            t(
                f"{path} содержит невалидный JSON, ничего не меняю: {e}",
                f"{path} is not valid JSON, nothing changed: {e}",
            )
        ) from e
    if not isinstance(data, dict):
        raise SettingsError(
            t(
                f"{path}: ожидался JSON-объект, ничего не меняю",
                f"{path}: a JSON object was expected, nothing changed",
            )
        )
    return data, raw


def _hooks_section(settings: Settings) -> dict[str, Any]:
    hooks = settings.get("hooks", {})
    if not isinstance(hooks, dict):
        raise SettingsError(
            t(
                "поле hooks в settings.json не объект, ничего не меняю",
                "hooks in settings.json is not an object, nothing changed",
            )
        )
    return hooks


def plan_install(settings: Settings, emit_path: str) -> tuple[Settings, list[Change]]:
    """Return (new settings, changes) where changes is a list of (event, what)."""
    new = copy.deepcopy(settings)
    hooks = _hooks_section(new)
    changes: list[Change] = []
    for event in HOOK_EVENTS:
        groups = hooks.get(event)
        if groups is None:
            groups = []
        if not isinstance(groups, list):
            raise SettingsError(
                t(
                    f"hooks.{event} в settings.json не массив, ничего не меняю",
                    f"hooks.{event} in settings.json is not an array, nothing changed",
                )
            )
        ours = [(g, h) for g in groups for h in _group_hooks(g) if is_sidequest_hook(h)]
        if not ours:
            groups.append({"hooks": [hook_entry(emit_path)]})
            changes.append((event, "add"))
        else:
            _first_group, first_hook = ours[0]
            if first_hook != hook_entry(emit_path):
                first_hook.clear()
                first_hook.update(hook_entry(emit_path))
                changes.append((event, "update"))
            for group, hook in ours[1:]:  # never keep duplicates
                group["hooks"].remove(hook)
                changes.append((event, "dedupe"))
            groups[:] = [g for g in groups if not (isinstance(g, dict) and g.get("hooks") == [])]
        hooks[event] = groups
    new["hooks"] = hooks
    return new, changes


def plan_uninstall(settings: Settings) -> tuple[Settings, list[Change]]:
    new = copy.deepcopy(settings)
    if "hooks" not in new:
        return new, []
    hooks = _hooks_section(new)
    changes: list[Change] = []
    for event in list(hooks):
        groups = hooks[event]
        if not isinstance(groups, list):
            continue
        for group in groups:
            if not isinstance(group, dict) or not isinstance(group.get("hooks"), list):
                continue
            before = len(group["hooks"])
            group["hooks"] = [h for h in group["hooks"] if not is_sidequest_hook(h)]
            if len(group["hooks"]) != before:
                changes.append((event, "remove"))
        # Drop groups and event arrays that only held Sidequest entries.
        groups[:] = [g for g in groups if not (isinstance(g, dict) and g.get("hooks") == [])]
        if not groups:
            del hooks[event]
    if not hooks:
        del new["hooks"]
    return new, changes


def find_entries(settings: Settings) -> dict[str, list[str | None]]:
    """{event: [script paths]} of all Sidequest entries."""
    found: dict[str, list[str | None]] = {}
    hooks = settings.get("hooks")
    for event, groups in hooks.items() if isinstance(hooks, dict) else ():
        for group in groups if isinstance(groups, list) else []:
            for hook in _group_hooks(group):
                if is_sidequest_hook(hook):
                    found.setdefault(event, []).append(hook_path(hook))
    return found


def backup(path: str, backup_dir: str) -> str:
    """Copy settings.json into the project's data folder (private: 700 / 600)."""
    os.makedirs(backup_dir, mode=0o700, exist_ok=True)
    os.chmod(backup_dir, 0o700)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    target = os.path.join(backup_dir, f"settings-{stamp}.json")
    n = 2
    while os.path.exists(target):  # install and uninstall within one second
        target = os.path.join(backup_dir, f"settings-{stamp}-{n}.json")
        n += 1
    # The settings may hold keys and env vars: the copy is private whatever the original.
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as out, open(path, "rb") as src:
        shutil.copyfileobj(src, out)
    return target


def write_atomic(path: str, settings: Settings, expected_raw: bytes | None) -> bool:
    """Write via a temp file + rename. Returns False if the file changed meanwhile.

    A settings.json that is a symlink (into a dotfiles repo, say) stays one: the file
    it points to is replaced, not the link."""
    path = os.path.realpath(path)
    _, current = read_settings(path)
    if current != expected_raw:
        return False
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)
    mode = os.stat(path).st_mode & 0o777 if expected_raw is not None else 0o600
    fd, tmp = tempfile.mkstemp(prefix=".settings.json.", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(settings, f, indent=2, ensure_ascii=False)
            f.write("\n")
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
    return True


def apply(
    path: str,
    planner: Planner,
    confirm: Callable[[list[Change]], bool],
    attempts: int = 3,
    backup_dir: str | None = None,
) -> tuple[list[Change], str | None]:
    """Read, plan, confirm, back up, write atomically and verify.

    `planner(settings) -> (new, changes)`; `confirm(changes) -> bool`.
    Returns (changes, backup path or None); changes is [] when nothing to do.
    Backups go to data/backups/ inside the project (or `backup_dir`).
    """
    backup_dir = backup_dir or paths.BACKUPS_DIR
    for _ in range(attempts):
        settings, raw = read_settings(path)
        new, changes = planner(settings)
        if not changes:
            return [], None
        if not confirm(changes):
            raise SettingsError(
                t("отменено, settings.json не изменён", "cancelled, settings.json not changed")
            )
        backup_path = backup(path, backup_dir) if raw is not None else None
        if write_atomic(path, new, raw):
            written, _ = read_settings(path)
            if written != new:
                raise SettingsError(
                    t(
                        "после записи settings.json не совпал с ожидаемым",
                        "settings.json differs from what was written",
                    )
                )
            return changes, backup_path

        def confirm(_changes: list[Change]) -> bool:
            return True  # already confirmed; the file just changed

    raise SettingsError(
        t(
            "settings.json всё время меняется во время записи, попробуйте позже",
            "settings.json keeps changing while being written, try again later",
        )
    )
