"""A deep pass over one DLC in a real window, for QA: every handbook tab, a match with an
agent doing everything an agent can (errors, blocks, questions, subagents, git, tests,
compaction, a second agent), every DLC button of the developer panel one by one, walking in
four directions, the pause, the handbook from the pause and the results. After each step:
a snapshot, new JS errors, HUD elements that overlap or leave the window, clipped text,
screens that do not fit the window and do not scroll and, in English, Russian letters left
on screen. Text drawn on the canvas is not seen by any of these: look at the snapshots.

    .venv/bin/python dev/webkit/qa.py arena <out> [ru|en] [--size WxH] [--no-dev] [--show]

An odd size (the default is 1201x801) catches what rounds differently on half pixels.
Without the developer panel (--no-dev) the DLC buttons are skipped.
"""

import sys

from smoke import AGENT, DLCS, FILES
from webkit import run

SECOND = "bbbb2222-0000-0000-0000-000000000002"

# What is on screen in the frame: clipped boxes and, in English, Cyrillic text.
LOOK = """(() => {
  const shown = (e) => { const r = e.getBoundingClientRect(); const st = w.getComputedStyle(e);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'
      && !e.closest('[hidden]'); };
  const label = (e) => e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).split(' ')[0] : '');
  const clipped = [], russian = [], unfit = [];
  for (const e of d.body.querySelectorAll('*')) {
    if (!shown(e)) continue;
    const st = w.getComputedStyle(e);
    const cuts = st.overflowX !== 'visible' || st.overflowY !== 'visible' || st.textOverflow === 'ellipsis';
    if (cuts && st.overflowY !== 'auto' && st.overflowY !== 'scroll'
        && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)) {
      clipped.push([label(e), e.textContent.trim().slice(0, 60)]);
    }
    // A screen taller or wider than the window that does not scroll: its ends are cut off.
    if (e.classList.contains('screen') && st.overflowY !== 'auto' && st.overflowY !== 'scroll') {
      const kids = [...e.children].filter(shown).map((k) => k.getBoundingClientRect());
      if (kids.some((r) => r.top < 0 || r.bottom > w.innerHeight || r.left < 0 || r.right > w.innerWidth)) unfit.push(label(e));
    }
    for (const n of e.childNodes) {
      if (n.nodeType === 3 && /[А-Яа-яЁё]/.test(n.nodeValue)) russian.push([label(e), n.nodeValue.trim().slice(0, 60)]);
    }
  }
  return {clipped: clipped.slice(0, 20), russian: russian.slice(0, 20), unfit};
})()"""


