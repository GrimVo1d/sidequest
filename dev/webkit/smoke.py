"""A quick look at one DLC in a real window: menu, handbook, a match with an agent at work,
the pause and the results. Snapshots go to <out>; the JSON says what the HUD shows, which
HUD elements overlap or leave the window, and the page's JS errors.

    .venv/bin/python dev/webkit/smoke.py arena <out> [ru|en] [--no-dev]
"""
import sys

from webkit import run

DLCS = {
    "arena": {"name": "Last Commit Standing", "hud": ["top", "xp", "allies", "panel", "notice", "tip"]},
}
AGENT = "aaaa1111-0000-0000-0000-000000000001"
FILES = ["src/auth.py", "src/db.py", "tests/test_auth.py", "README.md", "docs/api.md"]


def drive(c, dlc):
    out = {}
    c.open_dlc(dlc["name"])
    c.snapshot("1-menu")
    c.frame("d.getElementById('btn-codex').click()")
    c.wait(0.5)
    c.snapshot("2-codex")
    c.frame("d.getElementById('btn-codex-back').click()")
    # The mode with a live agent, where a DLC has a choice of modes.
    c.frame("(() => { const b = [...d.querySelectorAll('.mode')].find((x) => /агент|agent/i.test(x.textContent)); "
            "if (b) b.click(); return 1; })()")
    c.frame("d.getElementById('btn-play').click()")
    c.wait(2)
    c.send(AGENT, "session_start", joined=False)
    c.send(AGENT, "prompt")
    for f in FILES:
        c.send(AGENT, "tool", tool="Read", action="scout", ok=True, file=f)
        c.send(AGENT, "tool", tool="Edit", action="attack", ok=True, file=f, lines_added=20)
        c.wait(0.3)
    for category in ("other", "git", "test"):
        c.send(AGENT, "tool", tool="Bash", action="cast", category=category, ok=True)
    c.wait(4)
    # The arena may stop on a level-up choice: take the first one until it goes.
    for _ in range(10):
        if c.frame("!d.getElementById('levelup') || d.getElementById('levelup').hidden"):
            break
        c.key("Digit1")
        c.wait(0.2)
    c.snapshot("3-match")
    out["hud"] = c.frame("d.getElementById('top').textContent.replace(/\\s+/g, ' ').trim()")
    out["notice"] = c.frame("d.getElementById('notice').textContent")
    out["overlaps"] = c.overlaps(dlc["hud"])
    out["rects"] = c.rects(dlc["hud"])
    c.frame("w.focus()")
    c.key("Escape")
    c.wait(0.4)
    c.snapshot("4-pause")
    # A tip from the match must not show through the pause: "none" or hidden is right.
    out["tip_in_pause"] = c.frame("getComputedStyle(d.getElementById('tip')).display")
    c.frame("d.getElementById('btn-quit').click()")
    c.wait(1)
    c.snapshot("5-results")
    out["results"] = c.frame("d.getElementById('results-title').textContent")
    c.frame("d.getElementById('btn-again').click()")
    c.wait(1)
    out["errors"] = c.errors()
    return out


if __name__ == "__main__":
    if len(sys.argv) < 3 or sys.argv[1] not in DLCS:
        sys.exit(__doc__)
    which = DLCS[sys.argv[1]]
    run(lambda c: drive(c, which), sys.argv[2:])
