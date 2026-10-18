"""The code style rules of docs/style.md that a tool can check without Node.

Python is checked by ruff and mypy (pyproject.toml); this file covers JavaScript and the size
budget of every source file.
"""

import glob
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

JS_GLOBS = ["game/*.js", "landing/*.js"]
PY_GLOBS = ["sidequest/*.py", "tests/*.py", "dev/webkit/*.py", "landing/*.py"]

MAX_LINES = 1000
# Files written before the size budget, with the size they may not grow past. Shrink the
# number when a file gets smaller; remove the entry once the file is under MAX_LINES.
LEGACY_SIZE = {
    "game/game.js": 2001,
    "game/render.js": 1092,
}

FORBIDDEN_SINKS = re.compile(
    r"\.innerHTML\b|\.outerHTML\b|\binsertAdjacentHTML\b|\bdocument\.write\b"
    r"|\beval\s*\(|\bnew\s+Function\b"
)


def files(patterns):
    out = []
    for pattern in patterns:
        out += sorted(glob.glob(os.path.join(ROOT, pattern)))
    return [os.path.relpath(p, ROOT) for p in out]


def code_only(source):
    """The source with comments, strings, template literals and regex literals blanked.

    A small scanner, enough for this code base: it keeps line breaks so line numbers stay.
    """
    out = []
    i, n = 0, len(source)
    prev = ""  # the last significant character, to tell a regex from a division
    while i < n:
        ch = source[i]
        nxt = source[i + 1] if i + 1 < n else ""
        if ch == "/" and nxt == "/":
            while i < n and source[i] != "\n":
                i += 1
            continue
        if ch == "/" and nxt == "*":
            end = source.find("*/", i + 2)
            end = n if end < 0 else end + 2
            out.append(re.sub(r"[^\n]", " ", source[i:end]))
            i = end
            continue
        regex_start = ch == "/" and (prev == "" or prev in "(,=:[!&|?{};+-*%<>~^")
        if ch in "\"'`" or regex_start:
            quote = ch
            j = i + 1
            in_class = False
            while j < n:
                c = source[j]
                if c == "\\":
                    j += 2
                    continue
                if quote == "/" and c == "[":
                    in_class = True
                elif quote == "/" and c == "]":
                    in_class = False
                elif (c == quote and not in_class) or (c == "\n" and quote != "`"):
                    break
                j += 1
            out.append(quote + re.sub(r"[^\n]", " ", source[i + 1 : j]) + quote)
            i = j + 1
            prev = "a"
            continue
        out.append(ch)
        if not ch.isspace():
            prev = ch
        i += 1
    return "".join(out)


def read(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as f:
        return f.read()


def where(path, code, pattern):
    return [
        f"{path}:{number}: {line.strip()}"
        for number, line in enumerate(code.split("\n"), 1)
        if re.search(pattern, line)
    ]


class JavaScriptStyle(unittest.TestCase):
    def setUp(self):
        self.js = files(JS_GLOBS)
        self.assertGreater(len(self.js), 15)

    def test_header_comment_and_strict_mode(self):
        bad = []
        for path in self.js:
            source = read(path)
            if not source.startswith("//") and not source.startswith("/*"):
                bad.append(f"{path}: no header comment")
            if '"use strict";' not in source:
                bad.append(f'{path}: no "use strict";')
        self.assertEqual(bad, [])

    def test_no_var(self):
        bad = []
        for path in self.js:
            bad += where(path, code_only(read(path)), r"\bvar\s")
        self.assertEqual(bad, [])

    def test_strict_equality_only(self):
        bad = []
        for path in self.js:
            bad += where(path, code_only(read(path)), r"(?<![=!<>])[=!]=(?!=)")
        self.assertEqual(bad, [])

    def test_no_html_sinks_or_eval(self):
        bad = []
        for path in self.js:
            bad += where(path, code_only(read(path)), FORBIDDEN_SINKS.pattern)
        self.assertEqual(bad, [])

    def test_scanner_blanks_strings_comments_and_regexes(self):
        code = code_only('const a = "x == y"; // b == c\nconst r = /[/]==/.test(s) || a === b;\n')
        self.assertNotRegex(code, r"(?<![=!<>])==(?!=)")
        self.assertIn("a === b", code)
        self.assertEqual(code.count("\n"), 2)


class SizeBudget(unittest.TestCase):
    def test_files_stay_within_budget(self):
        bad = []
        for path in files(JS_GLOBS + PY_GLOBS):
            lines = read(path).count("\n")
            limit = LEGACY_SIZE.get(path, MAX_LINES)
            if lines > limit:
                bad.append(f"{path}: {lines} lines, budget {limit}")
        self.assertEqual(bad, [])

    def test_legacy_entries_are_still_needed(self):
        for path, limit in LEGACY_SIZE.items():
            lines = read(path).count("\n")
            self.assertGreater(lines, MAX_LINES, f"{path} fits now: remove it from LEGACY_SIZE")
            self.assertLessEqual(lines, limit)


if __name__ == "__main__":
    unittest.main()
