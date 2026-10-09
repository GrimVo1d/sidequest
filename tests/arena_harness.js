// Run by tests/test_arena.py through jsc: plays whole matches of Last Commit Standing
// with a simple bot and prints a summary as JSON.
// Usage: jsc arena_harness.js -- <project dir>
"use strict";
const [project] = arguments;
const DLC = project + "/dlc/last-commit-standing";
load(DLC + "/maps.js");
load(DLC + "/game.js");
const balance = JSON.parse(readFile(DLC + "/balance.json"));
const DT = 1 / 60;

function readScenario(name) {
  return readFile(project + "/dev/scenarios/" + name + ".jsonl").split("\n")
    .map((l) => l.trim()).filter((l) => l && !l.startsWith("//")).map((l) => JSON.parse(l));
}

// Moves away from the closest enemies, drifting around the arena centre.
function bot(s) {
  let x = 0, y = 0;
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

function play(events, maxTime, seed, map) {
  const game = LCS.createGame(balance, {seed, map});
  const s = game.state;
  let i = 0, steps = 0, maxEnemies = 0, bad = null, choicesSeen = 0, firstLevelAt = null;
  let reloads = 0, leaked = 0, inWalls = 0;
  const start = Date.now();
  while (!s.over && s.time < maxTime) {
    while (i < events.length && events[i].t <= s.time) game.agentEvent(events[i++]);
    if (s.choices) { choicesSeen++; game.choose(steps % s.choices.length); }
    const wasReloading = s.player.reload > 0;
    game.step(DT, bot(s));
    steps++;
    if (!wasReloading && s.player.reload > 0) reloads++;
    // Damage "in flight" must belong to a shot that is still flying.
    if (steps % 600 === 0) {
      leaked += s.enemies.filter((e) => e.incoming > 0.001 && !s.shots.some((sh) => sh.aim === e)).length;
      inWalls += s.enemies.filter((e) => inWall(s, e)).length + (inWall(s, s.player) ? 1 : 0);
    }
    if (s.level > 1 && firstLevelAt === null) firstLevelAt = s.time;
    maxEnemies = Math.max(maxEnemies, s.enemies.length);
    if (!bad) {
      const p = s.player;
      if (![p.x, p.y, p.hp, s.score].every(Number.isFinite)) bad = "player " + JSON.stringify(p);
      for (const e of s.enemies) if (!Number.isFinite(e.x + e.y + e.hp)) bad = "enemy " + e.type;
    }
  }
  return {over: s.over, results: s.results, time: Math.round(s.time), level: s.level,
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

print(JSON.stringify(result));
