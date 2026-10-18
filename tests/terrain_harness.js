// Run by tests/test_terrain.py through jsc: the map's objects (terrain.js) one by one, with
// the game's hooks recorded, and every map's reachability with every door shut.
// Usage: jsc terrain_harness.js -- <project dir>
"use strict";
const [project] = arguments;
const GAME = project + "/game";
load(GAME + "/maps.js");
load(GAME + "/terrain.js");
load(GAME + "/modes.js");
load(GAME + "/build.js");
load(GAME + "/game.js");
const balance = JSON.parse(readFile(GAME + "/balance.json"));
const K = balance.terrain;
const DT = 1 / 60;
const result = {};

// A terrain on a bare 400×300 map with `objects`, and every hook call it makes.
function make(objects) {
  const calls = [];
  const record = (name) => (...args) => { calls.push([name, ...args]); };
  const hooks = Object.fromEntries(["explode", "hurtPlayer", "hurtEnemy", "fall", "effect", "text", "met"]
    .map((name) => [name, record(name)]));
  const map = Object.assign({width: 400, height: 300, walls: []}, objects);
  return {T: LCSTerrain.create(map, K, hooks), calls};
}
const state = (time, player, enemies) => ({time, player: Object.assign({r: 5, dead: 0}, player),
                                            allies: [], enemies: enemies || [], gems: []});
const named = (calls, name) => calls.filter((c) => c[0] === name);
const enemy = (x, y, extra) => Object.assign({x, y, r: 5, dead: false}, extra);

// --- every map: every open spot is reachable from the start with every door shut --------
// The same check as the enemies' paths: 16 px cells, blocked when a wall or a pit is within
// 6 px of the cell's middle; walking goes on the 4 straight neighbours.
result.reach = {};
for (const map of LCS_MAPS) {
  const shut = Object.assign({}, map, {walls: map.walls.concat((map.doors || []).map((d) => d.slice(0, 4))),
                                       doors: []});
  const T = LCSTerrain.create(shut, K, {});
  const C = 16, FW = Math.ceil(map.width / C), FH = Math.ceil(map.height / C);
  const free = (cx, cy) => cx >= 0 && cy >= 0 && cx < FW && cy < FH
    && !T.inWall((cx + 0.5) * C, (cy + 0.5) * C, 6, true);
  const seen = new Uint8Array(FW * FH), queue = [];
  const sx = Math.floor(map.width / 2 / C), sy = Math.floor(map.height / 2 / C);
  if (free(sx, sy)) { seen[sx + sy * FW] = 1; queue.push([sx, sy]); }
  while (queue.length) {
    const [cx, cy] = queue.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = cx + dx, y = cy + dy;
      if (free(x, y) && !seen[x + y * FW]) { seen[x + y * FW] = 1; queue.push([x, y]); }
    }
  }
  let open = 0, lost = [];
  for (let y = 0; y < FH; y++) {
    for (let x = 0; x < FW; x++) {
      if (!free(x, y)) continue;
      open++;
      if (!seen[x + y * FW]) lost.push([(x + 0.5) * C, (y + 0.5) * C]);
    }
  }
  const pads = (map.pads || []).flatMap(([x1, y1, x2, y2]) => [[x1, y1], [x2, y2]]);
  result.reach[map.id] = {start: free(sx, sy), open, lost: lost.slice(0, 5), lost_count: lost.length,
                          pads_free: pads.every(([x, y]) => !T.inWall(x, y, 6, true))};
}

// --- doors: open, a warning, shut, open again ---------------------------------------------
{
  const {T, calls} = make({doors: [[100, 100, 24, 60, 0]]});
  const at = (t) => {
    T.update(DT, state(t, {x: 300, y: 250}));
    const d = T.objects.doors[0];
    return {closed: d.closed, warn: d.warn, wall: T.inWall(112, 130, 0)};
  };
  result.door = {start: at(0), warn: at(K.door.open - K.door.warn + 0.1), shut: at(K.door.open + 0.1),
                 again: at(K.door.open + K.door.closed + 0.1), met: named(calls, "met").length > 0};
}

// --- a cracked wall: worn down by bullets, gone for good -----------------------------------
{
  const {T, calls} = make({cracks: [[100, 100, 80, 20]]});
  const hit = (damage) => T.shot({x: 140, y: 110, damage});
  const first = hit(K.crack.hp - 1);
  const standing = T.inWall(140, 110, 0);
  const second = hit(1);
  result.crack = {first, standing, second, gone: !T.inWall(140, 110, 0), after: hit(10),
                  crumble: named(calls, "effect").some((c) => c[1].type === "crumble"),
                  met: named(calls, "met").map((c) => c[1])};
  // An explosion breaks one too.
  const other = make({cracks: [[100, 100, 80, 20]]});
  other.T.blast(140, 140, 30, K.crack.hp);
  result.crack.blast = !other.T.inWall(140, 110, 0);
}

