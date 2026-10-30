// Run by tests/test_arena.py through jsc: plays whole matches of Last Commit Standing
// with a simple bot and prints a summary as JSON.
// Usage: jsc arena_harness.js -- <project dir>
"use strict";
const [project] = arguments;
const GAME = project + "/game";
load(GAME + "/maps.js");
load(GAME + "/terrain.js");
load(GAME + "/modes.js");
load(GAME + "/build.js");
load(GAME + "/events.js");
load(GAME + "/weapons.js");
load(GAME + "/allies.js");
load(GAME + "/trials.js");
load(GAME + "/classes.js");
load(GAME + "/game.js");
load(GAME + "/progress.js");
const balance = JSON.parse(readFile(GAME + "/balance.json"));
const DT = 1 / 60;

function readScenario(name) {
  return readFile(project + "/dev/scenarios/" + name + ".jsonl").split("\n")
    .map((l) => l.trim()).filter((l) => l && !l.startsWith("//")).map((l) => JSON.parse(l));
}

// Moves away from the closest enemies, drifting around the arena centre; picks up
// crystals nearby.
function bot(s) {
  let x = 0, y = 0;
  for (const g of s.gems) {
    const dx = g.x - s.player.x, dy = g.y - s.player.y, d2 = dx * dx + dy * dy;
    if (d2 < 100 * 100) { x += dx / (d2 + 1) * 0.5; y += dy / (d2 + 1) * 0.5; }
  }
  for (const e of s.enemies) {
    const dx = s.player.x - e.x, dy = s.player.y - e.y, d2 = dx * dx + dy * dy;
    if (d2 < 120 * 120) { x += dx / (d2 + 1); y += dy / (d2 + 1); }
  }
  const cx = balance.arena.width / 2 - s.player.x, cy = balance.arena.height / 2 - s.player.y;
  x += cx * 0.00002 - Math.sin(s.time / 3) * 0.002;
  y += cy * 0.00002 + Math.cos(s.time / 3) * 0.002;
  const len = Math.hypot(x, y) || 1;
  return {x: x / len, y: y / len};
}

const inWall = (s, o) => s.map.walls.some((w) => o.x > w.x && o.x < w.x + w.w && o.y > w.y && o.y < w.y + w.h);

function play(events, maxTime, seed, map, mode, B) {
  const game = LCS.createGame(B || balance, {seed, map, mode});
  const s = game.state;
  let i = 0, steps = 0, maxEnemies = 0, bad = null, choicesSeen = 0, firstLevelAt = null;
  let reloads = 0, leaked = 0, inWalls = 0;
  const types = new Set(), offered = new Set();
  const start = Date.now();
  while (!s.over && s.time < maxTime) {
    while (i < events.length && events[i].t <= s.time) game.agentEvent(events[i++]);
    if (s.choices) {
      choicesSeen++;
      for (const c of s.choices) offered.add(c.key);
      game.choose(steps % s.choices.length);
    }
    const wasReloading = s.player.reload > 0;
    game.step(DT, bot(s));
    steps++;
    if (!wasReloading && s.player.reload > 0) reloads++;
    // Damage "in flight" must belong to a shot that is still flying.
    if (steps % 600 === 0) {
      for (const e of s.enemies) types.add(e.type);
      leaked += s.enemies.filter((e) => e.incoming > 0.001 && !s.shots.some((sh) => sh.aim === e)).length;
      // Deprecated is a ghost and may stand in a wall.
      inWalls += s.enemies.filter((e) => !e.ghost && inWall(s, e)).length + (inWall(s, s.player) ? 1 : 0);
    }
    if (s.level > 1 && firstLevelAt === null) firstLevelAt = s.time;
    maxEnemies = Math.max(maxEnemies, s.enemies.length);
    if (!bad) {
      const p = s.player;
      if (![p.x, p.y, p.hp, s.score].every(Number.isFinite)) bad = "player " + JSON.stringify(p);
      for (const e of s.enemies) if (!Number.isFinite(e.x + e.y + e.hp)) bad = "enemy " + e.type;
    }
  }
  return {over: s.over, results: s.results, time: Math.round(s.time), level: s.level, gems: s.gems.length,
          finale_at: s.finaleAt, types: [...types], with_agent: s.withAgent, met: Object.keys(s.met),
          offered: [...offered], weapons: s.weapons.map((w) => w.id), passives: Object.keys(s.taken),
          choices: choicesSeen, max_enemies: maxEnemies, bad, kills: s.kills,
          allies: s.allies.map((a) => a.state), deaths: s.deaths, first_level_at: firstLevelAt,
          ms_per_step: (Date.now() - start) / steps, taken: s.taken, reloads, leaked, in_walls: inWalls};
}

// A busy agent: an action every ~2.5 s, some errors and a subagent.
function busyAgent(session, from, to, seed) {
  const actions = [["Edit", "attack"], ["Read", "scout"], ["Bash", "cast"], ["Write", "attack"],
                   ["Bash", "scout"], ["WebFetch", "scout_far"], ["mcp__x", "generic"]];
  const out = [{t: from, kind: "session_start", session, project: session},
               {t: from + 1, kind: "prompt", session, project: session}];
  let n = seed;
  for (let t = from + 3; t < to; t += 2.5) {
    n = (n * 9301 + 49297) % 233280;
    const [tool, action] = actions[n % actions.length];
    if (n % 17 === 0) {
      out.push({t, kind: "tool_error", tool: "Bash", action: "cast", category: "test", ok: false,
                session, project: session});
    } else {
      out.push({t, kind: "tool", tool, action, ok: true, lines_added: n % 30, lines_removed: n % 7,
                category: tool === "Bash" ? (action === "scout" ? "search" : "test") : undefined,
                session, project: session});
    }
  }
  out.push({t: from + 60, kind: "subagent_start", agent: "sub", session, project: session});
  out.push({t: from + 62, kind: "tool", tool: "Read", action: "scout", ok: true, agent: "sub",
            session, project: session});
  out.push({t: from + 120, kind: "subagent_stop", agent: "sub", session, project: session});
  out.push({t: to, kind: "stop", ok: true, background: 0, final: true, session, project: session});
  return out;
}

const result = {};
for (const name of ["short-task", "long-task", "two-agents", "error-streak", "blocked",
                    "joined-mid-session", "unknown-tool"]) {
  const events = readScenario(name);
  result[name] = play(events, events[events.length - 1].t + 30, 7);
}
const two = busyAgent("a", 0, 300, 11).concat(busyAgent("b", 5, 600, 23)).sort((x, y) => x.t - y.t);
result.busy_two = play(two, 700, 3);
result.busy_two_mid = play(two.filter((e) => e.t < 400), 400, 3);
// The same seed and events give the same match.
const again = play(readScenario("error-streak"), 80, 7);
result.repeatable = JSON.stringify(again.results) === JSON.stringify(result["error-streak"].results);
result.idle = play([{t: 0, kind: "prompt", session: "z", project: "z"}], 600, 5);

// Every map: two busy agents for ten minutes.
result.maps = {};
for (const map of LCS_MAPS) result.maps[map.id] = play(two, 700, 9, map);

// On "legacy" an enemy in the far room must find its way through the doors.
{
  const game = LCS.createGame(balance, {seed: 4, map: LCS_MAPS.find((m) => m.id === "legacy")});
  const s = game.state;
  game.dev.immortal();
  Object.assign(s.player, {x: 200, y: 600});
  const e = {type: "tank", x: 1400, y: 300, r: 9, hp: 1e9, maxHp: 1e9, speed: 40, damage: 0, score: 0,
             slow: 0, slowFactor: 1, flash: 0, dead: false, incoming: 0};
  s.enemies.push(e);
  let reached = null;
  while (s.time < 90 && reached === null) {
    game.step(DT, {x: 0, y: 0});
    if (Math.hypot(e.x - s.player.x, e.y - s.player.y) < e.r + s.player.r + 2) reached = s.time;
  }
  result.pathfinding = {reached, straight: Math.hypot(1400 - 200, 300 - 600) / 40};
}

