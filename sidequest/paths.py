"""All filesystem locations used by Sidequest. Everything lives inside the project."""
import os

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(PROJECT_DIR, "data")
SOCKET_PATH = os.path.join(DATA_DIR, "sidequest.sock")
DB_PATH = os.path.join(DATA_DIR, "sidequest.db")
DLC_DATA_DIR = os.path.join(DATA_DIR, "dlc")
# Copies of ~/.claude/settings.json taken before install / uninstall.
BACKUPS_DIR = os.path.join(DATA_DIR, "backups")
EMIT_SCRIPT = os.path.join(PROJECT_DIR, "hooks", "sidequest-emit.sh")
RECORDINGS_DIR = os.path.join(PROJECT_DIR, "dev", "recordings")

# The only file outside the project Sidequest ever touches (install / uninstall).
CLAUDE_SETTINGS = os.path.expanduser("~/.claude/settings.json")


def ensure_data_dir(data_dir=DATA_DIR):
    """Create the data folder with 700 permissions (and fix them if it exists)."""
    os.makedirs(data_dir, mode=0o700, exist_ok=True)
    os.chmod(data_dir, 0o700)
