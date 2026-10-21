"""Pin the hashes of every pinned dependency in requirements*.txt.

Each `name==version` line gets the sha256 of every wheel PyPI has for that release (every
platform's), so pip installs only files that were there when the version was pinned: with a
hash on every line pip turns on --require-hashes by itself. The sdist is left out, and the
files say --only-binary=:all:: building one would make pip fetch its build tools with no hash
at all, so a Python with no wheel fails instead. A line that is a wheel in vendor/
(dev/vendor_wheel.py) gets the hash of that file.
Run it after changing a version: `.venv/bin/python dev/hashes.py`. It reads PyPI, so it is
a development tool; the game itself never goes online.
"""

import hashlib
import json
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = ("requirements.txt", "requirements-dev.txt")
PIN = re.compile(r"^([A-Za-z0-9_.-]+)==([A-Za-z0-9_.!+-]+)(\s*;.*)?$")
VENDORED = re.compile(r"^\./vendor/[A-Za-z0-9_.-]+\.whl$")


def release_hashes(name: str, version: str) -> list[str]:
    url = f"https://pypi.org/pypi/{name}/{version}/json"
    with urllib.request.urlopen(url, timeout=30) as response:
        release = json.load(response)
    wheels = [f for f in release["urls"] if f["packagetype"] == "bdist_wheel"]
    hashes = sorted({f["digests"]["sha256"] for f in wheels})
    if not hashes:
        raise SystemExit(f"{name}=={version}: PyPI has no wheels, vendor one (dev/vendor_wheel.py)")
    return hashes


def file_hash(relative: str) -> str:
    with open(os.path.join(ROOT, relative), "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def with_hashes(line: str, hashes: list[str]) -> list[str]:
    return [f"{line} \\"] + [
        f"    --hash=sha256:{h}" + (" \\" if i < len(hashes) - 1 else "")
        for i, h in enumerate(hashes)
    ]


def pin(text: str) -> str:
    """The requirements text with each pin's old hashes replaced by fresh ones."""
    out: list[str] = []
    for line in re.sub(r"\s*\\\n\s*--hash=\S+", "", text).splitlines():
        match = PIN.match(line.strip())
        if match:
            name, version, marker = match.groups()
            out += with_hashes(f"{name}=={version}{marker or ''}", release_hashes(name, version))
        elif VENDORED.match(line.strip()):
            out += with_hashes(line.strip(), [file_hash(line.strip())])
        else:
            out.append(line)
    return "\n".join(out) + "\n"


def main() -> int:
    for name in FILES:
        path = os.path.join(ROOT, name)
        with open(path, encoding="utf-8") as f:
            text = f.read()
        with open(path, "w", encoding="utf-8") as f:
            f.write(pin(text))
        print(f"{name}: hashes pinned")
    return 0


if __name__ == "__main__":
    sys.exit(main())