// An agent behind a wall from the player goes round it, never through it.
{
  const game = LCS.createGame(balance, {seed: 4, map: LCS_MAPS.find((m) => m.id === "legacy")});
  const s = game.state;
  game.dev.immortal();
  game.agentEvent({kind: "prompt", session: "w", project: "w"});
  const a = s.allies[0];
  Object.assign(s.player, {x: 700, y: 200});
  Object.assign(a, {x: 400, y: 200});
  let inside = 0, near = null;
  while (s.time < 30) {
    game.step(DT, {x: 0, y: 0});
    if (inWall(s, a)) inside++;
    if (near === null && Math.hypot(a.x - s.player.x, a.y - s.player.y) < 80) near = s.time;
  }
  result.allyWalls = {inside, near};
}

// --- classic: alone, experience from crystals, a final boss ---------------------------

const tweak = (f) => { const B = JSON.parse(JSON.stringify(balance)); f(B); return B; };
const at = (id) => LCS_MAPS.find((m) => m.id === id);
const MINUTE = tweak((B) => { B.classic.seconds = 60; });
const stepFor = (game, seconds, input) => {
  const s = game.state, end = s.time + seconds;
  while (!s.over && s.time < end) {
    if (s.choices) game.choose(0);
    game.step(DT, input ? input(s) : bot(s));
  }
};

result.classic = {};
// Alone, with no agent at all: crystals level the player up.
result.classic.alone = play([], 150, 21, at("open"), "classic");
// The player stands still: the run ends with the player's death.
{
  const game = LCS.createGame(balance, {seed: 22, map: at("open"), mode: "classic"});
  stepFor(game, 600, () => ({x: 0, y: 0}));
  result.classic.still = {over: game.state.over, results: game.state.results};
}
// An agent who comes and goes does not end a classic run.
result.classic.with_agent = play(readScenario("short-task"), 100, 23, at("open"), "classic", MINUTE);
// The final boss comes at the end of the clock; killing it wins the run.
{
  const game = LCS.createGame(MINUTE, {seed: 24, map: at("hotfix"), mode: "classic"});
  const s = game.state;
  game.dev.immortal();
  stepFor(game, 61);
  const boss = s.enemies.find((e) => e.final);
  const finalHp = boss ? boss.maxHp : 0;
  if (boss) boss.hp = 1;
  stepFor(game, 60, () => ({x: boss ? Math.sign(boss.x - s.player.x) : 0, y: boss ? Math.sign(boss.y - s.player.y) : 0}));
  result.classic.final = {boss: Boolean(boss), final_hp: finalHp, over: s.over, results: s.results,
                          enemies_left: s.enemies.length};
}

// --- gear: a chest offers new pieces, then levels and the rare ones, then score ----------
{
  const game = LCS.createGame(balance, {seed: 25, map: at("open")});
  const s = game.state;
  game.agentEvent({kind: "prompt", session: "a", project: "a"});
  game.dev.immortal();
  const before = JSON.parse(JSON.stringify(s.stats));
  const offers = [];
  for (let i = 0; i < balance.gear.length * balance.chest.max_level + 1; i++) {
    game.dev.chest();
    const chest = s.items[s.items.length - 1];
    chest.x = s.player.x;
    chest.y = s.player.y;
    game.step(DT, {x: 0, y: 0});
    offers.push({kind: s.choiceKind, n: s.choices ? s.choices.length : 0,
                 cards: (s.choices || []).map((c) => ({id: c.id, level: c.level, gear: c.gear, rare: c.rare,
                                                       text_en: c.text_en}))});
    if (s.choices) game.choose(0);
  }
  // A level-up and a chest at once: both are offered, one after the other.
  game.dev.level();
  const levelFirst = s.choiceKind;
  game.choose(0);
  result.gear = {offers, taken: s.gear, levels: s.gearLevels, unique: new Set(s.gear).size, before,
                 after: s.stats, shield: s.player.shield, level_first: levelFirst, choices_left: s.choices,
                 pending: s.pendingChests};
}
// A boss leaves a chest.
{
  const game = LCS.createGame(balance, {seed: 26, map: at("open")});
  const s = game.state;
  game.agentEvent({kind: "prompt", session: "a", project: "a"});
  game.dev.immortal();
  game.dev.boss();
  const boss = s.enemies.find((e) => e.type === "boss");
  boss.hp = 1;
  boss.x = s.player.x + 60;
  boss.y = s.player.y;
  stepFor(game, 5, () => ({x: 0, y: 0}));
  result.boss_chest = {dead: boss.dead, chest: s.items.some((it) => it.type === "chest"),
                       medkit: s.items.some((it) => it.type === "medkit")};
}

// --- the maps' own enemies ----------------------------------------------------------------
function arena(id, seed) {
  const game = LCS.createGame(balance, {seed, map: at(id)});
  game.agentEvent({kind: "prompt", session: "a", project: "a"});
  game.dev.immortal();
  return game;
}
result.enemies = {};
// A memory leak splits in two.
{
  const game = arena("monorepo", 27), s = game.state;
  game.dev.enemy("leak");
  const e = s.enemies[0];
  Object.assign(e, {x: s.player.x + 60, y: s.player.y, hp: 1, speed: 0});
  stepFor(game, 1, () => ({x: 0, y: 0}));
  result.enemies.leak = {dead: e.dead, small: s.enemies.filter((x) => x.type === "leak_small").length
                         + s.kills - 1};
}
// Race condition: killed alone, the twin comes back; killed together, both stay dead.
{
  const game = arena("open", 28), s = game.state;
  game.dev.enemy("race");
  const [a, b] = s.enemies;
  const linked = a.partner === b && b.partner === a;
  Object.assign(a, {x: s.player.x + 60, y: s.player.y, hp: 1, speed: 0});
  Object.assign(b, {x: s.player.x + 1000, y: s.player.y, hp: 1e9, speed: 0});
  while (!a.dead && s.time < 5) game.step(DT, {x: 0, y: 0});
  s.stats.damage = 0;  // the revived twin must live to be seen
  stepFor(game, balance.enemies.race.revive_seconds + 0.5, () => ({x: 0, y: 0}));
  const back = s.enemies.filter((e) => e.type === "race" && e !== b);
  const revived = back.length === 1 && back[0].partner === b && b.partner === back[0];
  // Now both near the player, one shot each.
  s.stats.damage = 1;
  for (const e of s.enemies) Object.assign(e, {x: s.player.x + 50, y: s.player.y + (e === b ? 8 : -8), hp: 1, speed: 0});
  stepFor(game, 3, () => ({x: 0, y: 0}));
  result.enemies.race = {linked, a_dead: a.dead, revived, synced: s.synced,
                         left: s.enemies.filter((e) => e.type === "race").length};
}
// Null pointer jumps towards the player, never into a wall.
{
  const game = arena("hotfix", 29), s = game.state;
  game.dev.enemy("nullptr");
  const e = s.enemies[0];
  Object.assign(e, {x: s.player.x - 180, y: s.player.y, hp: 1e9, blinkAt: s.time});
  const x0 = e.x;
  game.step(DT, {x: 0, y: 0});
  const jumped = e.x - x0;
  let walls = 0;
  for (let i = 0; i < 60 * 30; i++) {
    game.step(DT, bot(s));
    if (inWall(s, e)) walls++;
  }
  result.enemies.nullptr = {jumped, walls, blink: balance.enemies.nullptr.blink_distance};
}
// Deprecated walks straight through walls.
{
  const game = arena("legacy", 30), s = game.state;
  Object.assign(s.player, {x: 400, y: 200});
  game.dev.enemy("deprecated");
  const e = s.enemies[0];
  Object.assign(e, {x: 700, y: 200, hp: 1e9, damage: 0});
  let crossed = false, reached = null;
  while (s.time < 30 && reached === null) {
    game.step(DT, {x: 0, y: 0});
    if (inWall(s, e)) crossed = true;
    if (Math.hypot(e.x - s.player.x, e.y - s.player.y) < e.r + s.player.r + 2) reached = s.time;
  }
  result.enemies.deprecated = {crossed, reached, straight: 300 / e.speed};
}

