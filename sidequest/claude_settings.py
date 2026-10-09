"""Install and uninstall Sidequest hooks in Claude Code's settings.json (PLAN.md 3.3).

Sidequest entries are recognised by the unique file name of the hook script, so they
are found even if the project folder was moved. Nothing else in the file is changed.
"""
import copy
import datetime
import json
import os
import shutil
import tempfile

from . import paths
from .normalizer import HOOK_EVENTS

EMIT_NAME = "sidequest-emit.sh"
HOOK_TIMEOUT = 5


class SettingsError(Exception):
    pass


def hook_entry(emit_path):
    # Exec form: Claude Code starts /bin/sh directly, the path never goes through a shell.
    return {"type": "command", "command": "/bin/sh", "args": [emit_path],
            "timeout": HOOK_TIMEOUT}


def is_sidequest_hook(hook):
    if not isinstance(hook, dict):
        return False
    parts = [hook.get("command")]
    args = hook.get("args")
    if isinstance(args, list):
        parts.extend(args)
    return any(isinstance(p, str) and p.rstrip().endswith(EMIT_NAME) for p in parts)


def hook_path(hook):
    """The script path a Sidequest entry points to."""
    args = hook.get("args")
    for part in (args if isinstance(args, list) else []) + [hook.get("command")]:
        if isinstance(part, str) and part.rstrip().endswith(EMIT_NAME):
            return part.strip()
    return None


def read_settings(path):
    """Return (settings dict, raw bytes or None if the file does not exist)."""
    try:
        with open(path, "rb") as f:
            raw = f.read()
    except FileNotFoundError:
        return {}, None
    try:
        data = json.loads(raw.decode("utf-8")) if raw.strip() else {}
    except (ValueError, UnicodeDecodeError) as e:
        raise SettingsError(f"{path} содержит невалидный JSON, ничего не меняю: {e}")
    if not isinstance(data, dict):
        raise SettingsError(f"{path}: ожидался JSON-объект, ничего не меняю")
    return data, raw


def _hooks_section(settings):
    hooks = settings.get("hooks", {})
    if not isinstance(hooks, dict):
        raise SettingsError("поле hooks в settings.json не объект, ничего не меняю")
    return hooks


def plan_install(settings, emit_path):
    """Return (new settings, changes) where changes is a list of (event, what)."""
    new = copy.deepcopy(settings)
    hooks = _hooks_section(new)
    changes = []
    for event in HOOK_EVENTS:
        groups = hooks.get(event)
        if groups is None:
            groups = []
        if not isinstance(groups, list):
            raise SettingsError(f"hooks.{event} в settings.json не массив, ничего не меняю")
        ours = [(g, h) for g in groups if isinstance(g, dict)
                for h in g.get("hooks") or [] if is_sidequest_hook(h)]
        if not ours:
            groups.append({"hooks": [hook_entry(emit_path)]})
            changes.append((event, "add"))
        else:
            first_group, first_hook = ours[0]
            if first_hook != hook_entry(emit_path):
                first_hook.clear()
                first_hook.update(hook_entry(emit_path))
                changes.append((event, "update"))
            for group, hook in ours[1:]:  # never keep duplicates
                group["hooks"].remove(hook)
                changes.append((event, "dedupe"))
            groups[:] = [g for g in groups
                         if not (isinstance(g, dict) and g.get("hooks") == [])]
        hooks[event] = groups
    new["hooks"] = hooks
    return new, changes


def plan_uninstall(settings):
    new = copy.deepcopy(settings)
    if "hooks" not in new:
        return new, []
    hooks = _hooks_section(new)
    changes = []
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


def find_entries(settings):
    """{event: [script paths]} of all Sidequest entries."""
    found = {}
    for event, groups in (settings.get("hooks") or {}).items():
        if not isinstance(groups, list):
            continue
        for group in groups:
            if isinstance(group, dict):
                for hook in group.get("hooks") or []:
                    if is_sidequest_hook(hook):
                        found.setdefault(event, []).append(hook_path(hook))
    return found


def backup(path, backup_dir):
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


def write_atomic(path, settings, expected_raw):
    """Write via a temp file + rename. Returns False if the file changed meanwhile."""
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


def apply(path, planner, confirm, attempts=3, backup_dir=None):
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
            raise SettingsError("отменено, settings.json не изменён")
        backup_path = backup(path, backup_dir) if raw is not None else None
        if write_atomic(path, new, raw):
            written, _ = read_settings(path)
            if written != new:
                raise SettingsError("после записи settings.json не совпал с ожидаемым")
            return changes, backup_path
        confirm = lambda _changes: True  # already confirmed; the file just changed
    raise SettingsError("settings.json всё время меняется во время записи, попробуйте позже")
