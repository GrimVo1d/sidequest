# Sidequest

A pixel-art game for macOS and Linux that you play while Claude Code works. It is an arena
survival in the spirit of Vampire Survivors, and the ally at your side is your agent: its
edits, commands, failing tests and commits arrive through Claude Code hooks and turn into
shots, waves, bosses and chests.

![A match: the player and the agent's robot ally fighting waves of bugs](landing/assets/shots/arena-en.png)

The game is in Russian and English and works fully offline.

## How it works

Claude Code runs `hooks/sidequest-emit.sh` on each hook event. The script forwards the event
to a local Unix socket that exists only while the game window is open. On the way in, the
normalizer keeps only what kind of action happened and drops everything else. Then the game
turns the event into a mechanic:

| The agent | In the game |
|---|---|
| Edits or writes a file | the ally fires a missile at the nearest bug |
| Reads or searches | a scan lights up enemies and slows them down |
| Runs a build | a turret next to the ally for 20 seconds |
| Starts a subagent | a spirit: Explore slows bugs, Plan heals you |
| Tests fail | "Red CI": bugs come faster and more often for 15 seconds; passing tests end it and give a shield |
| Commits / pushes | a commit bomb around the ally / a chest with gear |
| Asks you something | the game pauses and shows which project is waiting |
| Finishes the task | the ally casts its ultimate and the match ends |

There are 8 weapons with evolutions, 6 classes with their own ability, 9 maps and 5 modes:
with your live agents, alone, a five-stage campaign, against a ghost of a past session,
and the task of the day.

## Privacy and safety

- **It only watches.** The hook never returns a decision, never blocks, and always exits
  with code 0 without printing anything, so it adds nothing to the model's context.
  If the game hangs, the hook gives up after a second.
- **Your code stays out of it.** File contents, edit text, commands, prompts, tool output
  and the transcript are dropped by the normalizer before anything is stored or shown.
- **No network.** No ports, no HTTP, no requests to the internet. Every dependency and
  font is in the project.
- **Nothing runs in the background.** No daemons, no autostart. Close the window and the
  hooks quietly do nothing.
- **Settings are changed only on request.** `~/.claude/settings.json` is touched only by
  the `install` and `uninstall` commands (or the same buttons in the game). They show the
  change and ask first, keep a backup in `data/backups/`, and touch only Sidequest's own
  entries.
- Everything else the game writes stays in `data/` inside the project folder.

The whole hook is [28 lines of shell](hooks/sidequest-emit.sh). The events and fields it
relies on are described in [docs/events.md](docs/events.md).

## Install

You need Python 3.12 or newer, git and Claude Code.

**macOS.** The `python3` that ships with macOS is too old: get a newer one from python.org
or with `brew install python`.

```sh
git clone https://github.com/GrimVo1d/sidequest.git && cd sidequest
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m sidequest install   # connect the hooks to Claude Code
.venv/bin/python -m sidequest           # open the game
```

**Linux** (checked on Debian 13; elsewhere the same packages go by their own names). The
window is WebKitGTK from the system, so the environment is made with `--system-site-packages`
to see it, and the hook needs an `nc` that speaks to Unix sockets:

```sh
sudo apt install python3-venv python3-gi gir1.2-webkit2-4.1 netcat-openbsd
git clone https://github.com/GrimVo1d/sidequest.git && cd sidequest
python3 -m venv --system-site-packages .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m sidequest install
.venv/bin/python -m sidequest
```

Restart any open Claude Code sessions so they pick up the hooks, then work as usual.
The game's "Claude Code" screen has a self-check that shows whether the hooks are in place
and events get through.

To disconnect: `.venv/bin/python -m sidequest uninstall`. It removes only Sidequest's
entries and also keeps a backup.

Other commands: `check` (the self-check in the terminal), `sessions` (recent sessions).

## Development

```sh
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m sidequest --dev     # the window with the developer panel
python3 -m unittest                     # all tests; pywebview is not needed
.venv/bin/ruff format . && .venv/bin/ruff check . && .venv/bin/mypy
```

- `sidequest/` is the Python core: the window, the socket receiver, the normalizer,
  the database (sqlite) and the self-check.
- `game/` is the window's page: the arena on Canvas 2D, the menu and the screens.
  Balance numbers live in `game/balance.json`.
- `dev/scenarios/` holds hand-written agent sessions for replay mode, so the game can be
  developed without a running agent. `dev/webkit/` has checks that drive a real WebKit
  window.
- `landing/` is the project's static site.
- The code style is in [docs/style.md](docs/style.md).

JavaScript that does not need the DOM (the arena simulation, avatars, GIF parsing) is
tested with the `jsc` that comes with macOS, so Node is not needed.

## Status

Version 1.1. Sidequest is an independent project and is not affiliated with Anthropic;
Claude Code is a product of Anthropic.

There is no license yet: the code is public to read, and all rights are reserved.
