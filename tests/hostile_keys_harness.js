// Run by tests/test_hostile_keys.py through jsc: the arena plays events whose ids, names
// and kinds are the names of Object.prototype members, which a plain table lookup would
// find. Usage: jsc hostile_keys_harness.js -- <project dir>
"use strict";
const [project] = arguments;
const hostile = ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"];
function events() {
  const out = [];
  let t = 0.1;
  for (const h of hostile) {
    const sid = h;   // session id, project, file, tool, agent, agent_type all hostile
    const base = {session: sid, project: h};
    out.push(Object.assign({t: t += 0.1, kind: "session_start", joined: false, source: h}, base));
    out.push(Object.assign({t: t += 0.1, kind: "prompt"}, base));
    out.push(Object.assign({t: t += 0.1, kind: "tool", tool: h, action: "attack", ok: true, file: h + "/" + h, lines_added: 3, lines_removed: 1, agent: null}, base));
    out.push(Object.assign({t: t += 0.1, kind: "tool", tool: "Bash", action: "cast", category: "git", git: [h], ok: true, agent: null}, base));
    out.push(Object.assign({t: t += 0.1, kind: "subagent_start", agent: h, agent_type: h}, base));
    out.push(Object.assign({t: t += 0.1, kind: "tool", tool: h, action: "scout", ok: true, file: h, agent: h}, base));
    out.push(Object.assign({t: t += 0.1, kind: "tool_error", tool: h, action: h, category: h, ok: false, exit_code: 1, agent: null}, base));
    out.push(Object.assign({t: t += 0.1, kind: "blocked", tool: h, reason: h, agent: null}, base));
    out.push(Object.assign({t: t += 0.1, kind: "compact", phase: "start", trigger: h}, base));
    out.push(Object.assign({t: t += 0.1, kind: "compact", phase: "end", trigger: h}, base));
    out.push(Object.assign({t: t += 0.1, kind: "subagent_stop", agent: h, agent_type: h}, base));
    out.push(Object.assign({t: t += 0.1, kind: h}, base));
    out.push(Object.assign({t: t += 0.1, kind: "unknown", event: h}, base));
  }
  for (let k = 0; k < 40; k++) out.push({t: t += 0.1, kind: "tool", session: "act", project: "act", tool: "Edit", action: k % 2 ? "constructor" : "__proto__", ok: true, file: "a/b", agent: null});
  out.push({t: t += 0.1, kind: "tool", session: "x", project: "x", tool: "Edit", action: "attack", ok: true, file: 123, agent: {a: 1}});
  return out;
}
function play(name, game, extra) {
  const s = game.state, evs = events();
  let i = 0, err = null, steps = 0;
  try {
    while (s.time < 40 && !s.over) {
      while (i < evs.length && evs[i].t <= s.time) game.agentEvent(evs[i++]);
      if (s.choices && game.choose) game.choose(0);
      if (game.talentTier && game.talentTier() >= 0) game.talent(0);
      game.step(1 / 60, extra(s));
      if (++steps > 20000) { err = "stuck at t=" + s.time; break; }
    }
  } catch (e) { err = String(e) + " " + (e.stack || "").split("\n")[0]; }
  const oddMet = Object.keys(s.met || {}).filter((k) => /function|object/i.test(k));
  // No class yet is null; a class found on Object.prototype would be a function.
  const oddCls = (s.agents || s.heroes || s.allies || []).map((a) => a.cls)
    .filter((c) => c !== undefined && c !== null && typeof c !== "string");
  // The keys an agent's working style is counted under ("read", "edit", ...).
  const mixKeys = new Set();
  for (const a of s.agents || s.heroes || []) for (const k of Object.keys(a.mix || {})) mixKeys.add(k);
  print(JSON.stringify({game: name, events: i, error: err, oddMet, oddCls: oddCls.length,
                        mixKeys: [...mixKeys].sort()}));
}
{
  const D = project + "/game";
  load(D + "/maps.js"); load(D + "/game.js");
  const B = JSON.parse(readFile(D + "/balance.json"));
  play("arena", LCS.createGame(B, {seed: 1, mode: "agent"}), () => ({x: 0, y: 0}));
}
