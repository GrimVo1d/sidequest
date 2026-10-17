"""All filesystem locations used by Sidequest. Everything lives inside the project."""

import os
import re
import shutil

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(PROJECT_DIR, "data")
SOCKET_PATH = os.path.join(DATA_DIR, "sidequest.sock")
DB_PATH = os.path.join(DATA_DIR, "sidequest.db")
# The game's own saves (records, achievements, the character): one JSON file per key.
GAME_DATA_DIR = os.path.join(DATA_DIR, "game")
# Copies of ~/.claude/settings.json taken before install / uninstall.
BACKUPS_DIR = os.path.join(DATA_DIR, "backups")
EMIT_SCRIPT = os.path.join(PROJECT_DIR, "hooks", "sidequest-emit.sh")
RECORDINGS_DIR = os.path.join(PROJECT_DIR, "dev", "recordings")
GAME_DIR = os.path.join(PROJECT_DIR, "game")
GAME_PAGE = os.path.join(GAME_DIR, "index.html")
# A save key is also the name of its file in data/game/, so it is never "..".
KEY_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}\Z")

# The only file outside the project Sidequest ever touches (install / uninstall).
CLAUDE_SETTINGS = os.path.expanduser("~/.claude/settings.json")


def is_claude_settings(path: str) -> bool:
    """Whether `path` is the real settings.json, not a copy given with --settings."""
    return os.path.realpath(path) == os.path.realpath(CLAUDE_SETTINGS)


def ensure_data_dir(data_dir: str = DATA_DIR) -> None:
    """Create the data folder with 700 permissions (and fix them if it exists)."""
    os.makedirs(data_dir, mode=0o700, exist_ok=True)
    os.chmod(data_dir, 0o700)


def migrate_game_data(data_dir: str = DATA_DIR) -> None:
    """Move the saves to where the game keeps them now (once): before 0.7 the game was
    the DLC "last-commit-standing" of a hub with several games."""
    old = os.path.join(data_dir, "dlc", "last-commit-standing")
    new = os.path.join(data_dir, "game")
    # A link is left alone: moved, it would take the saves out of the project.
    if os.path.isdir(old) and not os.path.islink(old) and not os.path.lexists(new):
        os.rename(old, new)
        os.chmod(new, 0o700)


def delete_game_data(game_dir: str) -> None:
    """Delete the game's saves and, next to them, the saves of the DLCs the project had
    before 0.7. A link in their place is removed itself, never what it points to."""
    for target in (game_dir, os.path.join(os.path.dirname(game_dir), "dlc")):
        if os.path.islink(target):
            os.unlink(target)
        elif os.path.isdir(target):
            shutil.rmtree(target)
