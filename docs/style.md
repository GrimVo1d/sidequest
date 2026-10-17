# Sidequest — code style

How code in this project is written. The base is the Google style guides for
[Python](https://google.github.io/styleguide/pyguide.html) and
[JavaScript](https://google.github.io/styleguide/jsguide.html); this file lists what we take
from them, what we change for this project, and what we add. Where this file and a Google
guide disagree, this file wins.

Rules that a tool checks are marked **[ruff]**, **[mypy]** or **[test]**
(`tests/test_style.py`). The rest is checked in review (the `code-reviewer` agent and the
owner). The hard rules of `CLAUDE.md` (privacy, no network, the hook) are not repeated here
and always come first.

## 1. General

- **Readable first.** Code is read far more often than written. Prefer the plain, boring
  solution; cleverness needs a comment that explains why it is worth it.
- **One idea per unit.** A file is one module with one job, a function does one thing, a
  class owns one piece of state.
- **Size budget.** A new or rewritten file: up to ~600 lines (hard limit 1000) **[test]**. A
  function: up to ~60 lines; longer only for a flat `switch` / table or a linear script.
  Nesting deeper than 4 levels is a sign to extract a function.
- **No dead code.** No commented-out code, unused functions, parameters or imports
  **[ruff]**. Git remembers.
- **No magic numbers.** Balance numbers live in `game/balance.json`; other constants are
  named `UPPER_CASE` at the top of the module with a comment on units (px, cells, seconds).
- **Names say what, not how.** `waveTypes(count, minutes)`, not `calc2`. Units in names when
  they matter: `delaySec`, `radiusPx`, `ttlMs`. Abbreviations only when universal in the
  project (`hp`, `dt`, `cx`/`cy` for cells, `B` for the balance object).
- **Comments explain why.** What the code does should be visible from names; a comment says
  why it is done this way, which constraint it obeys, and points to `PLAN.md` (`PLAN.md
  3.4`) when a design decision is behind it. Every module starts with a header comment: what
  the module is and how it is used.
- **English** in code, identifiers and comments; player-facing text only through `t()` /
  `tr()` / `data-en` (see `CLAUDE.md`).
- **Errors are handled where something can be done about them.** Elsewhere let them
  propagate. Never swallow an exception silently unless that is the documented contract
  (the hook, the bridge, untrusted input) — and then say so in a comment.

## 2. Python

### Tools

- `ruff format` — the only formatter; line length **100** **[ruff]**.
- `ruff check` — pycodestyle, pyflakes, isort, bugbear, pyupgrade, simplify, naming, and
  the rules in `pyproject.toml` **[ruff]**.
- `mypy` — type checking. The `sidequest/` package is fully annotated and checked strictly
  (`disallow_untyped_defs`); tests and dev scripts are checked with inferred types **[mypy]**.
- Run before every commit:

  ```sh
  .venv/bin/ruff format . && .venv/bin/ruff check . && .venv/bin/mypy && python3 -m unittest
  ```

  Dev tools are in `requirements-dev.txt` (they are not needed to play). There is no CI on
  purpose (decided 2026-10-14): the checks run locally.

### Structure

- **Modules** group code by job, in layers: `paths`, `i18n` → `receiver` (socket),
  `normalizer` (raw → game event), `db` (sqlite), `avatar` → `claude_settings`,
  `selfcheck`, `replay` → `core` (wiring and pause state) → `app` (window and bridge) and
  `__main__` (command line). A module imports only from layers to its left; nothing imports
  `app` except `__main__`, lazily, so the commands work without pywebview.
- **Classes** when there is state with a lifetime: an open socket, a database connection, a
  running thread (`Receiver`, `Store`, `Core`). **Functions** for transformations without
  state (`claude_settings.plan_install`). Do not write a class that only has `__init__`
  and one method — that is a function.
- **Records** are `@dataclass(frozen=True, slots=True)` or `TypedDict` (for JSON-shaped
  dicts that cross into JS), not bare tuples or anonymous dicts passed far from where they
  are built.
- **Inheritance** only for a real "is-a" with a shared interface, one level deep. Prefer
  composition and protocols (`typing.Protocol`).
- **Private** names start with `_`. A module exports what its docstring describes; `from x
  import *` is forbidden.
- **No global mutable state** other than module-level constants. Configuration (paths,
  clocks) is passed in, which keeps tests on a temporary folder and a fake clock.

### Types

- Every function in `sidequest/` has annotated parameters and return type **[mypy]**.
- Modern syntax: `list[str]`, `X | None`, `collections.abc.Callable` **[ruff UP]**.
- `Any` only at a true boundary (parsed JSON from the socket, the pywebview bridge), and the
  value is narrowed with `isinstance` checks right there.

### Errors

- Catch the narrowest exception that can happen (`OSError`, `json.JSONDecodeError`,
  `sqlite3.Error`), never a bare `except:` **[ruff]**. `except Exception` only at a thread or
  bridge boundary, with a comment.
- `raise … from err` when translating an exception **[ruff B904]**.
- Untrusted input (socket payloads, `settings.json`, imported images) is validated, not
  trusted; invalid input is dropped and counted, never crashes the core.

### Tests

- `unittest`, one `tests/test_<module>.py` per module. Test names say the behaviour:
  `test_denied_tool_is_blocked`, not `test_case3`.
- Tests never touch the real home folder: temporary dirs via `tests.helpers.temp_dir`,
  temporary `settings.json` copies.
- A bug fix comes with a test that fails before the fix.

## 3. JavaScript

There is no bundler and no Node. Every file is a classic script loaded by `<script>` in
`game/index.html`, and by `load()` in the `jsc` harnesses. The style follows from that.

### Files and modules

- Every file starts with a header comment (what it is, its public API with a usage line per
  function) and `"use strict";` **[test]**.
- A file is an IIFE that adds to **one namespace** and creates no other globals:

  ```js
  (function (root) {
    const sim = root.CC.sim;
    sim.enemies = function createEnemies(g) { … return {updateEnemy, updateWaves}; };
  })(typeof window !== "undefined" ? window : globalThis);
  ```

  Namespaces: `Sidequest`, `SidequestI18n`, `SidequestAvatar`, `SidequestKeys` (the core's
  link and shared helpers), `LCS*` (the arena). Load order is the order of
  `<script>` tags in `index.html` and of `load()` in the harness — keep both the same.
- **Simulation without DOM.** `game.js` and everything it loads never touch `document`,
  `window` APIs, canvas or time; time arrives as `dt`, randomness from the seeded generator.
  That is what lets the bots play whole matches in `jsc`.
- **Layers of the game:** simulation (`game.js` + its systems) → `codex.js`, `progress.js`
  (data, no DOM) → `render.js` (canvas, reads state, never writes it) → `main.js` (DOM,
  input, `Sidequest`). A lower layer never calls a higher one.

### State and behaviour

- **State is plain data.** Units, enemies, buildings, shots are plain objects with data
  fields only (no methods, no closures, no class instances), so the renderer, the tests
  and the save code can read them freely.
- **Behaviour by type lives in one table**, not in `switch` statements spread over files:

  ```js
  const ENEMY_AI = {
    bug: {update(e, dt) { … }},
    spaghetti: {update(e, dt) { … }, onDeath(e) { … }},
  };
  ENEMY_AI[e.type].update(e, dt);
  ```

The numbers for each type stay in `balance.json`; the table holds only code. Adding a new
enemy means one new entry in the table, one in the balance, one sprite. Keys that come from
outside (event kinds, actions) are looked up with an own-key check (`Object.hasOwn` or a
null-prototype table), so `"constructor"` never reaches `Object`'s members.
- **Classes** (`class`) are allowed for small self-contained data structures with
  invariants (a heap, a random generator); not for entities and not with inheritance.

### Syntax

- `const` by default, `let` when reassigned, never `var` **[test]**.
- `===` and `!==` only **[test]**.
- Two-space indent, double quotes, semicolons, trailing commas in multi-line literals.
  Line length 120; long player-facing strings in data files (`codex.js`, `sprites.js`) may
  run longer.
- Arrow functions for callbacks; named `function` declarations for anything reused or
  recursive. Destructuring and default parameters are welcome; spread in hot loops is not.
- `for … of` over arrays; index loops only in hot paths (the renderer, pathfinding).
- Numbers that are pixels on screen are rounded to whole pixels at draw time; centring is
  `px(x) - (w >> 1)`, never `px(x - w / 2)` **[test]**.

### DOM

- Event data and project names go into the DOM only as text (`textContent`), never as
  HTML: `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` and
  `new Function` are forbidden **[test]**.
- Elements are looked up once and kept; per-frame DOM updates are keyed by a cache string
  and skipped when nothing changed (`keysPanel`, `selKey`).
- Player-facing text through `SidequestI18n.t` / `data-en`.

### Documentation

- Public functions of a module get a JSDoc comment when the header line is not enough:
  `@param` / `@returns` with types (`{number}`, `{{x: number, y: number}}`), and the units.
- Non-obvious state fields are documented where the state is created.

## 4. CSS and HTML

- Semantic elements (`button` for actions, `a` for navigation), every image has `alt`,
  every control is reachable from the keyboard.
- Colours and sizes as custom properties in `:root`; no raw colour values repeated across
  rules.
- Class and id names in `kebab-case`. No `!important` except for `[hidden]`.
- Shared rules go to `style.css`; `shell.css` styles only the shell around the arena.

## 5. Tests and checks

- A new mechanic comes with a `jsc` harness block that checks the mechanic itself (not
  only "it did not crash") and assertions in `tests/test_arena.py` with the numbers taken
  from the balance.
- Interface changes are checked in the real WebKit window (`dev/webkit/smoke.py`, both
  languages) before they are called done.
- A refactor does not change behaviour: the full test run and the bot matches stay the
  same before and after.

## 6. Commits and review

- One logical change per commit, conventional commit subject in English (see the global
  rules); the code is formatted and passes the checks of section 2.
- Before a commit that touches code: the `code-reviewer` agent against this file; the
  `rules-reviewer` agent when the hook, the normalizer, the database, the bridge or
  `settings.json` handling are touched.