def drive(c, dlc, lang, with_dev):
    out = {"steps": []}
    seen_errors = []

    def step(name, wait=0.6):
        c.wait(wait)
        # The arena may stop on a level-up choice: take the first card until it goes.
        for _ in range(10):
            if c.frame("!d.getElementById('levelup') || d.getElementById('levelup').hidden"):
                break
            c.key("Digit1")
            c.wait(0.2)
        c.snapshot(name)
        errors = c.errors() or []
        new = errors[len(seen_errors) :]
        seen_errors[:] = errors
        look = c.frame(LOOK) or {}
        record = {
            "step": name,
            "errors": new,
            "overlaps": c.overlaps(dlc["hud"]),
            "clipped": look.get("clipped", []),
            "unfit": look.get("unfit", []),
        }
        if lang == "en":
            record["russian"] = look.get("russian", [])
        out["steps"].append({k: v for k, v in record.items() if v or k == "step"})

    c.open_dlc(dlc["name"])
    step("01-menu")
    c.frame("d.getElementById('btn-codex').click()")
    tabs = c.frame("d.querySelectorAll('#codex-tabs button').length") or 0
    for i in range(tabs):
        c.frame(f"d.querySelectorAll('#codex-tabs button')[{i}].click()")
        step(f"02-codex-{i + 1}", 0.3)
    c.frame("d.getElementById('btn-codex-back').click()")

    c.frame(
        "(() => { const b = [...d.querySelectorAll('.mode')].find((x) => /агент|agent/i.test(x.textContent)); "
        "if (b) b.click(); return 1; })()"
    )
    c.wait(0.5)
    c.frame("d.getElementById('btn-play').click()")
    c.wait(2)
    c.send(AGENT, "session_start", joined=False)
    c.send(AGENT, "prompt")
    for f in FILES:
        c.send(AGENT, "tool", tool="Read", action="scout", ok=True, file=f)
        c.send(
            AGENT,
            "tool",
            tool="Edit",
            action="attack",
            ok=True,
            file=f,
            lines_added=20,
            lines_removed=12,
        )
        c.wait(0.2)
    for category in ("other", "build", "test"):
        c.send(AGENT, "tool", tool="Bash", action="cast", category=category, ok=True)
    c.send(AGENT, "tool", tool="Bash", action="scout", category="search", ok=True)
    c.send(AGENT, "tool", tool="Bash", action="cast", category="git", git=["commit"], ok=True)
    c.send(AGENT, "tool", tool="Bash", action="cast", category="git", git=["push"], ok=True)
    step("03-match", 3)

    # The rough parts of a session, as the developer panel sends them.
    c.send(AGENT, "tool_error", tool="Bash", action="cast", category="test", ok=False, exit_code=1)
    c.send(AGENT, "tool_error", tool="Bash", action="cast", category="other", ok=False, exit_code=1)
    c.send(AGENT, "blocked", tool="Bash", reason="rule")
    c.send(AGENT, "waiting", tool="Write")
    step("04-errors-waiting", 2)
    c.send(AGENT, "resumed")
    c.send(AGENT, "compact", phase="start")
    c.send(AGENT, "compact", phase="end")
    c.send(AGENT, "subagent_start", agent="qa-explore", agent_type="Explore")
    c.send(AGENT, "subagent_start", agent="qa-plan", agent_type="Plan")
    c.send(SECOND, "session_start", joined=False)
    c.send(SECOND, "prompt")
    for f in FILES[:3]:
        c.send(
            SECOND, "tool", tool="Edit", action="attack", ok=True, file="lib/" + f, lines_added=5
        )
    step("05-subagents-two-agents", 3)
    c.send(AGENT, "subagent_stop", agent="qa-explore")
    c.send(AGENT, "subagent_stop", agent="qa-plan")
    c.send(AGENT, "tool", tool="Unknown", action="other", ok=True)

    for code in ("ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"):
        c.hold(code, 1.2)
    step("06-walked")

    if with_dev:
        commands = (
            c.hub("typeof dlcDevCommands === 'undefined' ? [] : dlcDevCommands.map((x) => x.id)")
            or []
        )
        out["dev_commands"] = commands
        for i, cmd in enumerate(commands):
            c.dev(cmd)
            step(f"07-dev-{i + 1:02d}-{cmd}", 2)

    c.send(SECOND, "stop", ok=True, background=0, final=True)
    step("08-second-done", 2)
    c.frame("w.focus()")
    c.key("Escape")
    step("09-pause", 0.4)
    if c.frame("Boolean(d.getElementById('btn-esc-codex'))"):
        c.frame("d.getElementById('btn-esc-codex').click()")
        step("10-pause-codex", 0.4)
        c.frame("d.getElementById('btn-codex-back').click()")
        c.wait(0.3)
    c.frame("d.getElementById('btn-quit').click()")
    step("11-results", 1)
    c.frame("d.getElementById('btn-again').click()")
    step("12-menu-again", 1)
    out["problems"] = sum(1 for s in out["steps"] if len(s) > 1)
    return out


if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) < 2 or args[0] not in DLCS:
        sys.exit(__doc__)
    size = [1201, 801]
    if "--size" in args:
        i = args.index("--size")
        size = [int(v) for v in args[i + 1].split("x")]
        del args[i : i + 2]
    lang = args[2] if len(args) > 2 and args[2] in ("ru", "en") else "ru"
    which = DLCS[args[0]]
    run(
        lambda c: drive(c, which, lang, "--no-dev" not in args),
        args[1:],
        width=size[0],
        height=size[1],
    )
