"""Checks the commits that are not on GitHub yet, before a push: the repository is public.

    .venv/bin/python dev/prepush.py [<base>]     # <base> is origin/main by default

In the commits after <base> it looks for:
- the home folder's path and the user name in added lines;
- keys and tokens (Anthropic, OpenAI, GitHub, AWS, private keys);
- an author or committer e-mail that is not GitHub's noreply one;
- files that stay local (data/, dev/recordings/, .tmp/, PLAN.md, CLAUDE.local.md, databases,
  sockets, bundles) and files over 1 MB;
- the names of the user's own projects, taken from Sidequest's local database (opened
  read-only). A name is never printed: a hit shows as "project #n".
Then it runs the tests and landing/build.py: if the build changes the landing page, the page
was not refreshed. Exits with 1 when anything is found. It never pushes.
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
    "PLAN.md",
    "CLAUDE.local.md",
    "*.db",
    "*.sqlite",
    "*.sock",
    "*.bundle",
]
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


def base_exists(base: str) -> bool:
    try:
        git("rev-parse", "--verify", "--quiet", base + "^{commit}")
    except subprocess.CalledProcessError:
        return False
    return True


def added_lines(span: str) -> list[tuple[str, str, str]]:
    """(commit, file, line) for every line the commits add."""
    out, commit, path = [], "", ""
    for line in git("log", "-p", "--no-color", "--format=commit %h", span).splitlines():
        if line.startswith("commit "):
            commit = line[7:]
        elif line.startswith("+++ "):
            path = line[6:] if line.startswith("+++ b/") else ""
        elif line.startswith("+") and path:
            out.append((commit, path, line[1:]))
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


_changed: dict[str, set[str]] = {}


def changed_files(base: str) -> set[str]:
    if base not in _changed:
        _changed[base] = set(git("diff", "--name-only", base, "HEAD").splitlines())
    return _changed[base]


def check_privacy(base: str | None, span: str) -> list[str]:
    problems = []
    lines = added_lines(span)
    home, user = os.path.expanduser("~"), getpass.getuser()
    who = re.compile(rf"(?<![\w-]){re.escape(user)}(?![\w-])", re.IGNORECASE)
    for commit, path, text in lines:
        if home in text:
            problems.append(f"{commit} {path}: the home folder's path")
        elif who.search(text):
            problems.append(f"{commit} {path}: the user name")
        if SECRETS.search(text):
            problems.append(f"{commit} {path}: looks like a key or a token")

    for number, name in enumerate(project_names(), 1):
        if base and in_tree(base, name):
            continue  # already public before these commits, e.g. a sample name
        pattern = re.compile(rf"(?<![\w-]){re.escape(name)}(?![\w-])", re.IGNORECASE)
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
    for line in git("ls-tree", "-r", "-l", "HEAD").splitlines():
        meta, path = line.split("\t", 1)
        size = meta.split()[3]
        changed = base is None or path in changed_files(base)
        if changed and size.isdigit() and int(size) > MAX_FILE_BYTES:
            problems.append(f"{path}: {int(size) // 1024} KB")
    return sorted(set(problems))


def run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run([sys.executable, *args], cwd=ROOT, capture_output=True, text=True)


def check_build() -> list[str]:
    problems = []
    tests = run("-m", "unittest", "-q")
    if tests.returncode:
        tail = tests.stderr.strip().splitlines()[-1:] or ["?"]
        problems.append(f"the tests fail: {tail[0]}")
    landing = run(os.path.join("landing", "build.py"))
    if landing.returncode:
        problems.append("landing/build.py: " + (landing.stdout + landing.stderr).strip())
    elif git("status", "--porcelain", "--", "landing").strip():
        problems.append("landing/build.py changed the page: commit the refreshed landing")
    return problems


def main(argv: list[str]) -> int:
    wanted = argv[1] if len(argv) > 1 else "origin/main"
    base = wanted if base_exists(wanted) else None
    if base is None:
        print(f"{wanted} not found: checking the whole history")
    span = f"{base}..HEAD" if base else "HEAD"
    commits = git("rev-list", span).split()
    if not commits:
        print("Nothing to push.")
        return 0
    print(f"{len(commits)} commit(s) to check")
    problems = check_privacy(base, span) + check_build()
    if git("status", "--porcelain").strip():
        print("note: there are uncommitted changes; they are not part of the push")
    for problem in problems:
        print("✗", problem)
    print("Found problems." if problems else "OK: ready to push.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
