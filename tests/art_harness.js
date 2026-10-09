// Run by tests/test_arena.py through jsc: checks the sprites and the pixel font of Last
// Commit Standing, then draws whole matches on every map into a fake canvas.
// Usage: jsc art_harness.js -- <project dir>
"use strict";
const [project] = arguments;
const DLC = project + "/dlc/last-commit-standing";

// A canvas that only checks its arguments: every number must be finite.
let calls = 0, badCall = null;
function fakeContext() {
  const target = {
    createImageData: (w, h) => ({data: new Uint8ClampedArray(w * h * 4)}),
  };
  return new Proxy(target, {
    get: (t, k) => (k in t ? t[k] : (...args) => {
      calls++;
      for (const a of args) if (typeof a === "number" && !Number.isFinite(a)) badCall = badCall || `${String(k)}(${args})`;
    }),
    set: (t, k, v) => { t[k] = v; return true; },
  });
}
function fakeCanvas() { return {style: {}, width: 0, height: 0, getContext: () => fakeContext()}; }
globalThis.document = {createElement: fakeCanvas};
globalThis.innerWidth = 1000; globalThis.innerHeight = 700; globalThis.devicePixelRatio = 2;
globalThis.addEventListener = () => {};

load(DLC + "/maps.js");
load(DLC + "/sprites.js");
load(DLC + "/font.js");
load(DLC + "/game.js");
load(DLC + "/render.js");
const balance = JSON.parse(readFile(DLC + "/balance.json"));

// --- sprites and font ---------------------------------------------------------------

const spriteErrors = [], sizes = {};
for (const [name, def] of Object.entries(LCSSprites.SPRITES)) {
  const variants = [];
  def.frames.forEach((rows, f) => {
    variants.push({frame: f});
    for (const face of Object.keys(def.faces || {})) variants.push({frame: f, face});
    rows.forEach((row, i) => {
      if (row.length !== rows[0].length) spriteErrors.push(`${name} frame ${f} row ${i}: width ${row.length}`);
      for (const c of row) if (c !== "." && !def.palette[c]) spriteErrors.push(`${name}: no color for ${c}`);
    });
    if (rows.length !== def.frames[0].length || rows[0].length !== def.frames[0][0].length) {
      spriteErrors.push(`${name} frame ${f}: size differs from frame 0`);
    }
  });
  for (const v of variants) {
    try { LCSSprites.decode(name, v); } catch (e) { spriteErrors.push(`${name}: ${e}`); }
  }
  sizes[name] = [def.frames[0][0].length, def.frames[0].length];
}

const fontErrors = [];
for (const [ch, g] of Object.entries(LCSFont.GLYPHS)) {
  const rows = g.split("|");
  if (rows.length < 5 || rows.length > LCSFont.HEIGHT) fontErrors.push(`${ch}: ${rows.length} rows`);
  if (rows.some((r) => r.length !== rows[0].length)) fontErrors.push(`${ch}: uneven rows`);
  if (rows.some((r) => /[^#.]/.test(r))) fontErrors.push(`${ch}: bad pixel`);
}
const ALPHABET = "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const missing = [...ALPHABET].filter((ch) => !LCSFont.has(ch));
// Every text the game shows on the arena: string literals in text(...) calls and the
// boss name.
const texts = [];
for (const call of readFile(DLC + "/game.js").match(/\btext\([^;]*\);/g) || []) {
  for (const m of call.match(/"[^"]*"|`[^`]*`/g) || []) {
    const value = m.slice(1, -1).replace(/\$\{[^}]*\}/g, "");
    if (!value.startsWith("#")) texts.push(value);
  }
}
texts.push(/BOSS_NAME = "([^"]+)"/.exec(readFile(DLC + "/render.js"))[1]);
const missingInTexts = [...new Set(texts.join("").toUpperCase())].filter((ch) => !LCSFont.has(ch));

// --- whole matches, drawn ----------------------------------------------------------

const ACTIONS = ["attack", "scout", "cast", "scout_far", "summon", "generic"];
function drawMatch(map, seed) {
  const g = LCS.createGame(balance, {seed, map});
  const s = g.state;
  const r = LCSRender.createRenderer(fakeCanvas(), balance);
  const avatar = {width: 16};
  const pic = fakeCanvas();
  pic.width = 136;
  pic.height = 102;
  r.preview(map, pic);
  const ev = (o) => g.agentEvent(Object.assign({session: "a", project: "sidequest"}, o));
  g.dev.immortal();
  ev({kind: "prompt"});
  g.agentEvent({kind: "prompt", session: "b", project: "второй"});
  g.dev.wave();
  g.dev.boss();
  for (let i = 0; i < 6; i++) g.dev.item();
  let error = null, frames = 0, sawItem = false, picked = 0;
  const counted = new WeakSet();
  try {
    for (let i = 0; i < 60 * 90 && !s.over; i++) {
      if (s.choices) g.choose(0);
      // Walk in circles so items get picked up.
      g.step(1 / 60, {x: Math.cos(s.time), y: Math.sin(s.time)});
      if (i < 3000 && i % 20 === 0) ev({kind: "tool", action: ACTIONS[(i / 20) % ACTIONS.length], lines_added: 5});
      if (i === 600) ev({kind: "tool_error"});
      if (i === 900) ev({kind: "blocked"});
      if (i === 1200) ev({kind: "compact", phase: "start"});
      if (i === 1500) ev({kind: "compact", phase: "end"});
      if (i === 1600) ev({kind: "subagent_start", agent: "x"});
      if (i === 2400) ev({kind: "subagent_stop", agent: "x"});
      if (i === 3000) g.dev.finale();
      if (s.items.length) sawItem = true;
      for (const fx of s.effects) {
        if (fx.type === "pickup" && !counted.has(fx)) { counted.add(fx); picked++; }
      }
      r.draw(s, avatar);
      frames++;
    }
  } catch (e) {
    error = String(e) + "\n" + e.stack;
  }
  return {error, frames, over: s.over, sawItem, picked};
}

const maps = {};
LCS_MAPS.forEach((m, i) => { maps[m.id] = drawMatch(m, 11 + i); });

print(JSON.stringify({spriteErrors, sizes, fontErrors, missing, missingInTexts, texts, maps, calls, badCall}));
