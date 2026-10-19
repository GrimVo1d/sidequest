// Run by tests/test_gamepad.py through jsc: the gamepad (gamepad.js) on a made-up pad.
// Usage: jsc gamepad_harness.js -- <project dir>
"use strict";
const [project] = arguments;
load(`${project}/game/gamepad.js`);
const result = {};

// A standard pad: buttons by index, the left stick.
function padWith(buttons, axes, mapping) {
  const list = [];
  for (let i = 0; i < 17; i++) list.push({pressed: (buttons || []).includes(i), value: 0});
  return {connected: true, mapping: mapping === undefined ? "standard" : mapping, buttons: list, axes: axes || [0, 0]};
}
function rig() {
  const r = {pads: [], keys: []};
  r.pad = LCSGamepad.create({read: () => r.pads, press: (code) => r.keys.push(code)});
  return r;
}
const round = (v) => ({x: Math.round(v.x * 1000) / 1000, y: Math.round(v.y * 1000) / 1000});

{
  const r = rig();
  result.none = round(r.pad.poll(0, false));
  const broken = LCSGamepad.create({read: () => { throw new Error("no"); }, press: () => {}});
  result.broken = round(broken.poll(0, false));
  r.pads = [padWith([0], [1, 0], "")];
  result.unmapped = [round(r.pad.poll(0, false)), r.keys.length];
}
{
  const r = rig();
  r.pads = [null, padWith([], [0.2, 0.1])];
  result.dead = round(r.pad.poll(0, false));
  r.pads = [padWith([], [1, 0])];
  result.full = round(r.pad.poll(0, false));
  r.pads = [padWith([], [0, -0.625])];
  result.half = round(r.pad.poll(0, false));
  r.pads = [padWith([13, 15], [0, 0])];
  result.dpad = round(r.pad.poll(0, false));
}
{
  // Buttons press their key once, on the way down.
  const r = rig();
  for (const b of [[0], [0], [], [0, 2], [1, 3, 4, 9]]) {
    r.pads = [padWith(b)];
    r.pad.poll(0, false);
  }
  result.buttons = r.keys;
}
{
  // In a menu: a direction once, then repeats while held; nothing moves the hero.
  const r = rig();
  r.pads = [padWith([])];
  r.pad.poll(0, true);
  const moves = [];
  r.pads = [padWith([13])];
  for (const t of [100, 200, 499, 500, 649, 650, 800]) moves.push([t, round(r.pad.poll(t, true)), r.keys.length]);
  r.pads = [padWith([], [-0.9, 0.1])];
  r.pad.poll(900, true);
  result.menu = {moves, keys: r.keys};
}
{
  // A level-up opening while the hero walks: the held direction waits for a fresh push.
  const r = rig();
  r.pads = [padWith([], [1, 0])];
  r.pad.poll(0, false);
  r.pad.poll(16, true);
  r.pad.poll(2000, true);
  const held = r.keys.length;
  r.pads = [padWith([])];
  r.pad.poll(2016, true);
  r.pads = [padWith([], [1, 0])];
  r.pad.poll(2032, true);
  result.levelup = {held, after: r.keys};
}
print(JSON.stringify(result));
