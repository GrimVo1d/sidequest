// Menus without a mouse: the arrow keys move between the buttons on screen, to the nearest
// one in that direction, and Enter presses the focused one. Used by the arena and the shell.
//   if (SidequestKeys.handle(event, screenElement)) return;   // in a keydown handler
"use strict";

(function (root) {
  const DIRS = {ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0]};
  const TYPING = new Set(["INPUT", "TEXTAREA", "SELECT"]);

  function centre(el) {
    const r = el.getBoundingClientRect();
    return {x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height};
  }

  // Buttons that can be pressed right now: enabled and on screen (not under [hidden]).
  function targets(scope) {
    return Array.from(scope.querySelectorAll("button")).filter((b) => {
      if (b.disabled) return false;
      const c = centre(b);
      return c.w > 0 && c.h > 0;
    });
  }

  // The nearest button in the direction, preferring ones straight ahead.
  function next(from, list, [dx, dy]) {
    const a = centre(from);
    let best = null, bestScore = Infinity;
    for (const el of list) {
      if (el === from) continue;
      const b = centre(el);
      const along = (b.x - a.x) * dx + (b.y - a.y) * dy;
      if (along < 4) continue;
      const across = Math.abs((b.x - a.x) * dy + (b.y - a.y) * dx);
      const score = along + across * 3;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    return best;
  }

  function first(scope, list) {
    return list.find((b) => b.classList.contains("primary")) || list[0];
  }

  // Returns true when the key was used for the menu.
  function handle(e, scope) {
    if (!scope || e.altKey || e.ctrlKey || e.metaKey) return false;
    const active = document.activeElement;
    if (active && TYPING.has(active.tagName)) return false;
    const dir = DIRS[e.code];
    const enter = e.code === "Enter" || e.code === "NumpadEnter";
    if (!dir && !enter) return false;
    const list = targets(scope);
    if (!list.length) return false;
    const current = list.includes(active) ? active : null;
    e.preventDefault();
    if (dir) {
      const to = current ? next(current, list, dir) : first(scope, list);
      if (to) {
        to.focus();
        to.scrollIntoView({block: "nearest", inline: "nearest"});
      }
      return true;
    }
    const target = current || first(scope, list);
    const index = list.indexOf(target);
    target.click();
    // A click that redraws the buttons (a mode, a tab) keeps the focus at the same place;
    // one that closes the screen lets the focus go, so no hidden button keeps it.
    if (!document.contains(target)) {
      const again = targets(scope);
      const to = again[Math.min(index, again.length - 1)];
      if (to) to.focus();
    } else if (!centre(target).w) {
      target.blur();
    }
    return true;
  }

  root.SidequestKeys = {handle};
})(typeof window !== "undefined" ? window : globalThis);
