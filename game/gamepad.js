// A gamepad (1.0), polled once a frame through the Gamepad API. The left stick and the
// d-pad move the hero; in menus they move the focus like the arrow keys. The buttons become
// the keyboard keys the game already knows, so every screen works without changes:
//   A — Enter, B — Escape (back), X — Space (the ability), Y — R (reroll), LB — X (banish),
//   Start — Escape (pause).
// The layout is the browser's "standard" mapping (Xbox, PlayStation and most others).
//   const pad = LCSGamepad.create({read: () => navigator.getGamepads(), press: (code) => …});
//   const move = pad.poll(now, inMenu)   // {x, y} for the hero, {x: 0, y: 0} in a menu
// No DOM here: tests run it in jsc with a made-up gamepad.
"use strict";

(function (root) {
  const DEAD = 0.25;           // stick travel ignored around the centre
  const REPEAT_AFTER = 400, REPEAT_EVERY = 150;   // ms, a held direction in a menu
  const BUTTONS = {0: "Enter", 1: "Escape", 2: "Space", 3: "KeyR", 4: "KeyX", 9: "Escape"};
  const DPAD = {12: "ArrowUp", 13: "ArrowDown", 14: "ArrowLeft", 15: "ArrowRight"};

  function create({read, press}) {
    let down = new Set();      // buttons held at the last poll
    let held = null, nextAt = 0;   // the menu direction held, and when it repeats
    let wasMenu = false;

    function pad() {
      let list = [];
      try { list = Array.from(read() || []); } catch (e) { return null; }
      return list.find((g) => g && g.connected !== false && g.mapping === "standard") || null;
    }

    const pressed = (g, i) => Boolean(g.buttons[i] && (g.buttons[i].pressed || g.buttons[i].value > 0.5));

    // The stick's direction past the dead zone, scaled back to 0..1 from its edge.
    function stick(g) {
      const x = +g.axes[0] || 0, y = +g.axes[1] || 0, len = Math.hypot(x, y);
      if (len < DEAD) return {x: 0, y: 0};
      const k = Math.min(1, (len - DEAD) / (1 - DEAD)) / len;
      return {x: x * k, y: y * k};
    }

    // One arrow for the menus out of the stick and the d-pad, or null.
    function direction(g, move) {
      for (const [i, code] of Object.entries(DPAD)) if (pressed(g, i)) return code;
      if (Math.hypot(move.x, move.y) < 0.5) return null;
      return Math.abs(move.x) > Math.abs(move.y) ? (move.x > 0 ? "ArrowRight" : "ArrowLeft")
        : (move.y > 0 ? "ArrowDown" : "ArrowUp");
    }

    function poll(now, menu) {
      const g = pad();
      if (!g) {
        down = new Set();
        held = null;
        return {x: 0, y: 0};
      }
      const fresh = new Set();
      for (const i of Object.keys(BUTTONS)) {
        if (!pressed(g, i)) continue;
        fresh.add(i);
        if (!down.has(i)) press(BUTTONS[i]);
      }
      down = fresh;
      const move = stick(g);
      if (!menu) {
        held = null;
        wasMenu = false;
        for (const [i, [dx, dy]] of [[12, [0, -1]], [13, [0, 1]], [14, [-1, 0]], [15, [1, 0]]]) {
          if (pressed(g, i)) { move.x += dx; move.y += dy; }
        }
        return move;
      }
      const dir = direction(g, move);
      // A menu opening under a held direction (a level-up mid-run) waits for a fresh push.
      if (!wasMenu) {
        wasMenu = true;
        held = dir;
        nextAt = Infinity;
      }
      if (dir !== held) {
        held = dir;
        nextAt = now + REPEAT_AFTER;
        if (dir) press(dir);
      } else if (dir && now >= nextAt) {
        nextAt = now + REPEAT_EVERY;
        press(dir);
      }
      return {x: 0, y: 0};
    }

    return {poll};
  }

  root.LCSGamepad = {create};
})(typeof window !== "undefined" ? window : globalThis);