// Guns do not aim at an enemy behind a wall: their bullets would stop in it.
{
  const shoot = (withOpen) => {
    const game = arena("hotfix", 31), s = game.state;
    s.enemies.length = 0;
    s.weapons = [{id: "pistol", level: 1, evolved: false, timer: 0}];
    Object.assign(s.player, {x: 270, y: 180});
    const hidden = crowd(game, 1, 0, 1e6)[0];
    Object.assign(hidden, {x: 360, y: 180});
    const open = withOpen ? Object.assign(crowd(game, 1, 0, 1e6)[0], {x: 270, y: 300}) : null;
    stepFor(game, 2, () => ({x: 0, y: 0}));
    return {hidden: 1e6 - hidden.hp, open: open ? 1e6 - open.hp : null, ammo: s.player.ammo};
  };
  result.sight = {alone: shoot(false), both: shoot(true)};
  // No weapon at all hurts an enemy fully behind a wall: beams stop at it, lightning does
  // not strike or jump through it.
  result.sight.weapons = {};
  for (const w of balance.weapons) {
    const game = arena("hotfix", 41), s = game.state;
    s.enemies.length = 0;
    s.spawnAt = Infinity;
    s.weapons = [{id: w.id, level: 1, evolved: false, timer: 0}];
    Object.assign(s.player, {x: 270, y: 180});
    const hidden = Object.assign(crowd(game, 1, 0, 1e6)[0], {x: 360, y: 180, speed: 0});
    stepFor(game, 3, () => ({x: 0, y: 0}));
    result.sight.weapons[w.id] = Math.round(1e6 - hidden.hp);
  }
  // The null pointer does not blink through a wall to the player on the other side.
  {
    const game = arena("hotfix", 29), s = game.state;
    s.enemies.length = 0;
    Object.assign(s.player, {x: 380, y: 180});
    game.dev.enemy("nullptr");
    const e = Object.assign(s.enemies[s.enemies.length - 1], {x: 250, y: 180, hp: 1e9, damage: 0});
    // It may walk round the wall; a blink is a jump, and none goes from one side to the other.
    let crossed = false;
    for (let i = 0; i < 600; i++) {
      e.blinkAt = Math.min(e.blinkAt, s.time);
      s.enemies = [e];
      const x0 = e.x;
      game.step(DT, {x: 0, y: 0});
      if (x0 < 300 && e.x > 324) crossed = true;
    }
    result.sight.blink_crossed = crossed;
  }
}

// Floating texts from a burst of events do not land on each other.
{
  const game = arena("open", 33), s = game.state;
  game.agentEvent({kind: "prompt", session: "a", project: "demo"});
  stepFor(game, 1, () => ({x: 0, y: 0}));
  for (const kind of ["tool_error", "blocked", "tool_error"]) {
    game.agentEvent({kind, session: "a", project: "demo", tool: "Bash", category: "test", ok: false});
  }
  game.agentEvent({kind: "tool", session: "a", project: "demo", tool: "Bash", action: "cast", category: "git",
                   git: ["commit"], ok: true});
  game.step(DT, {x: 0, y: 0});
  const at = s.texts.map((t) => ({x: t.x, y: t.y - t.t * 14, text: t.text}));
  let piled = 0;
  for (let i = 0; i < at.length; i++) {
    for (let j = i + 1; j < at.length; j++) {
      if (Math.abs(at[i].x - at[j].x) < 48 && Math.abs(at[i].y - at[j].y) < 8) piled++;
    }
  }
  result.texts = {count: at.length, piled, all: at.map((t) => t.text)};
}

// --- the arsenal: weapons, passives, evolutions --------------------------------------------

// A crowd around the player, slowly closing in; returns its enemies.
function crowd(game, n, radius, hp) {
  const s = game.state, list = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, d = radius * (0.5 + (i % 3) / 4);
    list.push({type: "grunt", x: s.player.x + Math.cos(a) * d, y: s.player.y + Math.sin(a) * d,
               r: 5, hp, maxHp: hp, speed: 12, damage: 0, score: 10, slow: 0, slowFactor: 1,
               flash: 0, dead: false, incoming: 0, born: -1, hitAt: {}});
  }
  s.enemies.push(...list);
  return list;
}

// Each weapon alone, at level 1 and evolved, against the same crowd for 10 seconds.
result.arsenal = {weapons: {}};
for (const cfg of balance.weapons) {
  const one = {};
  for (const evolved of [false, true]) {
    const game = arena("open", 40);
    const s = game.state;
    s.weapons = [{id: cfg.id, level: evolved ? cfg.levels.length + 1 : 1, evolved, timer: 0}];
    const list = crowd(game, 30, 80, 1e6);
    stepFor(game, 10, () => ({x: 0, y: 0}));
    one[evolved ? "evolved" : "base"] = {
      hurt: Math.round(list.reduce((sum, e) => sum + 1e6 - e.hp, 0)),
      hit: list.filter((e) => e.hp < 1e6).length,
      finite: list.every((e) => Number.isFinite(e.hp))};
  }
  result.arsenal.weapons[cfg.id] = one;
}

// Slots: no more than four weapons and four passives, every card from the pool.
{
  const game = arena("open", 41), s = game.state;
  const seen = new Set();
  let most = {weapons: 0, passives: 0};
  for (let i = 0; i < 120; i++) {
    game.dev.level();
    if (!s.choices) break;
    for (const c of s.choices) seen.add(c.key);
    game.choose(i % s.choices.length);
    most = {weapons: Math.max(most.weapons, s.weapons.length),
            passives: Math.max(most.passives, Object.keys(s.taken).length)};
  }
  game.dev.level();
  result.arsenal.slots = {most, last: s.choices && s.choices.map((c) => c.kind),
                          keys: [...seen].length};
}

// A maxed weapon and its passive: the evolution comes first on the next level-up.
{
  const game = arena("open", 42), s = game.state;
  const pistol = balance.weapons.find((w) => w.id === "pistol");
  s.weapons[0].level = pistol.levels.length + 1;
  game.dev.level();
  const before = s.choices.map((c) => c.kind);
  game.choose(s.choices.findIndex((c) => c.key === "passive:" + pistol.evolution.passive) >= 0
    ? s.choices.findIndex((c) => c.key === "passive:" + pistol.evolution.passive) : 0);
  s.taken[pistol.evolution.passive] = s.taken[pistol.evolution.passive] || 1;
  game.dev.level();
  const offer = s.choices.map((c) => c.key);
  game.choose(0);
  // while (true): no reloads at all.
  crowd(game, 40, 80, 1e6);
  let reloads = 0;
  for (let i = 0; i < 60 * 6; i++) {
    game.step(DT, {x: 0, y: 0});
    if (s.player.reload > 0) reloads++;
  }
  game.dev.level();
  result.arsenal.evolution = {before, offer, evolved: s.weapons[0].evolved, reloads,
                              again: s.choices.some((c) => c.kind === "evolution"),
                              evolutions: s.evolutions};
}

// Reroll and banish: a few per match; a banished card never comes back.
{
  const game = arena("open", 43), s = game.state;
  game.dev.level();
  const first = s.choices.map((c) => c.key);
  const rerolls = [];
  while (game.reroll()) rerolls.push(s.rerolls);
  const banished = s.choices[0].key;
  game.banish(0);
  let back = false, banishes = [s.banishes];
  while (game.banish(0)) banishes.push(s.banishes);
  for (let i = 0; i < 60; i++) {
    game.choose(0);
    game.dev.level();
    if (s.choices.some((c) => s.banished.includes(c.key))) back = true;
  }
  result.arsenal.reroll = {first, rerolls, after: s.rerolls, banished: s.banished, banishes,
                           back, reroll_now: game.reroll()};
}

// Everything maxed: a coffee break instead.
{
  const game = arena("open", 44), s = game.state;
  s.weapons = balance.weapons.slice(0, 4).map((w) => ({id: w.id, level: w.levels.length + 1,
                                                       evolved: true, timer: 0}));
  for (const u of balance.upgrades.slice(0, 4)) s.taken[u.id] = u.max_level;
  const hp = s.player.hp = 10, score = s.score;
  game.dev.level();
  const kinds = s.choices.map((c) => c.kind);
  game.choose(0);
  result.arsenal.filler = {kinds, healed: s.player.hp - hp, score: s.score - score};
}

result.arsenal.level_text = LCSBuild.levelText(balance.weapons.find((w) => w.id === "shotgun"),
                                          {count: 2, cooldown: 0.85});

