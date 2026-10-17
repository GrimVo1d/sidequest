// Run by tests/test_arena.py through jsc: checks the sprites and the pixel font of Last
// Commit Standing, then draws whole matches on every map into a fake canvas.
// Usage: jsc art_harness.js -- <project dir>
"use strict";
const [project] = arguments;
const GAME = project + "/game";

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

load(GAME + "/maps.js");
load(GAME + "/avatar.js");
load(GAME + "/sprites.js");
load(GAME + "/hero.js");
load(GAME + "/font.js");
load(GAME + "/game.js");
load(GAME + "/render.js");
load(GAME + "/codex.js");
const balance = JSON.parse(readFile(GAME + "/balance.json"));

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

// The hero: every choice of every slot in every frame, with and without recoil.
const heroErrors = [];
function checkHero(look, what) {
  for (const [anim, a] of Object.entries(LCSHero.ANIMS)) {
    for (let n = 0; n < a.frames; n++) {
      for (const recoil of [false, true]) {
        const f = LCSHero.frame(look, anim, n, recoil);
        if (f.rows.length !== LCSHero.H) heroErrors.push(`${what} ${anim} ${n}: ${f.rows.length} rows`);
        f.rows.forEach((row, i) => {
          if (row.length !== LCSHero.W) heroErrors.push(`${what} ${anim} ${n} row ${i}: width ${row.length}`);
          for (const c of row) if (c !== "." && !/^#[0-9a-f]{6}$/.test(f.palette[c] || "")) heroErrors.push(`${what}: no color for ${c}`);
        });
        try { LCSSprites.decodeRows(f.rows, f.palette); } catch (e) { heroErrors.push(`${what}: ${e}`); }
      }
    }
  }
}
for (const slot of LCSHero.SLOTS) {
  const table = slot.parts || SidequestAvatar.COLORS[slot.colors];
  for (const id of Object.keys(table)) checkHero({[slot.key]: id}, `${slot.key}=${id}`);
}
const heroLooks = {
  junk: LCSHero.clean({hair: "../x", top: "__proto__", skin: 5, hat: "constructor"}),
  presets: SidequestAvatar.PRESETS.map((p) => LCSHero.fromAvatar(SidequestAvatar.preset(p.id))),
  picture: LCSHero.fromAvatar({frames: [], parts: null}),
};
// What changes between frames: the walk moves the legs, recoil moves the gun and the
// muzzle, the downed hero has no gun.
const heroFrame = (anim, n, recoil) => LCSHero.frame(LCSHero.clean(null), anim, n, recoil);
const heroFacts = {
  walkFrames: new Set([0, 1, 2, 3].map((n) => heroFrame("walk", n).rows.join("|"))).size,
  recoilMoves: heroFrame("idle", 0, true).rows.join("|") !== heroFrame("idle", 0).rows.join("|"),
  muzzle: heroFrame("idle", 0).muzzle, muzzleRecoil: heroFrame("idle", 0, true).muzzle,
  downMuzzle: heroFrame("down", 0).muzzle,
};

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
for (const call of readFile(GAME + "/game.js").match(/\btext\([^;]*\);/g) || []) {
  for (const m of call.match(/"[^"]*"|`[^`]*`/g) || []) {
    const value = m.slice(1, -1).replace(/\$\{[^}]*\}/g, "");
    if (!value.startsWith("#")) texts.push(value);
  }
}
const RENDER = readFile(GAME + "/render.js");
for (const name of ["BOSS_NAME", "FINAL_NAME"]) {
  const pair = new RegExp(name + " = \\[([^\\]]+)\\]").exec(RENDER)[1];
  for (const m of pair.match(/"[^"]*"/g)) texts.push(m.slice(1, -1));
}
for (const g of balance.gear) texts.push(g.name, g.name_en);
for (const e of Object.values(balance.enemies)) if (e.name) texts.push(e.name, e.name_en);
for (const w of balance.weapons) texts.push(w.evolution.name, w.evolution.name_en);
const missingInTexts = [...new Set(texts.join("").toUpperCase())].filter((ch) => !LCSFont.has(ch));

// --- whole matches, drawn ----------------------------------------------------------

const ACTIONS = ["attack", "scout", "cast", "scout_far", "summon", "generic"];
function drawMatch(map, seed, mode) {
  const g = LCS.createGame(balance, {seed, map, mode});
  const s = g.state;
  const r = LCSRender.createRenderer(fakeCanvas(), balance);
  const look = LCSHero.clean(null);
  const pic = fakeCanvas();
  pic.width = 136;
  pic.height = 102;
  r.preview(map, pic);
  const ev = (o) => g.agentEvent(Object.assign({session: "a", project: "sidequest"}, o));
  if (mode === "classic") s.stats.magazine = 16;  // rounds as a number, not marks
  g.dev.immortal();
  // Four weapons; in classic all of them evolved.
  for (let i = 0; i < 3; i++) g.dev.weapon(balance.weapons[(seed + i) % 7 + 1].id);
  if (mode === "classic") g.dev.evolve();
  ev({kind: "prompt"});
  g.agentEvent({kind: "prompt", session: "b", project: "второй"});
  g.dev.wave();
  g.dev.boss();
  for (let i = 0; i < 6; i++) g.dev.item();
  g.dev.chest();
  for (const type of ["leak", "race", "nullptr", "deprecated"]) g.dev.enemy(type);
  for (const type of ["flaky", "spaghetti", "offbyone", "debt", "logspam", "regression", "scope", "monolith"]) {
    g.dev.enemy(type);
  }
  for (const type of balance.bosses.order) g.dev.boss(type);
  g.dev.elite("grunt", "shielded");
  g.dev.elite("runner", "fast");
  g.dev.elite("tank", "vampire");
  g.dev.event(seed % 2 ? "deploy" : "incident");
  if (mode === "classic") {
    g.dev.final();
    for (const e of s.enemies) if (e.final) e.hp = 1;
  }
  let error = null, frames = 0, sawItem = false, picked = 0, sawGem = false;
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
      if (i === 1650) ev({kind: "subagent_start", agent: "e", agent_type: "Explore"});
      if (i === 1700) ev({kind: "subagent_start", agent: "p", agent_type: "Plan"});
      if (i === 2400) ev({kind: "subagent_stop", agent: "x"});
      if (i === 700) ev({kind: "tool", tool: "Bash", action: "cast", category: "build"});
      if (i === 750) ev({kind: "tool", tool: "Bash", action: "cast", category: "git", git: ["commit", "push"]});
      if (i === 800) ev({kind: "tool_error", tool: "Bash", action: "cast", category: "test"});
      if (i === 1000) ev({kind: "tool", tool: "Bash", action: "cast", category: "test"});
      if (i === 1100) ev({kind: "waiting", tool: "Write", ts: 10});
      if (i === 1300) ev({kind: "resumed", ts: 12});
      if (i === 3000 && mode !== "classic") g.dev.finale();
      if (s.items.length) sawItem = true;
      if (s.gems.length) sawGem = true;
      for (const fx of s.effects) {
        if (fx.type === "pickup" && !counted.has(fx)) { counted.add(fx); picked++; }
      }
      r.draw(s, look);
      frames++;
    }
  } catch (e) {
    error = String(e) + "\n" + e.stack;
  }
  return {error, frames, over: s.over, sawItem, picked, sawGem, reason: s.over && s.results.reason};
}

