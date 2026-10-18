"""A quick look at the game in a real window: the menu, the Claude Code screen, the
handbook, a match with an agent at work, the pause and the results. Snapshots go to <out>;
the JSON says what the HUD shows, which HUD elements overlap or leave the window, and the
page's JS errors.

    .venv/bin/python dev/webkit/smoke.py <out> [ru|en] [--no-dev]
"""

import sys

from webkit import run

HUD = ["top", "xp", "allies", "panel", "notice", "tip"]
AGENT = "aaaa1111-0000-0000-0000-000000000001"
FILES = ["src/auth.py", "src/db.py", "tests/test_auth.py", "README.md", "docs/api.md"]


def drive(c):
    out = {}
    c.open_game()
    c.snapshot("1-menu")
    c.page("d.getElementById('btn-agent').click()")
    c.wait(0.5)
    c.snapshot("1-agent")
    c.page("d.getElementById('btn-agent-back').click()")
    c.page("d.getElementById('btn-codex').click()")
    c.wait(0.5)
    c.snapshot("2-codex")
    c.page("d.getElementById('btn-codex-back').click()")
    # The mode with a live agent.
    c.page(
        "(() => { const b = [...d.querySelectorAll('.mode')].find((x) => /агент|agent/i.test(x.textContent)); "
        "if (b) b.click(); return 1; })()"
    )
    c.page("d.getElementById('btn-play').click()")
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
        if c.page("!d.getElementById('levelup') || d.getElementById('levelup').hidden"):
            break
        c.key("Digit1")
        c.wait(0.2)
    c.snapshot("3-match")
    out["hud"] = c.page("d.getElementById('top').textContent.replace(/\\s+/g, ' ').trim()")
    out["notice"] = c.page("d.getElementById('notice').textContent")
    out["overlaps"] = c.overlaps(HUD)
    out["rects"] = c.rects(HUD)
    c.page("w.focus()")
    c.key("Escape")
    c.wait(0.4)
    c.snapshot("4-pause")
    # A tip or a notice from the match must not show through the pause: "none" is right.
    out["tip_in_pause"] = c.page("getComputedStyle(d.getElementById('tip')).display")
    out["notice_in_pause"] = c.page("getComputedStyle(d.getElementById('notice')).display")
    c.page("d.getElementById('btn-quit').click()")
    c.wait(1)
    c.snapshot("5-results")
    out["results"] = c.page("d.getElementById('results-title').textContent")
    c.page("d.getElementById('btn-again').click()")
    c.wait(1)
    out["errors"] = c.errors()
    return out


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    run(drive, sys.argv[1:])