// --- the agent's real work: git, builds, tests, answers, spirits, the orchestra --------------
{
  const AG = balance.agent;
  const still = () => ({x: 0, y: 0});
  const ev = (game, o) => game.agentEvent(Object.assign({session: "a", project: "a"}, o));
  const bash = (category, extra) => Object.assign({kind: "tool", tool: "Bash", action: "cast", category,
                                                   ok: true}, extra);
  const hurt = (list) => Math.round(list.reduce((sum, e) => sum + 1e6 - e.hp, 0));
  const chests = (s) => s.items.filter((it) => it.type === "chest").length;
  const r = result.agent = {};

  // A commit: a blast around the agent. A push: a chest, then a cooldown.
  {
    const game = arena("open", 50), s = game.state;
    stepFor(game, 1, still);
    const list = crowd(game, 20, 30, 1e6);
    game.step(DT, still());  // the crowd gets into the grid
    ev(game, bash("git", {git: ["commit"]}));
    r.commit = {hit: list.filter((e) => e.hp < 1e6).length, damage: hurt(list), commits: s.commits};
    ev(game, bash("git", {git: ["commit", "push"]}));
    ev(game, bash("git", {git: ["push"]}));
    const first = chests(s);
    s.enemies = [];
    stepFor(game, AG.push.cooldown_seconds + 1, still);
    ev(game, bash("git", {git: ["push"]}));
    r.push = {first, later: chests(s), pushes: s.pushes, commits: s.commits};
    r.results = game.finish("quit");
  }

  // A build: a turret that shoots for a while; no more than a few at once.
  {
    const game = arena("open", 51), s = game.state;
    stepFor(game, 1, still);
    for (let i = 0; i < AG.turret.max + 1; i++) ev(game, bash("build"));
    const placed = s.turrets.length;
    s.weapons = [];
    const list = crowd(game, 12, 60, 1e6);
    stepFor(game, 5, still);
    const damage = hurt(list);
    stepFor(game, AG.turret.seconds, still);
    r.turret = {placed, built: s.turretsBuilt, damage, after: s.turrets.length};
  }

  // Tests: passed — a shield, up to a cap; failed — red CI instead of rage, more enemies.
  {
    const game = arena("open", 52), s = game.state;
    ev(game, bash("test"));
    const one = s.player.shield;
    for (let i = 0; i < 20; i++) ev(game, bash("test"));
    const capped = s.player.shield;
    ev(game, Object.assign(bash("test"), {kind: "tool_error", ok: false, exit_code: 1}));
    const red = {red: s.redCi, rage: s.rage};
    ev(game, bash("test"));
    const cleared = s.redCi;
    ev(game, {kind: "tool_error", tool: "Edit", action: "attack", ok: false});
    r.tests = {one, capped, red, cleared, rage_on_other_errors: s.rage > 0};
    // The same match twice, once with a red CI: more enemies come.
    const spawned = [];
    for (const failed of [false, true]) {
      const g = arena("open", 53);
      g.state.weapons = [];
      if (failed) ev(g, Object.assign(bash("test"), {kind: "tool_error", ok: false}));
      stepFor(g, 12, still);
      spawned.push(g.state.enemies.length + g.state.kills);
    }
    r.tests.spawned = spawned;
  }

  // Waiting: a quick answer earns the bonus; a slow one, the button or the agent itself do not.
  {
    const game = arena("open", 54), s = game.state;
    const wait = (from, to, source) => {
      ev(game, {kind: "waiting", tool: "Write", ts: from});
      const waiting = s.allies[0].waiting;
      ev(game, Object.assign({kind: "resumed", ts: to}, source ? {source} : {}));
      return waiting;
    };
    const score = s.score;
    const waiting = wait(1000, 1000 + AG.reviewer.answer_seconds - 1);
    const fast = {reviews: s.reviews, coffee: s.buffs.coffee, score: s.score - score};
    wait(2000, 2000 + AG.reviewer.answer_seconds + 5);
    wait(3000, 3001, "button");
    wait(4000, 4001, "activity");
    ev(game, {kind: "resumed", ts: 5000});
    r.reviewer = {waiting, fast, reviews: s.reviews, after: s.allies[0].waiting};
  }

  // Spirits by the subagent's type, and the orchestra of three agents at once.
  {
    const game = arena("open", 55), s = game.state;
    stepFor(game, 1, still);
    const types = {};
    for (const [agent, type] of [["e", "Explore"], ["p", "Plan"], ["g", "general-purpose"], ["x", undefined]]) {
      ev(game, {kind: "subagent_start", agent, agent_type: type});
      types[type || "none"] = s.allies[0].spirits.get(agent).type;
    }
    ev(game, {kind: "subagent_stop", agent: "g"});
    ev(game, {kind: "subagent_stop", agent: "x"});
    s.weapons = [];
    s.player.hp = 40;
    const list = crowd(game, 16, 40, 1e6);
    stepFor(game, 4, still);
    const orchestra = s.orchestra;
    r.spirits = {types, healed: s.player.hp - 40, slowed: list.filter((e) => e.slow > 0).length,
                 orchestra};
    // The orchestra makes the commit bomb stronger; it ends when the subagents do.
    s.enemies = [];
    const strong = crowd(game, 10, 20, 1e6);
    game.step(DT, still());
    ev(game, bash("git", {git: ["commit"]}));
    ev(game, {kind: "subagent_stop", agent: "e"});
    ev(game, {kind: "subagent_stop", agent: "p"});
    stepFor(game, 0.1, still);
    r.orchestra = {on: orchestra, off: s.orchestra,
                   damage: strong.filter((e) => e.hp < 1e6).map((e) => 1e6 - e.hp)[0]};
    r.met = Object.keys(s.met);
  }
}

