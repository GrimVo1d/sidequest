// Menus without a mouse: the arrow keys move between the buttons and fields on screen, to the
// nearest one in that direction, and Enter presses the focused one. On a list or a number
// field Left and Right change the value; a text field keeps Left, Right and Enter for typing,
// Up and Down leave it. The gamepad sends the same keys. Used by the arena and the shell.
//   if (SidequestKeys.handle(event, screenElement)) return;   // in a keydown handler
//   SidequestKeys.handle(event, dialog, {rows: true})   // a form: Up and Down go row by row
//   SidequestKeys.next(from, list, [1, 0])              // the button to the right, or null
"use strict";

(function (root) {
  const DIRS = {ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0]};
  const FIELDS = "button, select, input[type=checkbox], input[type=number], input[type=text], input:not([type])";
  const VALUE = (el) => el.tagName === "SELECT" || el.type === "number";   // Left and Right change it
  const TEXT = (el) => el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && (el.type === "text" || !el.type));

  function centre(el) {
    const r = el.getBoundingClientRect();
    return {x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height};
  }

  // Buttons and fields that can be used right now: enabled and on screen (not under [hidden]).
  function targets(scope) {
    return Array.from(scope.querySelectorAll(FIELDS)).filter((b) => {
      if (b.disabled) return false;
      const c = centre(b);
      return c.w > 0 && c.h > 0;
    });
  }

  // The gap between two spans on one axis, 0 when they overlap.
  const gap = (a0, a1, b0, b1) => Math.max(0, b0 - a1, a0 - b1);

  // The nearest button in the direction, measured edge to edge and preferring ones straight
  // ahead. Left and Right stay in a narrow cone: past a row's end they go nowhere rather than
  // into the next row or the top bar.
  function next(from, list, [dx, dy]) {
    const a = from.getBoundingClientRect(), ac = centre(from);
    let best = null, bestScore = Infinity;
    for (const el of list) {
      if (el === from) continue;
      const b = el.getBoundingClientRect(), bc = centre(el);
      if ((bc.x - ac.x) * dx + (bc.y - ac.y) * dy < 4) continue;
      const along = dx ? gap(a.left, a.right, b.left, b.right) : gap(a.top, a.bottom, b.top, b.bottom);
      const across = dx ? gap(a.top, a.bottom, b.top, b.bottom) : gap(a.left, a.right, b.left, b.right);
      if (dx && across * 2 > along) continue;
      const score = along + across * 3;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    return best;
  }

  // One step of a list's choice or a number field's value, told to the page like a user's.
  function adjust(el, step) {
    if (el.tagName === "SELECT") {
      const i = Math.max(0, Math.min(el.options.length - 1, el.selectedIndex + step));
      if (i === el.selectedIndex) return;
      el.selectedIndex = i;
    } else if (step > 0) {
      el.stepUp();
    } else {
      el.stepDown();
    }
    el.dispatchEvent(new Event("input", {bubbles: true}));
    el.dispatchEvent(new Event("change", {bubbles: true}));
  }

  // In a form the fields stand in rows at different x: Up and Down go to the nearest row in
  // that direction, and in it to the closest one sideways.
  function nextRow(from, list, dy) {
    const a = centre(from);
    const ahead = list.filter((el) => el !== from && (centre(el).y - a.y) * dy >= 4);
    if (!ahead.length) return null;
    const near = Math.min(...ahead.map((el) => (centre(el).y - a.y) * dy));
    const row = ahead.filter((el) => (centre(el).y - a.y) * dy <= near + 8);
    return row.reduce((best, el) => (Math.abs(centre(el).x - a.x) < Math.abs(centre(best).x - a.x) ? el : best));
  }

  function first(scope, list) {
    return list.find((b) => b.classList.contains("primary")) || list[0];
  }

  // Returns true when the key was used for the menu.
  function handle(e, scope, options) {
    if (!scope || e.altKey || e.ctrlKey || e.metaKey) return false;
    const active = document.activeElement;
    const dir = DIRS[e.code];
    const enter = e.code === "Enter" || e.code === "NumpadEnter";
    if (!dir && !enter) return false;
    const list = targets(scope);
    const current = list.includes(active) ? active : null;
    if (active && (TEXT(active) || VALUE(active)) && (enter || !dir[1])) {
      if (!current || !dir || TEXT(active)) return false;   // typing, or a list's own Enter
      e.preventDefault();
      adjust(active, dir[0]);
      return true;
    }
    if (active && TEXT(active) && !current) return false;
    if (!list.length) return false;
    e.preventDefault();
    if (dir) {
      const rows = options && options.rows && dir[1];
      const to = !current ? first(scope, list) : rows ? nextRow(current, list, dir[1]) : next(current, list, dir);
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

  root.SidequestKeys = {handle, next};
})(typeof window !== "undefined" ? window : globalThis);