// Which sprites the matches below actually draw.
const drawn = new Set();
const decode = LCSSprites.decode;
LCSSprites.decode = (name, o) => { drawn.add(name); return decode(name, o); };

const maps = {};
LCS_MAPS.forEach((m, i) => { maps[m.id] = drawMatch(m, 11 + i); });
LCS_MAPS.forEach((m, i) => { maps["classic " + m.id] = drawMatch(m, 31 + i, "classic"); });

// The handbook: every entry has a real sprite (or none) and both texts, numbers filled in.
const codexErrors = [], codexIds = {};
for (const sec of LCSCodex.sections(balance)) {
  codexIds[sec.id] = sec.entries.map((e) => e.id);
  for (const e of sec.entries) {
    if (e.icon !== null && !LCSSprites.SPRITES[e.icon]) codexErrors.push(`${e.id}: no sprite ${e.icon}`);
    for (const pair of [e.name, e.text]) {
      if (pair.length !== 2 || pair.some((x) => typeof x !== "string" || !x)) codexErrors.push(`${e.id}: empty text`);
      else if (/undefined|NaN|null/.test(pair.join(" "))) codexErrors.push(`${e.id}: ${pair[0]}`);
      else if (/[А-Яа-яЁё]/.test(pair[1])) codexErrors.push(`${e.id}: Russian in English`);
    }
  }
}
const hints = ["medkit", "coffee", "duck", "shield", "chest", "gem", "rage", "commit", "push",
               "turret", "tests", "red_ci", "reviewer", "orchestra", "spirit_shooter",
               "spirit_scout", "spirit_plan", "elite", "deploy", "incident"]
  .concat(Object.keys(balance.enemies), ["final"])
  .filter((id) => !LCSCodex.entry(balance, id));
// Several live bosses: one bar each, stacked, so the bars end lower than with one boss.
function bossBarsEnd(bosses) {
  const g = LCS.createGame(balance, {seed: 5});
  const canvas = fakeCanvas();
  canvas.getBoundingClientRect = () => ({left: 0, top: 0, width: 1000, height: 700});
  const r = LCSRender.createRenderer(canvas, balance);
  g.dev.immortal();
  g.agentEvent({kind: "prompt", session: "a", project: "sidequest"});
  for (const type of bosses) g.dev.boss(type);
  g.step(1 / 60, {x: 0, y: 0});
  r.draw(g.state, LCSHero.clean(null));
  return Math.round(r.bossBarsBottom());
}
const bossBars = {none: bossBarsEnd([]), one: bossBarsEnd([balance.bosses.order[0]]),
                  two: bossBarsEnd(balance.bosses.order.slice(0, 2)), all: bossBarsEnd(balance.bosses.order)};
// The achievements screen draws each achievement's icon.
const achievementIcons = balance.achievements.filter((a) => !LCSSprites.SPRITES[a.icon]).map((a) => a.id);

print(JSON.stringify({spriteErrors, heroErrors, heroLooks, heroFacts, sizes, fontErrors, missing, missingInTexts, texts, maps, calls, badCall,
                      codexErrors, codexIds, hints, achievementIcons, bossBars, drawn: [...drawn]}));