// --- Infinity: classic with no end but death -----------------------------------------------
{
  const r = result.infinity = {};
  const LOOP = tweak((B) => {
    B.classic.seconds = 60;
    B.infinity.final_every_minutes = 1;
    B.spawn.boss_every_minutes = 0.25;
  });
  const boss = (e) => LOOP.enemies[e.type].boss && !e.final;
  // The final boss falls and the run goes on; it comes back at the next of its minutes, and
  // the usual bosses come between.
  const game = LCS.createGame(LOOP, {seed: 24, map: at("hotfix"), mode: "infinity"});
  const s = game.state;
  game.dev.immortal();
  stepFor(game, 61);
  const final = s.enemies.find((e) => e.final);
  if (final) final.hp = 1;
  const toFinal = () => (final ? {x: Math.sign(final.x - s.player.x), y: Math.sign(final.y - s.player.y)}
    : {x: 0, y: 0});
  stepFor(game, 30, toFinal);
  r.after_final = {boss: Boolean(final), dead: Boolean(final && final.dead), over: s.over, final_at: s.finalAt};
  let usual = 0;
  while (s.time < 119) {
    game.step(DT, {x: 0, y: 0});
    if (s.choices) game.choose(0);
    usual = Math.max(usual, s.enemies.filter(boss).length);
  }
  r.usual_bosses = usual;
  stepFor(game, 2);
  r.again = s.enemies.some((e) => e.final);
  // Past the classic's end the bugs grow tougher: the same match as classic, a minute over.
  // The player's level takes no part, so the two matches differ only in the overtime.
  const FLAT = tweak((B) => { B.classic.seconds = 60; B.spawn.hp_growth_per_level = 0; });
  const grunt = (mode) => {
    const g = LCS.createGame(FLAT, {seed: 31, map: at("open"), mode});
    g.dev.immortal();
    stepFor(g, 120, () => ({x: 0, y: 0}));
    g.dev.enemy("grunt");
    const e = g.state.enemies[g.state.enemies.length - 1];
    return {hp: e.maxHp, damage: e.damage, time: g.state.time};
  };
  r.overtime = {classic: grunt("classic"), infinity: grunt("infinity")};
  // The spawn rate over one step, at a given time: the base alone is over the usual cap.
  const RATE = tweak((B) => { B.spawn.base_per_second = 4; B.spawn.per_minute = 0; B.spawn.per_level = 0; });
  const rate = (mode, time) => {
    const g = LCS.createGame(RATE, {seed: 32, map: at("open"), mode});
    Object.assign(g.state, {time, spawnAcc: 0});
    g.step(DT, {x: 0, y: 0});
    return g.state.spawnAcc / DT;
  };
  const C = RATE.classic.seconds;
  r.rate = {classic: rate("classic", C + 600), ten: rate("infinity", C + 600), hour: rate("infinity", C + 3600)};
  // Only death ends it.
  const alone = LCS.createGame(balance, {seed: 22, map: at("open"), mode: "infinity"});
  stepFor(alone, 600, () => ({x: 0, y: 0}));
  r.dead = alone.state.results;
  // The week's modifiers: the same Monday to Sunday, others the next week.
  const wk = (d) => LCSModes.week(balance, d);
  const mondays = Array.from({length: 20}, (_, i) => new Date(Date.UTC(2026, 0, 5 + 7 * i)).toISOString().slice(0, 10));
  r.week = {mon: wk("2026-10-19"), sun: wk("2026-10-25"), next: wk("2026-10-26"), new_year: wk("2027-01-03").week,
            sets: new Set(mondays.map((d) => wk(d).modifiers.join())).size};
  const res = Object.assign({}, result.classic.still.results, {mode: "infinity"});
  r.records = LCSProgress.addMatch(null, res).infinity;
}
// --- trials: short runs alone with a goal and a condition ---------------------------------
{
  const r = result.trials = {};
  const TR = balance.trials, R = TR.rush;
  const trialGame = (B, id) => {
    const T = LCSTrials.byId(B, id);
    return LCS.createGame(B, {seed: 41, map: at(T.map), mode: "trials", trial: id, modifiers: T.modifiers || []});
  };
  const isBoss = (e) => balance.enemies[e.type].boss;
  // The rush: the bosses one by one in their order, the last one final; weak bosses here, so
  // the bot gets through them.
  const WEAK = tweak((B) => { for (const id of R.bosses) B.enemies[id].hp = 1; });
  const rush = trialGame(WEAK, "rush"), rs = rush.state;
  rush.dev.immortal();
  const order = [], seen = new Set();
  let most = 0, finalType = null;
  while (!rs.over && rs.time < 300) {
    if (rs.choices) rush.choose(0);
    rush.step(DT, bot(rs));
    const bosses = rs.enemies.filter((e) => isBoss(e) && !e.dead);
    for (const e of bosses) {
      if (!seen.has(e.type)) { seen.add(e.type); order.push(e.type); }
      if (e.final) finalType = e.type;
    }
    most = Math.max(most, new Set(bosses.map((e) => e.type)).size);
  }
  // No boss but the rush's, and no final boss of the classic's.
  r.rush = {order, most, final: finalType, results: rs.results,
            no_final: rs.finalAt === Infinity, no_boss: rs.nextBoss === Infinity};
  // Race twins in the rush: one down alone comes back, and the next boss waits until the
  // whole pair is down, the revived twin too.
  {
    const g = trialGame(balance, "rush"), ts = g.state, still = () => ({x: 0, y: 0});
    g.dev.immortal();
    Object.assign(ts.trial, {index: R.bosses.indexOf("boss_race"), nextAt: 0});
    g.step(DT, still());
    const race = () => ts.enemies.filter((e) => e.type === "boss_race" && !e.dead);
    const bosses = () => [...new Set(ts.enemies.filter((e) => isBoss(e) && !e.dead).map((e) => e.type))];
    const put = (e, near, hp) => Object.assign(e, {x: ts.player.x + (near ? 60 : 1000), y: ts.player.y, hp, speed: 0});
    const until = (done) => { for (let t = 0; !done() && t < 10; t += DT) g.step(DT, still()); };
    const [a, b] = race();
    put(a, true, 1);
    put(b, false, 1e9);
    until(() => a.dead);
    ts.stats.damage = 0;  // the revived twin must live
    stepFor(g, balance.enemies.boss_race.revive_seconds + 0.5, still);
    const back = race().find((e) => e !== b);
    ts.stats.damage = 1;
    put(b, true, 1);
    put(back, false, 1e9);
    until(() => b.dead);
    ts.stats.damage = 0;
    stepFor(g, R.pause + 1, still);
    r.twins = {revived: Boolean(back), waiting: bosses()};
    ts.stats.damage = 1;
    race().forEach((e, i) => { put(e, true, 1); e.y += i ? 8 : -8; });
    until(() => race().length === 0);
    stepFor(g, R.pause + 1, still);
    r.twins.next = bosses();
  }
  // Rush+: a race twin that comes back keeps its pair's trait.
  {
    const g = trialGame(balance, "rush_plus"), ts = g.state, still = () => ({x: 0, y: 0});
    g.dev.immortal();
    Object.assign(ts.trial, {index: R.bosses.indexOf("boss_race"), nextAt: 0});
    g.step(DT, still());
    const [a, b] = ts.enemies.filter((e) => e.type === "boss_race");
    Object.assign(a, {x: ts.player.x + 60, y: ts.player.y, hp: 1, shield: 0, speed: 0});
    Object.assign(b, {x: ts.player.x + 1000, y: ts.player.y, hp: 1e9, speed: 0});
    for (let t = 0; !a.dead && t < 10; t += DT) g.step(DT, still());
    ts.stats.damage = 0;
    stepFor(g, balance.enemies.boss_race.revive_seconds + 0.5, still);
    const back = ts.enemies.find((e) => e.type === "boss_race" && e !== b && !e.dead);
    r.twins.elite = {pair: [a.elite, b.elite], back: back ? back.elite || null : "missing"};
  }
  // Rush+: the same first boss with an elite's trait and more health.
  const first = (id) => {
    const g = trialGame(balance, id);
    g.dev.immortal();
    stepFor(g, R.first_at + 0.5, () => ({x: 0, y: 0}));
    const e = g.state.enemies.find(isBoss);
    return e && {type: e.type, hp: e.maxHp, elite: e.elite || null};
  };
  r.plus = {plain: first("rush"), plus: first("rush_plus")};
  // No damage: one hit fails the trial.
  const clean = trialGame(balance, "clean");
  stepFor(clean, 1, () => ({x: 0, y: 0}));
  clean.dev.enemy("tank");
  const {enemies, player} = clean.state;
  Object.assign(enemies[enemies.length - 1], {x: player.x, y: player.y});
  stepFor(clean, 5, () => ({x: 0, y: 0}));
  r.clean = {results: clean.state.results, damage: clean.state.damageTaken};
  // Once decided, the match stays so: a dead player's final boss down is no pass...
  const dead = trialGame(balance, "hotfix");
  stepFor(dead, 1, () => ({x: 0, y: 0}));
  dead.state.player.hp = 1;
  dead.dev.enemy("tank");
  Object.assign(dead.state.enemies[dead.state.enemies.length - 1], {x: dead.state.player.x, y: dead.state.player.y});
  for (let t = 0; dead.state.endAt === null && t < 5; t += DT) dead.step(DT, {x: 0, y: 0});
  dead.dev.stage();
  stepFor(dead, 10, () => ({x: 0, y: 0}));
  // Holding out: won at the trial's seconds.
  const SHORT = tweak((B) => {
    LCSTrials.byId(B, "night").seconds = 15;
    Object.assign(LCSTrials.byId(B, "refactor"), {kills: 5, limit: 600});
    LCSTrials.byId(B, "hotfix").final_at = 30;
  });
  const night = trialGame(SHORT, "night");
  night.dev.immortal();
  stepFor(night, 60);
  r.night = night.state.results;
  // ...and a hit after a pass is no fail.
  const kept = trialGame(SHORT, "night"), ks = kept.state;
  kept.dev.immortal();
  for (let t = 0; ks.endAt === null && t < 30; t += DT) kept.step(DT, {x: 0, y: 0});
  kept.dev.immortal();
  ks.player.hp = 1;
  kept.dev.enemy("tank");
  Object.assign(ks.enemies[ks.enemies.length - 1], {x: ks.player.x, y: ks.player.y});
  stepFor(kept, 10, () => ({x: 0, y: 0}));
  r.decided = {dead: dead.state.results.reason, kept: ks.results.reason, hp: ks.player.hp};
  // Kills: won once there are enough, failed when the time runs out first.
  const kills = trialGame(SHORT, "refactor");
  kills.dev.immortal();
  stepFor(kills, 600);
  const SLOW = tweak((B) => Object.assign(LCSTrials.byId(B, "refactor"), {kills: 100000, limit: 10}));
  const late = trialGame(SLOW, "refactor");
  late.dev.immortal();
  stepFor(late, 60);
  r.kills = {won: kills.state.results, late: late.state.results};
  // A short classic: its final boss at the trial's minute, beating it wins.
  const hot = trialGame(SHORT, "hotfix");
  r.hotfix = {final_at: hot.state.finalAt};
  hot.dev.immortal();
  stepFor(hot, 31, () => ({x: 0, y: 0}));
  r.hotfix.final = hot.state.enemies.some((e) => e.final);
  hot.dev.stage();
  stepFor(hot, 10, () => ({x: 0, y: 0}));
  r.hotfix.results = hot.state.results;
  // Agents stay out; the modifiers are the trial's.
  const alone = trialGame(balance, "edge");
  alone.agentEvent({kind: "session_start", session: "t1", project: "demo", ts: 1});
  alone.agentEvent({kind: "prompt", session: "t1", project: "demo", ts: 2});
  stepFor(alone, 2, () => ({x: 0, y: 0}));
  r.alone = {allies: alone.state.allies.length, modifiers: alone.state.modifiers};
  // What the menu and the HUD say.
  r.goals = TR.list.map((T) => LCSTrials.goal(balance, T));
  r.goal_kinds = Object.keys(LCSTrials.GOALS);
  r.status = {rush: LCSTrials.status(balance, rush.state), night: LCSTrials.status(SHORT, night.state),
              kills: LCSTrials.status(SHORT, kills.state)};
  // The records: passed once and for all, the best time of a pass, only known trials.
  const res = (trial, reason, time) => ({mode: "trials", trial, reason, trial_time: reason === "passed" ? time : null});
  let saved = JSON.parse('{"__proto__": {"done": true}, "nope": {"done": true},'
                         + ' "rush": {"done": true, "best": -5, "tries": 1.5}}');
  for (const x of [res("clean", "failed", 20), res("clean", "passed", 100), res("clean", "passed", 80),
                   res("clean", "dead", 10), res("nope", "passed", 5)]) saved = LCSProgress.addTrial(saved, TR.list, x);
  r.records = {saved, done: LCSProgress.trialsDone(saved), proto: Object.getPrototypeOf(saved) === Object.prototype};
  const known = LCSProgress.known(balance, LCS_MAPS);
  const ach = (x) => LCSProgress.earned(balance.achievements, x, LCSProgress.migrate(null), known);
  const passed = (n) => ach(Object.assign({}, night.state.results, {trials_done: n}));
  const full = balance.achievements.find((a) => a.id === "trials_all");
  r.achievements = {plus: ach(Object.assign({}, rs.results, {trial: "rush_plus"})),
                    all: passed(TR.list.length), almost: passed(TR.list.length - 1),
                    progress: LCSProgress.progressOf(full, LCSProgress.migrate(null),
                                                     LCSProgress.addBests(null, [full], {trials_done: 3}), known)};
}
// --- solo modes: the ghost, the daily task, modifiers ----------------------------------------
{
  const r = result.solo = {};
  const run = (options, seconds, live) => {
    const game = LCS.createGame(balance, Object.assign({seed: 60, map: at("open")}, options));
    const s = game.state;
    game.dev.immortal();
    let i = 0;
    const seen = {allies: 0, active: 0};
    while (!s.over && s.time < seconds) {
      while (live && i < live.length && live[i].t <= s.time) game.agentEvent(live[i++]);
      if (s.choices) game.choose(0);
      game.step(DT, bot(s));
      seen.allies = Math.max(seen.allies, s.allies.length);
      if (s.allies.some((a) => a.state === "active")) seen.active++;
    }
    return {game, s, seen};
  };

  // The daily task: the same for the whole day, different across days.
  const d1 = LCSModes.daily(balance, LCS_MAPS, "2026-10-09"), d2 = LCSModes.daily(balance, LCS_MAPS, "2026-10-09");
  const week = [];
  for (let i = 1; i <= 28; i++) week.push(LCSModes.daily(balance, LCS_MAPS, `2026-02-${String(i).padStart(2, "0")}`));
  const opts = {seed: d1.seed, map: at(d1.map), mode: "daily", modifiers: d1.modifiers, day: d1.date};
  const a = run(opts, 60, readScenario("short-task")), b = run(opts, 60);
  r.daily = {same: JSON.stringify(d1) === JSON.stringify(d2), task: d1,
             maps: [...new Set(week.map((x) => x.map))].length,
             sets: [...new Set(week.map((x) => x.modifiers.join()))].length,
             repeat: JSON.stringify(a.game.finish("quit")) === JSON.stringify(b.game.finish("quit")),
             results: a.s.results, allies: a.seen.allies, solo: a.s.solo};

  // A ghost: a past session with two tasks and a long pause between them.
  const task = readScenario("short-task").filter((e) => e.kind !== "session_end");
  const later = task.filter((e) => e.kind !== "session_start").map((e) => Object.assign({}, e, {t: e.t + 900}));
  const events = task.concat(later, [{t: 1000, kind: "session_end", reason: "exit", session: "a1", project: "demo"}]);
  const g = run({mode: "ghost", ghost: {session: "abc", events}}, 400, readScenario("short-task"));
  r.ghost = {results: g.s.results, allies: g.seen.allies, project: g.s.allies[0] && g.s.allies[0].project,
             session: g.s.allies[0] && g.s.allies[0].session, active: g.seen.active};
  // A recording without a final stop still ends.
  const open = run({mode: "ghost", ghost: {session: "x", events: task.slice(0, 5)}}, 200);
  r.ghost.unfinished = open.s.results && open.s.results.reason;
  r.ghost.empty = run({mode: "ghost", ghost: {session: "y", events: []}}, 60).s.results.reason;

  // Modifiers.
  const m = {};
  {
    const {game, s} = run({mode: "classic", modifiers: ["glass_cannon", "no_medkits", "nope"]}, 0);
    for (let i = 0; i < 300; i++) game.dev.item();
    m.glass = {max_hp: s.stats.max_hp, hp: s.player.hp, damage: s.stats.damage, modifiers: s.modifiers,
               medkits: s.items.filter((it) => it.type === "medkit").length, items: s.items.length};
  }
  {
    const {s} = run({mode: "classic", modifiers: ["eternal_rage"]}, 30);
    m.rage = s.rage > 0;
  }
  {
    const {game, s} = run({mode: "classic", modifiers: ["pistol_only"]}, 0);
    for (let i = 0; i < 40; i++) { game.dev.level(); if (s.choices) game.choose(0); }
    m.pistol = s.weapons.map((w) => w.id);
  }
  {
    const hp = [];
    for (const mods of [[], ["code_review"]]) {
      const {game, s} = run({mode: "classic", modifiers: mods}, 0);
      game.dev.enemy("grunt");
      hp.push(s.enemies[s.enemies.length - 1].maxHp);
    }
    m.code_review = hp[1] / hp[0];
  }
  {
    const {game, s} = run({mode: "classic", modifiers: ["code_review", "glass_cannon"]}, 20);
    const raw = Math.floor(s.score);
    const res = game.finish("quit");
    m.score = {raw, score: res.score, mul: res.score_mul, count: res.modifiers, ids: res.modifier_ids};
  }
  r.modifiers = m;

  // Records: the days in a row, the ghost's best.
  const P = LCSProgress;
  let days = P.addDay(null, {day: "2026-10-07", score: 100});
  days = P.addDay(days, {day: "2026-10-08", score: 50});
  days = P.addDay(days, {day: "2026-10-08", score: 20});
  days = P.addDay(days, {day: "2026-10-09", score: 70});
  days = P.addDay(Object.assign({junk: 1, "2026-10-01": "x"}, days), {});
  let ghosts = P.addGhost(null, {ghost: "s1", score: 300, at: 5});
  ghosts = P.addGhost(ghosts, {ghost: "s1", score: 200, at: 6});
  ghosts = P.addGhost(ghosts, {ghost: "s2", score: 50, at: 7});
  const ids = LCSProgress.known(balance, LCS_MAPS);
  const ach = (res) => P.earned(balance.achievements, res, P.addMatch(null, res), ids);
  const base = Object.assign({}, result.busy_two.results);
  r.progress = {days, streak_today: P.streak(days, "2026-10-09"), streak_tomorrow: P.streak(days, "2026-10-10"),
                streak_gap: P.streak(days, "2026-10-12"),
                ghosts,
                ghost_done: ach(Object.assign({}, base, {mode: "ghost"})),
                daily_week: ach(Object.assign({}, base, {mode: "daily", reason: "dead", daily_streak: 7})),
                hardcore: ach(Object.assign({}, base, {mode: "classic", reason: "win", modifiers: 3})),
                records: P.addMatch(P.addMatch(null, Object.assign({}, base, {mode: "daily"})),
                                    Object.assign({}, base, {mode: "ghost", score: 7}))};
}

