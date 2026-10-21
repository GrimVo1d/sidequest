# Installing Sidequest

Step by step, on macOS and Linux. Claude Code is optional: the game plays on its own too,
see [Playing without Claude Code](#playing-without-claude-code).

## What you need

- macOS, or Linux with a desktop (checked by hand on Debian 13).
- Python 3.12 or newer.
- git, or a browser to download the code as a ZIP.
- Claude Code, if the agent is to be your ally in the game.

Nothing is installed system-wide apart from what step 1 asks for: the game and everything
it needs live in its own folder, and so does everything it writes (`data/`).

## 1. Python

**macOS.** The `python3` that comes with macOS is 3.9, too old. Get a newer one from
[python.org](https://www.python.org/downloads/macos/) or with `brew install python`, then
check in a new terminal:

```sh
python3 --version   # Python 3.12 or newer
```

**Linux.** The window is WebKitGTK from the system, and the hook needs an `nc` that speaks to
Unix sockets. On Debian and Ubuntu:

```sh
sudo apt install python3-venv python3-gi gir1.2-webkit2-4.1 netcat-openbsd
python3 --version   # Python 3.12 or newer
```

On other distributions the same packages go by their own names: Python's GObject bindings,
WebKit2GTK 4.1 and its GObject introspection data, and OpenBSD netcat.

## 2. Get the game

```sh
git clone https://github.com/GrimVo1d/sidequest.git
cd sidequest
```

Without git: on the [repository page](https://github.com/GrimVo1d/sidequest) press
**Code → Download ZIP**, unpack it and `cd` into the folder in a terminal.

Keep the folder close to the root of the disk, for example in your home folder: the path to
it becomes the path to the game's socket, and a socket path has a length limit (103
bytes). The self-check says so if the path is too long.

## 3. The environment

The game's dependencies go into `.venv` inside the folder.

**macOS:**

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

**Linux**: with `--system-site-packages`, so the environment sees WebKitGTK from step 1:

```sh
python3 -m venv --system-site-packages .venv
.venv/bin/pip install -r requirements.txt
```

## 4. Open the game

```sh
.venv/bin/python -m sidequest
```

The window opens on the menu. The language and the interface size are in the settings.

## 5. Connect Claude Code

This is the step that makes your agent the ally. It adds Sidequest's hooks to
`~/.claude/settings.json`: you see the change first and confirm it, a backup goes to
`data/backups/`, and nobody else's entries are touched.

```sh
.venv/bin/python -m sidequest install
```

Or, in the game: the **Claude Code** screen, **Connect to Claude Code**.

Then restart the Claude Code sessions that are already open, so they pick up the hooks, and
work as usual. To make sure events get through, press **Check** on the **Claude Code**
screen, or in the terminal:

```sh
.venv/bin/python -m sidequest check
```

The hooks only watch: they never block the agent and add nothing to its context. When the
game window is closed they quietly do nothing.

## Playing without Claude Code

Skip step 5. Steps 1–4 are the whole install, and nothing outside the game's folder
changes.

What you can play:

- **Classic**: alone, 20 minutes, the final boss at the end.
- **Campaign**: five maps in a row, a boss at the end of each.
- **Daily task**: the day's map and modifiers, the same all day long.

Two modes need an agent: **With an agent** (the allies are your live agents) and
**Session ghost** (the ally replays one of your past sessions; without them the list is
empty). The **Claude Code** screen will say that Sidequest is not connected; that is
expected.

If you get Claude Code later, do step 5 then; your records and progress stay.

## Updating

```sh
git pull
.venv/bin/pip install -r requirements.txt
```

If the update changed the hook, the self-check says "sidequest-emit.sh changed after it
was installed": look at the change if you like and connect again (step 5). With the ZIP,
download the new one and copy your `data/` folder into it to keep your progress.

## Removing

```sh
.venv/bin/python -m sidequest uninstall
```

It takes only Sidequest's entries out of `~/.claude/settings.json`, again with a backup, or
use **Disconnect from Claude Code** in the game. Then delete the folder: the game keeps
nothing anywhere else.

## If something goes wrong

- **`No module named 'gi'` on Linux.** The environment was made without
  `--system-site-packages`, or the packages from step 1 are missing. Install them, delete
  `.venv` and do step 3 again.
- **The Python version is too old.** `python3` is the system one: on macOS install a newer
  one (step 1) and open a new terminal; or name it in full, for example `python3.12 -m venv
  .venv`.
- **The self-check says "Sidequest is not connected to Claude Code"** after step 5: the
  hooks went into another settings file than the one Claude Code reads. If it says
  "disableAllHooks is on", Claude Code calls no hooks at all until that is removed.
- **"The entries point to another path — was the folder moved?"** Connect again from the
  new place (step 5).
- **The agent acts but nothing happens in the game.** Sessions started before step 5 do not
  have the hooks: restart them.
