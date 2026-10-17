"""Checks in a real WebKit window: the game, driven from Python.

The window runs on a throwaway database and game saves under .tmp/, never the real data/.
Events go straight into the core, as if the hook had sent them.

    from webkit import run

    def drive(c):                      # c: a Check
        c.open_game()
        c.page("d.getElementById('btn-play').click()"); c.wait(2)
        c.snapshot("start")
        return {"hud": c.page("d.getElementById('top').textContent")}

    run(drive)                         # argv: <out dir> [ru|en] [--no-dev] [--hidden]

`.venv/bin/python dev/webkit/<script>.py <out> ru` prints what drive returned as JSON and
saves the snapshots as <out>/<name>.png. The window is shown in front, so what it draws
can be watched; `--hidden` makes it invisible and keeps the focus away. A window that macOS
considers hidden stops its animation frames: a blank snapshot or a clock stuck at 0:00 means
the display was asleep or locked, run it again. While the window is open, `caffeinate -u` reports user activity every few seconds so an idle display
does not hide it.
"""

import contextlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)

from sidequest import app, i18n, paths  # noqa: E402
from sidequest.core import Core  # noqa: E402


class Check:
    def __init__(self, window, core, bridge, out):
        self.window, self.core, self.bridge, self.out = window, core, bridge, out

    # --- the page ------------------------------------------------------------------

    def page(self, code):
        """Evaluate a JS expression in the game page: `w` is its window, `d` its document."""
        js = f"JSON.stringify((() => {{ const w = window, d = document; return {code}; }})())"
        result = self.window.evaluate_js(js)
        return json.loads(result) if isinstance(result, str) else None

    def wait(self, seconds):
        time.sleep(seconds)

    def open_game(self):
        """Wait for the menu and start collecting the page's JS errors."""
        for _ in range(50):
            if self.page(
                "!!d.getElementById('btn-play') && !d.getElementById('btn-play').disabled"
            ):
                break
            time.sleep(0.2)
        time.sleep(1)
        self.page(
            "(w.__errors = [], w.addEventListener('error', (e) => w.__errors.push(e.message + ' :' + e.lineno)), 1)"
        )

    def errors(self):
        return self.page("w.__errors ? w.__errors.slice() : null")

    # --- input ---------------------------------------------------------------------

    def key(self, code, kind="keydown", ctrl=False, shift=False):
        """A key on what has the focus, as a real key press: the shell's overlays see it first."""
        self.page(
            f"(d.activeElement || d.body).dispatchEvent(new w.KeyboardEvent('{kind}', {{code: '{code}', "
            f"ctrlKey: {str(ctrl).lower()}, shiftKey: {str(shift).lower()}, bubbles: true}}))"
        )

    def hold(self, code, seconds):
        self.key(code, "keydown")
        time.sleep(seconds)
        self.key(code, "keyup")

    def mouse(self, kind, x, y, button=0, shift=False, target="map"):
        """A mouse event at window coordinates on the element with id `target`."""
        self.page(
            f"(d.getElementById('{target}').dispatchEvent(new w.MouseEvent('{kind}', {{clientX: {x}, "
            f"clientY: {y}, button: {button}, shiftKey: {str(shift).lower()}, bubbles: true}})), 1)"
        )

    def click(self, x, y, button=0, target="map"):
        self.mouse("mousedown", x, y, button, target=target)
        self.mouse("mouseup", x, y, button, target=target)

    def send(self, session, kind, **fields):
        """An agent event, as the hook would deliver it after the normalizer."""
        self.core.publish(
            dict({"ts": time.time(), "session": session, "project": "demo", "kind": kind}, **fields)
        )
        self.page("(w.__sidequestWake && w.__sidequestWake(), 1)")

    def dev(self, command):
        """A game command of the developer panel (only with the panel on): like its button, it
        marks the match as made with the panel, so it is not counted."""
        self.page(f"(api.dev_taint(), Sidequest.dev.run({json.dumps(command)}), 1)")

    # --- looking -------------------------------------------------------------------

    def snapshot(self, name):
        import AppKit
        from PyObjCTools import AppHelper
        from webview.platforms.cocoa import BrowserView

        view = BrowserView.instances[self.window.uid].webview
        done = threading.Event()

        def handler(image, error):
            if image is not None:
                rep = AppKit.NSBitmapImageRep.imageRepWithData_(image.TIFFRepresentation())
                rep.representationUsingType_properties_(
                    AppKit.NSBitmapImageFileTypePNG, None
                ).writeToFile_atomically_(os.path.join(self.out, name + ".png"), True)
            done.set()

        AppHelper.callAfter(
            lambda: view.takeSnapshotWithConfiguration_completionHandler_(None, handler)
        )
        done.wait(5)

    def rects(self, ids):
        """[top, bottom, left, right] of what each element shows, None for hidden or missing ones.
        A box with children is measured by them: a full-width row with its content in the
        middle covers only the middle."""
        return self.page(
            f"Object.fromEntries({json.dumps(ids)}.map((id) => {{ const e = d.getElementById(id); "
            "if (!e) return [id, null]; "
            "const shown = (r) => r.width > 0 && r.height > 0; "
            "const kids = [...e.children].map((k) => k.getBoundingClientRect()).filter(shown); "
            "const rs = kids.length ? kids : [e.getBoundingClientRect()].filter(shown); "
            "if (!rs.length) return [id, null]; "
            "return [id, [Math.round(Math.min(...rs.map((r) => r.top))), Math.round(Math.max(...rs.map((r) => r.bottom))), "
            "Math.round(Math.min(...rs.map((r) => r.left))), Math.round(Math.max(...rs.map((r) => r.right)))]]; }))"
        )

    def overlaps(self, ids):
        """Pairs of shown elements whose boxes overlap, and elements that leave the window."""
        boxes = {k: v for k, v in self.rects(ids).items() if v}
        size = self.page("[w.innerWidth, w.innerHeight]")
        out = []
        names = list(boxes)
        for i, a in enumerate(names):
            ta, ba, la, ra = boxes[a]
            if ta < 0 or la < 0 or ba > size[1] or ra > size[0]:
                out.append([a, "outside"])
            for b in names[i + 1 :]:
                tb, bb, lb, rb = boxes[b]
                if ta < bb and tb < ba and la < rb and lb < ra:
                    out.append([a, b])
        return out