// --- the bestiary (0.6) ----------------------------------------------------------------------

// No spawns, no bosses on the clock, no arena events: only what a test puts on the arena.
const QUIET = tweak((B) => {
  B.spawn.base_per_second = 0; B.spawn.per_minute = 0; B.spawn.per_level = 0;
  B.events.first_at = 1e9; B.spawn.boss_every_minutes = 1e6;
});
function quiet(seed, immortal) {
  const game = LCS.createGame(QUIET, {seed, map: at("open")});
  game.agentEvent({kind: "prompt", session: "a", project: "a"});
  if (immortal !== false) game.dev.immortal();
  else game.state.stats.max_hp = game.state.player.hp = 1e6;
  return game;
}
const still = () => ({x: 0, y: 0});
const newest = (s, type) => s.enemies.filter((e) => e.type === type).pop();
const put = (s, e, dx, dy, extra) => Object.assign(e, {x: s.player.x + dx, y: s.player.y + dy}, extra || {});
// A bullet that hits whatever stands at `e` on the next step.
const shoot = (s, e, damage) => s.shots.push({x: e.x, y: e.y, vx: 0, vy: 0, r: 2, damage, pierce: 0,
                                              hit: new Set(), life: 0.2, color: "#fff"});
// The clock's part of the difficulty stops at growth_minutes: a grunt at that minute and one
// much later are as tough as each other.
{
  const hpAt = (minute) => {
    const game = quiet(7);
    game.state.time = minute * 60;
    game.dev.enemy("grunt");
    return newest(game.state, "grunt").maxHp;
  };
  const cap = balance.spawn.growth_minutes;
  result.growth = {early: hpAt(cap / 2), cap: hpAt(cap), late: hpAt(cap * 3)};
}
// The hero faces the way it walks; walking only up or down keeps the last side.
{
  const game = quiet(3), faces = [];
  for (const x of [-1, 0, 1, 0]) {
    stepFor(game, 0.2, () => ({x, y: x ? 0 : 1}));
    faces.push(game.state.player.face);
  }
  result.facing = faces;
}
const BE = balance.enemies;
result.bestiary = {};
// Flaky test: about half the bullets go past.
{
  const dealt = {};
  for (const type of ["grunt", "flaky"]) {
    const game = quiet(41), s = game.state;
    game.dev.enemy(type);
    const e = put(s, newest(s, type), 60, 0, {hp: 1e9, maxHp: 1e9, speed: 0, damage: 0});
    stepFor(game, 60, still);
    dealt[type] = 1e9 - e.hp;
  }
  result.bestiary.flaky = dealt.flaky / dealt.grunt;
}
// Spaghetti code leaves sauce; in it the player is slower.
{
  const game = quiet(42), s = game.state;
  s.stats.damage = 0;
  game.dev.enemy("spaghetti");
  const e = put(s, newest(s, "spaghetti"), 150, 0, {damage: 0});
  stepFor(game, 3, still);
  e.speed = 0;
  const goo = s.hazards.filter((h) => h.kind === "goo");
  Object.assign(s.player, {x: goo[0].x, y: goo[0].y});
  let x0 = s.player.x;
  game.step(DT, {x: 1, y: 0});
  const slow = s.player.x - x0;
  Object.assign(s.player, {x: 300, y: 1000});
  game.step(DT, {x: 1, y: 0});
  x0 = s.player.x;
  game.step(DT, {x: 1, y: 0});
  result.bestiary.spaghetti = {goo: goo.length, slow: slow / (s.player.x - x0)};
}
// Off-by-one stops a step short, crouches, then jumps at the player.
{
  const game = quiet(43), s = game.state;
  s.stats.damage = 0;
  game.dev.enemy("offbyone");
  const e = put(s, newest(s, "offbyone"), 100, 0, {damage: 0});
  let stopped = null, leapt = false, closest = Infinity;
  for (let i = 0; i < 60 * 5; i++) {
    game.step(DT, still());
    const d = Math.hypot(e.x - s.player.x, e.y - s.player.y);
    if (e.windupAt && stopped === null) stopped = d;
    if (e.leap) leapt = true;
    if (leapt) closest = Math.min(closest, d);
  }
  result.bestiary.offbyone = {stopped, leapt, closest};
}
// Technical debt piles up health, up to a limit.
{
  const game = quiet(44), s = game.state;
  s.stats.damage = 0;
  game.dev.enemy("debt");
  const e = put(s, newest(s, "debt"), 250, 0, {speed: 0, damage: 0});
  const hp0 = e.maxHp, score0 = e.score;
  stepFor(game, 5, still);
  const at5 = e.maxHp / hp0;
  stepFor(game, 60, still);
  result.bestiary.debt = {at5, at65: e.maxHp / hp0, score: e.score / score0};
}
// The log spammer keeps away and shoots.
{
  const game = quiet(45, false), s = game.state;
  s.stats.damage = 0;
  game.dev.enemy("logspam");
  const e = put(s, newest(s, "logspam"), 200, 0);
  let shots = 0, closest = Infinity;
  for (let i = 0; i < 60 * 10; i++) {
    game.step(DT, still());
    shots = Math.max(shots, s.enemyShots.length);
    closest = Math.min(closest, Math.hypot(e.x - s.player.x, e.y - s.player.y));
  }
  result.bestiary.logspam = {shots, hurt: s.stats.max_hp - s.player.hp, closest};
}
// A regression comes back once.
{
  const game = quiet(46), s = game.state;
  game.dev.enemy("regression");
  put(s, newest(s, "regression"), 40, 0, {hp: 1, speed: 0});
  stepFor(game, 0.5, still);
  s.stats.damage = 0;
  stepFor(game, BE.regression.return_seconds + 0.5, still);
  const back = newest(s, "regression");
  const returned = !!back && back.returned === true;
  if (back) put(s, back, 40, 0, {hp: 1, speed: 0});
  s.stats.damage = 1;
  stepFor(game, BE.regression.return_seconds + 1, still);
  result.bestiary.regression = {returned, left: s.enemies.filter((e) => e.type === "regression").length,
                                kills: s.kills};
}
// Scope creep grows in steps.
{
  const game = quiet(47), s = game.state;
  s.stats.damage = 0;
  game.dev.enemy("scope");
  const e = put(s, newest(s, "scope"), 300, 0, {speed: 0, damage: 0});
  const hp0 = e.maxHp;
  stepFor(game, BE.scope.grow_every * 3 + 1, still);
  result.bestiary.scope = {size: e.size, r: e.r / BE.scope.radius, hp: e.maxHp / hp0};
}
// The monolith lets out microservices.
{
  const game = quiet(48), s = game.state;
  s.stats.damage = 0;
  game.dev.enemy("monolith");
  put(s, newest(s, "monolith"), 300, 0, {speed: 0, damage: 0});
  stepFor(game, BE.monolith.release.every + 0.2, still);
  result.bestiary.monolith = s.enemies.filter((e) => e.type === "micro").length;
}
// Elites: a shield takes the hits first, a chest drops; a vampire heals on a hit; fast is fast.
{
  const game = quiet(49), s = game.state;
  game.dev.elite("grunt", "shielded");
  const e = put(s, newest(s, "grunt"), 60, 0, {speed: 0, damage: 0});
  const tough = e.maxHp / BE.grunt.hp;
  let hurtThroughShield = false;
  for (let i = 0; i < 60 * 10 && !e.dead; i++) {
    game.step(DT, still());
    if (e.shield > 0 && e.hp < e.maxHp) hurtThroughShield = true;
  }
  const chest = s.items.some((it) => it.type === "chest");
  const vg = quiet(50, false), v = vg.state;
  v.stats.damage = 0;
  vg.dev.elite("grunt", "vampire");
  const vamp = put(v, newest(v, "grunt"), 0, 0, {speed: 0});
  vamp.hp = vamp.maxHp / 2;
  const half = vamp.hp;
  vg.step(DT, still());
  const fg = quiet(51), f = fg.state;
  fg.dev.enemy("grunt");
  fg.dev.elite("grunt", "fast");
  const [plain, fast] = f.enemies;
  result.bestiary.elite = {tough, hurtThroughShield, dead: e.dead, chest, elites: s.elites,
                           healed: (vamp.hp - half) / vamp.maxHp, fast: fast.speed / plain.speed};
}
// Out of memory: sheds small leaks as it loses health, grows with time.
{
  const game = quiet(52), s = game.state;
  game.dev.boss("boss_oom");
  const b = put(s, newest(s, "boss_oom"), 70, 0, {speed: 0, damage: 0});
  while (b.hp > b.maxHp * 0.5 && s.time < 120) game.step(DT, still());
  s.stats.damage = 0;
  const splits = b.splits, smalls = s.enemies.filter((e) => e.type === "leak_small").length + s.kills;
  const r0 = b.r;
  stepFor(game, BE.boss_oom.grow_every + 1, still);
  result.bestiary.oom = {splits, smalls, size: b.size, r: b.r / r0};
}
// The infinite loop: the body keeps its spacing, passes hits on to the head, dies with it.
{
  const game = quiet(53), s = game.state;
  s.stats.damage = 0;
  game.dev.boss("boss_loop");
  const head = newest(s, "boss_loop"), body = s.enemies.filter((e) => e.type === "loop_segment");
  stepFor(game, 3, still);
  const gaps = body.map((seg, i) => Math.hypot(seg.x - (i ? body[i - 1] : head).x, seg.y - (i ? body[i - 1] : head).y));
  const before = head.hp;
  shoot(s, body[body.length - 1], 100);
  game.step(DT, still());
  const share = (before - head.hp) / 100;
  head.hp = 1;
  shoot(s, head, 10);
  game.step(DT, still());
  result.bestiary.loop = {segments: body.length, gap: Math.max(...gaps), share, dead: head.dead,
                          body_dead: body.every((seg) => seg.dead), bosses: s.bosses,
                          kinds: game.finish("quit").boss_kinds};
}
// Data race: one twin killed alone comes back at half health; both at once, the boss is down.
{
  const game = quiet(54), s = game.state;
  s.stats.damage = 0;
  game.dev.boss("boss_race");
  const [a, b] = s.enemies.filter((e) => e.type === "boss_race");
  const linked = a.partner === b && b.partner === a && !a.twinB && b.twinB;
  a.hp = 1;
  shoot(s, a, 10);
  game.step(DT, still());
  stepFor(game, BE.boss_race.revive_seconds + 0.5, still);
  const back = s.enemies.find((e) => e.type === "boss_race" && e !== b && !e.dead);
  const revived = !!back && back.partner === b, half = back ? back.maxHp / b.maxHp : null;
  const bossesAfterOne = s.bosses;
  back.hp = 1;
  b.hp = 1;
  shoot(s, back, 10);
  shoot(s, b, 10);
  game.step(DT, still());
  result.bestiary.race = {linked, revived, half, bosses_after_one: bossesAfterOne, bosses: s.bosses,
                          synced: s.synced, left: s.enemies.filter((e) => e.type === "boss_race").length,
                          chest: s.items.some((it) => it.type === "chest")};
}
// Prod is down: fire on the floor under the player, after a warning.
{
  const game = quiet(55, false), s = game.state;
  s.stats.damage = 0;
  game.dev.boss("boss_fire");
  put(s, newest(s, "boss_fire"), 250, 0, {speed: 0, damage: 0});
  const F = BE.boss_fire.fire;
  stepFor(game, F.warn * 0.5, still);
  const early = s.stats.max_hp - s.player.hp;
  stepFor(game, F.warn * 2, still);
  result.bestiary.fire = {fires: s.hazards.filter((h) => h.kind === "fire").length, early,
                          hurt: s.stats.max_hp - s.player.hp};
}
// Bosses come in turn: the four new ones in a random order, then the merge conflict.
{
  const game = quiet(56), s = game.state;
  s.stats.damage = 0;
  const order = [];
  for (let i = 0; i < 6; i++) {
    s.nextBoss = s.time;
    const before = new Set(s.enemies);
    game.step(DT, still());
    const fresh = s.enemies.find((e) => !before.has(e) && e.boss);
    order.push(fresh ? fresh.type : null);
  }
  result.bestiary.order = order;
}
// Arena events: a Friday deploy to live through, an incident to hold or to lose.
{
  const game = quiet(57), s = game.state;
  s.stats.damage = 0;
  game.dev.event("deploy");
  const started = !!s.deploy;
  stepFor(game, balance.events.deploy.seconds + 0.5, still);
  const deploy = {started, survived: s.deploys, over: !s.deploy};
  game.dev.event("incident");
  const z = s.incident;
  const away = Math.hypot(z.x - s.player.x, z.y - s.player.y);
  stepFor(game, balance.events.incident.hold + 0.5, (st) => { Object.assign(st.player, {x: z.x, y: z.y}); return still(); });
  // The player stands on the chest it leaves, so it is taken at once.
  const closed = s.incidents, chest = s.gear.length + s.pendingChests;
  Object.assign(s.player, {x: 800, y: 600});
  game.dev.event("incident");
  stepFor(game, balance.events.incident.seconds + 0.5, still);
  result.bestiary.events = {deploy, away, closed, chest, rage: s.rage, incidents: s.incidents, left: !!s.incident};
  // With the usual spawns, a deploy brings more enemies.
  const count = (deploying) => {
    const g = LCS.createGame(balance, {seed: 58, map: at("open"), mode: "classic"});
    g.dev.immortal();
    g.state.stats.damage = 0;
    if (deploying) g.dev.event("deploy");
    stepFor(g, 20, still);
    return g.state.enemies.length;
  };
  result.bestiary.events.crowd = count(true) / count(false);
}