// --- a server rack: blows up, hurts whoever stands close, stands again ----------------------
{
  const {T, calls} = make({racks: [[200, 150]]});
  T.update(DT, state(0, {x: 200, y: 190}));
  T.shot({x: 200, y: 150, damage: K.rack.hp});
  const boom = named(calls, "explode")[0] || null;
  const hurt = named(calls, "hurtPlayer").map((c) => c[1]);
  const down = !T.inWall(200, 150, 0);
  // While the player stands in its place it does not come back.
  T.update(DT, state(K.rack.back + 1, {x: 200, y: 150}));
  const blockedBack = T.inWall(200, 150, 0);
  T.update(DT, state(K.rack.back + 2, {x: 330, y: 150}));
  result.rack = {boom: boom && boom.slice(1, 5), hurt, down, back_under_player: blockedBack,
                 back: T.inWall(200, 150, 0)};
  // Far from the blast the player is not hurt.
  const far = make({racks: [[200, 150]]});
  far.T.update(DT, state(0, {x: 380, y: 280}));
  far.T.shot({x: 200, y: 150, damage: K.rack.hp});
  result.rack.far_hurt = named(far.calls, "hurtPlayer").length;
}

// --- belts: carry the player and the enemies, not the rigid ones ---------------------------
{
  const {T} = make({belts: [[0, 100, 400, 40, "r"], [0, 200, 400, 40, "u"]]});
  const s = state(0, {x: 100, y: 120}, [enemy(100, 130), enemy(100, 125, {rigid: true}), enemy(100, 220)]);
  for (let i = 0; i < 60; i++) { s.time += DT; T.update(DT, s); }
  result.belt = {player: [s.player.x, s.player.y], enemies: s.enemies.map((e) => [e.x, e.y])};
}

// --- vents: groups burn in turn; the fire hurts the player and the enemies ------------------
{
  const vents = [[50, 50, 60, 20, 0], [250, 50, 60, 20, 1]];
  const {T, calls} = make({vents});
  const slot = K.vent.every / 2;
  const look = (t) => {
    calls.length = 0;
    const s = state(t, {x: 80, y: 60}, [enemy(280, 60)]);
    T.update(DT, s);
    return {states: T.objects.vents.map((v) => v.state), player: named(calls, "hurtPlayer").map((c) => c[1]),
            enemy: named(calls, "hurtEnemy").map((c) => c[2])};
  };
  result.vent = {warn: look(0.1), burn0: look(K.vent.warn + 0.1), burn1: look(slot + K.vent.warn + 0.1),
                 idle: look(K.vent.warn + K.vent.burn + 0.1)};
}

// --- pits: enemies fall, bosses don't; the player is pushed out; a blast throws enemies ------
{
  const {T, calls} = make({pits: [[100, 100, 80, 80]]});
  const s = state(0, {x: 300, y: 250}, [enemy(140, 140), enemy(140, 140, {boss: true}), enemy(140, 140, {ghost: true}),
                                         enemy(250, 250)]);
  T.update(DT, s);
  const fell = named(calls, "fall").map((c) => s.enemies.indexOf(c[1]));
  const p = {x: 140, y: 102};
  T.pushOut(p, 5, true);
  const kicked = enemy(90, 140);
  T.knock(kicked, 60, 140);
  result.pit = {fell, player_out: !T.inWall(p.x, p.y, 4, true), walls_only: T.inWall(140, 140, 0),
                knocked: kicked.x - 90};
  // Without pits a blast throws no one.
  const none = make({}), still = enemy(90, 140);
  none.T.knock(still, 60, 140);
  result.pit.flat_knock = still.x - 90;
}

// --- pads: to the twin, no bouncing back, again after stepping off ---------------------------
{
  const {T} = make({pads: [[50, 50, 350, 250]]});
  const s = state(0, {x: 50, y: 50});
  T.update(DT, s);
  const first = [s.player.x, s.player.y];
  s.time = K.pad.cooldown + 1;
  T.update(DT, s);
  const stays = [s.player.x, s.player.y];
  s.player.x = 300;
  s.time += DT;
  T.update(DT, s);
  s.player.x = 350;
  s.time += K.pad.cooldown + 0.1;
  T.update(DT, s);
  result.pad = {first, stays, back: [s.player.x, s.player.y]};
}

// --- whole games on the new maps -----------------------------------------------------------
{
  // Cloud: an enemy in a pit is gone, counted as a kill.
  const cloud = LCS_MAPS.find((m) => m.id === "cloud"), [px, py, pw, ph] = cloud.pits[0];
  const game = LCS.createGame(balance, {seed: 3, map: cloud});
  const s = game.state;
  game.dev.immortal();
  const e = {type: "tank", x: px + pw / 2, y: py + ph / 2, r: 9, hp: 1e9, maxHp: 1e9, speed: 0, damage: 0,
             score: 0, slow: 0, slowFactor: 1, flash: 0, dead: false, incoming: 0};
  s.enemies.push(e);
  game.step(DT, {x: 0, y: 0});
  result.cloud = {dead: e.dead, kills: s.kills, fall: s.effects.some((fx) => fx.type === "fall"),
                  met: Boolean(s.met.pit)};
  // The night office says it is dark at once.
  const night = LCS.createGame(balance, {seed: 3, map: LCS_MAPS.find((m) => m.id === "night")});
  night.step(DT, {x: 0, y: 0});
  result.night = {met: Boolean(night.state.met.dark), dark: night.state.map.terrain.dark};
}

print(JSON.stringify(result));
