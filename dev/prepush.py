"""Checks the commits that are not on GitHub yet, before a push: the repository is public.

    .venv/bin/python dev/prepush.py [<base>]     # <base> is origin/main by default

Both public branches are checked: main (the game) against <base>, and gh-pages (the landing
page, the worktree in landing/) against origin/gh-pages. In their new commits it looks for:
- the home folder's path and the user name in added lines;
- keys and tokens (Anthropic, OpenAI, GitHub, AWS, private keys);
- an author or committer e-mail that is not GitHub's noreply one;
- files that stay local (data/, dev/recordings/, .tmp/, landing/, .claude/, .github/, PLAN.md,
  CLAUDE.md, CLAUDE.local.md, databases, sockets, bundles) and files over 1 MB;
- the names of the user's own projects, taken from Sidequest's local database (opened
  read-only). A name is never printed: a hit shows as "project #n".
Then it runs the tests, when main has new commits. Exits with 1 when anything is found. It
never pushes.
"""

import fnmatch
import getpass
import os
import re
import sqlite3
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from sidequest import paths  # noqa: E402  (the project root is added above)

LOCAL_FILES = [
    "data/*",
    "dev/recordings/*",
    ".tmp/*",
    "landing/*",
    ".claude/*",
    ".github/*",
    "PLAN.md",
    "CLAUDE.md",
    "CLAUDE.local.md",
    "*.db",
    "*.sqlite",
    "*.sock",
    "*.bundle",
]
# The public branches, each with what GitHub already has of it.
BRANCHES = {"main": "origin/main", "gh-pages": "origin/gh-pages"}
MAX_FILE_BYTES = 1024 * 1024
SECRETS = re.compile(
    r"sk-ant-[\w-]{10,}|sk-[A-Za-z0-9]{32,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_\w{20,}"
    r"|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----"
)
NOREPLY = "@users.noreply.github.com"
SHORTEST_NAME = 4  # shorter project names ("app", "api") would match ordinary words


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout


def in_tree(tree: str, text: str) -> bool:
    found = subprocess.run(
        ["git", "grep", "-q", "-i", "-I", "-F", "-e", text, tree, "--"],
        cwd=ROOT,
        capture_output=True,
    )
    return found.returncode == 0


def exists(ref: str) -> bool:
    try:
        git("rev-parse", "--verify", "--quiet", ref + "^{commit}")
    except subprocess.CalledProcessError:
        return False
    return True


def texts(span: str) -> list[tuple[str, str, str]]:
    """(commit, where, text) for everything the commits make public: every added line (where
    is its file), every commit message and every file name."""
    out, commit, path = [], "", ""
    for line in git("log", "-p", "--no-color", "--format=commit %h", span).splitlines():
        if line.startswith("commit "):
            commit = line[7:]
        elif line.startswith("+++ "):
            path = line[6:] if line.startswith("+++ b/") else ""
        elif line.startswith("+") and path:
            out.append((commit, path, line[1:]))
    for entry in git("log", "--format=%x00%h%x01%B", span).split("\0")[1:]:
        commit, message = entry.split("\x01", 1)
        out.append((commit, "the commit message", message))
    for entry in git("log", "--name-only", "--format=%x00%h", span).split("\0")[1:]:
        commit, *names = entry.split("\n")
        out += [(commit, "a file name", name) for name in names if name]
    return out


def project_names() -> list[str]:
    """The user's project names from the local database, or [] when there is none."""
    if not os.path.exists(paths.DB_PATH):
        return []
    db = sqlite3.connect(f"file:{paths.DB_PATH}?mode=ro", uri=True)
    try:
        rows = db.execute("SELECT DISTINCT project FROM sessions").fetchall()
    finally:
        db.close()
    names = {r[0].strip() for r in rows if isinstance(r[0], str)}
    return sorted(n for n in names if len(n) >= SHORTEST_NAME and n.lower() != "sidequest")


def check_privacy(base: str | None, span: str, tip: str) -> list[str]:
    problems = []
    lines = texts(span)
    home, user = os.path.expanduser("~"), getpass.getuser()
    who = re.compile(rf"(?<![A-Za-z0-9]){re.escape(user)}(?![A-Za-z0-9])", re.IGNORECASE)
    for commit, path, text in lines:
        if home in text:
            problems.append(f"{commit} {path}: the home folder's path")
        elif who.search(text):
            problems.append(f"{commit} {path}: the user name")
        if SECRETS.search(text):
            problems.append(f"{commit} {path}: looks like a key or a token")

    hidden = []  # (pattern, label): a project name is never printed, even inside a path
    for number, name in enumerate(project_names(), 1):
        pattern = re.compile(rf"(?<![A-Za-z0-9]){re.escape(name)}(?![A-Za-z0-9])", re.IGNORECASE)
        hidden.append((pattern, f"<project #{number}>"))
        if base and in_tree(base, name):
            continue  # already public before these commits, e.g. a sample name
        hits = sorted({f"{c} {p}" for c, p, text in lines if pattern.search(text)})
        problems += [f"{hit}: project #{number}" for hit in hits]

    people = git("log", "--format=%h %ae %ce", span).splitlines()
    for line in people:
        commit, *emails = line.split()
        if any(not e.endswith(NOREPLY) for e in emails):
            problems.append(f"{commit}: an e-mail that is not GitHub's noreply one")

    for path in git("log", "--name-only", "--format=", span).splitlines():
        if path and any(fnmatch.fnmatch(path, p) for p in LOCAL_FILES):
            problems.append(f"{path}: a file that stays local")
    changed_files = set(git("diff", "--name-only", base, tip).splitlines()) if base else set()
    for line in git("ls-tree", "-r", "-l", tip).splitlines():
        meta, path = line.split("\t", 1)
        size = meta.split()[3]
        changed = base is None or path in changed_files
        if changed and size.isdigit() and int(size) > MAX_FILE_BYTES:
            problems.append(f"{path}: {int(size) // 1024} KB")
    for pattern, label in hidden:
        problems = [pattern.sub(label, p) for p in problems]
    return sorted(set(problems))


def run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run([sys.executable, *args], cwd=ROOT, capture_output=True, text=True)


def check_build() -> list[str]:
    problems = []
    tests = run("-m", "unittest", "-q")
    if tests.returncode:
        tail = tests.stderr.strip().splitlines()[-1:] or ["?"]
        problems.append(f"the tests fail: {tail[0]}")
    return problems


def main(argv: list[str]) -> int:
    problems: list[str] = []
    checked = []
    for branch, default in BRANCHES.items():
        if not exists(branch):
            continue
        wanted = argv[1] if branch == "main" and len(argv) > 1 else default
        base = wanted if exists(wanted) else None
        span = f"{base}..{branch}" if base else branch
        commits = git("rev-list", span).split()
        if not commits:
            continue
        if base is None:
            print(f"{branch}: {wanted} not found, checking the whole history")
        print(f"{branch}: {len(commits)} commit(s) to check")
        checked.append(branch)
        problems += check_privacy(base, span, branch)
    if not checked:
        print("Nothing to push.")
        return 0
    if "main" in checked:
        problems += check_build()
    if git("status", "--porcelain").strip():
        print("note: there are uncommitted changes; they are not part of the push")
    for problem in problems:
        print("✗", problem)
    print("Found problems." if problems else "OK: ready to push.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