// --- records and achievements --------------------------------------------------------------
{
  const P = LCSProgress, ids = P.known(balance, LCS_MAPS);
  const old = {best_score: 900, best_time: 300, best_level: 7, matches: 3, kills: 400};
  const migrated = P.migrate(old);
  const junk = P.migrate({agent: {best_score: "x"}, totals: {maps: {open: "y", legacy: 2}}});
  const won = Object.assign({}, result.classic.final.results);
  let r = P.addMatch(old, won);
  const afterWin = P.earned(balance.achievements, won, r, ids);
  for (const id of ids.maps) r = P.addMatch(r, Object.assign({}, won, {map: id, reason: "dead", bosses: 0}));
  const tourist = P.earned(balance.achievements, Object.assign({}, won, {reason: "dead"}), r, ids);
  const busy = result.busy_two.results;
  const ach = P.earned(balance.achievements, busy, P.addMatch(null, busy), ids);
  const work = Object.assign({}, busy, {commits: 5, reviews: 1});
  const worked = P.earned(balance.achievements, work, P.addMatch(null, work), ids);
  result.progress = {migrated, junk, records: r, after_win: afterWin, tourist, busy: ach, worked,
                     ids: balance.achievements.map((a) => a.id)};
  // The achievements screen: the best single match and how far each locked one is.
  const bests = P.addBests({kills: 40, junk: 3}, balance.achievements, Object.assign({}, won, {time: 900}));
  result.progress.bests = bests;
  result.progress.of = Object.fromEntries(balance.achievements.map((a) => [a.id, P.progressOf(a, r, bests, ids)]));
  result.progress.half_maps = P.progressOf(balance.achievements.find((a) => a.id === "tourist"),
                                           P.addMatch(null, won), bests, ids);
}

print(JSON.stringify(result));