def _front(window, hidden):
    """Keep the window drawing: a hidden window stops its animation frames. With `hidden` it
    stays out of the way: fully transparent, clicks pass through, no focus, no Dock icon."""
    import AppKit
    from PyObjCTools import AppHelper
    from webview.platforms.cocoa import BrowserView

    def go():
        win = BrowserView.instances[window.uid].window
        win.setLevel_(AppKit.NSFloatingWindowLevel)
        if hidden:
            AppKit.NSApp.setActivationPolicy_(AppKit.NSApplicationActivationPolicyAccessory)
            win.setAlphaValue_(0.0)
            win.setIgnoresMouseEvents_(True)
            win.orderFrontRegardless()
        else:
            win.orderFrontRegardless()
            AppKit.NSApp.activateIgnoringOtherApps_(True)
        with contextlib.suppress(Exception):
            BrowserView.instances[window.uid].webview._setWindowOcclusionDetectionEnabled_(False)

    AppHelper.callAfter(go)


def _awake(stop):
    """Report user activity until `stop` is set: an idle display hides the window."""
    while not stop.is_set():
        subprocess.run(
            ["caffeinate", "-u", "-t", "1"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        stop.wait(3)


def run(drive, argv=None, width=1200, height=800):
    """Open the game on throwaway data, call drive(Check), print its result as JSON."""
    import webview

    args = list(sys.argv[1:] if argv is None else argv)
    with_dev = "--no-dev" not in args
    hidden = "--hidden" in args
    args = [a for a in args if a not in ("--no-dev", "--hidden")]
    out = os.path.abspath(args[0] if args else os.path.join(ROOT, ".tmp", "webkit"))
    lang = args[1] if len(args) > 1 else "en"
    os.makedirs(out, exist_ok=True)
    os.makedirs(os.path.join(ROOT, ".tmp"), exist_ok=True)
    tmp = tempfile.mkdtemp(dir=os.path.join(ROOT, ".tmp"))
    result = {}
    stop = threading.Event()
    threading.Thread(target=_awake, args=(stop,), daemon=True).start()
    try:
        with mock.patch.object(paths, "GAME_DATA_DIR", os.path.join(tmp, "game")):
            core = Core(
                db_path=os.path.join(tmp, "check.db"), socket_path=os.path.join(tmp, "s.sock")
            )
            core.store.set_setting("language", lang)
            i18n.set_language(lang)
            bridge = app.Bridge(core, with_dev, os.path.join(tmp, "settings.json"))
            window = app.create_window(bridge, "check", width=width, height=height)

            def go(window):
                time.sleep(1)
                _front(window, hidden)
                time.sleep(1)
                try:
                    result.update(drive(Check(window, core, bridge, out)) or {})
                except Exception:
                    result["error"] = traceback.format_exc()
                window.destroy()

            webview.start(go, window, http_server=False, private_mode=True)
            core.store.close()
    finally:
        stop.set()
        shutil.rmtree(tmp, True)
    print(json.dumps(result, ensure_ascii=False, indent=1), flush=True)
    os._exit(0)
