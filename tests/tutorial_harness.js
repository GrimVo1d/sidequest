// Run by tests/test_tutorial.py through jsc: the first match's tutorial (tutorial.js) followed
// step by step on a real match.
// Usage: jsc tutorial_harness.js -- <project dir>
"use strict";
const [project] = arguments;
const GAME = project + "/game";
for (const f of ["maps", "terrain", "modes", "build", "events", "trials", "weapons", "allies", "classes", "tutorial", "game"]) load(`${GAME}/${f}.js`);
const balance = JSON.parse(readFile(GAME + "/balance.json"));
const DT = 1 / 60;
const OPEN = LCS_MAPS.find((m) => m.id === "open");
const result = {};

// Walks in a circle, so it keeps moving without leaving the arena, and records which step is
// on at each moment. `ally`: an agent session is on the field from the start.
function follow(options, has, act, ally) {
  const game = LCS.createGame(balance, Object.assign({seed: 3, map: OPEN, mode: "classic"}, options));
  const s = game.state, lesson = LCSTutorial.create(balance.tutorial, has);
  if (ally) game.agentEvent({t: 0, kind: "session_start", session: "a", project: "a"});
  const order = [], at = {};
  let step = null;
  game.dev.immortal();
  for (let i = 0; i < 60 * 240 && !lesson.done && !s.over; i++) {
    const a = i * DT;
    game.step(DT, {x: Math.cos(a), y: Math.sin(a)});
    if (s.choices) game.choose(0);
    if (act) act(game, step);
    step = lesson.update(s);
    if (step && order[order.length - 1] !== step.id) {
      order.push(step.id);
      at[step.id] = {time: s.time, kills: s.kills, level: s.level, count: step.count, index: step.index,
                     name: step.name, text: step.text};
    }
  }
  return {order, at, done: lesson.done, time: s.time, kills: s.kills, level: s.level,
          after: lesson.update(s), allies: s.allies.length};
}

result.developer = follow({cls: "developer"}, {ability: false, agent: false, gems: true});
// A step whose goal was met before it came is passed at once: the ability is used on its step.
const useAbility = (game, step) => {
  if (step && step.id === "ability") game.ability();
};
result.junior = follow({cls: "junior", mode: "agent"}, {ability: true, agent: true}, useAbility, true);
// The allies' step is skipped while no agent is on the field.
result.alone = follow({cls: "junior", mode: "agent"}, {ability: true, agent: true}, useAbility, false);
result.allies = result.junior.allies;
result.covers = [...LCSTutorial.create(balance.tutorial, {ability: true, agent: true, gems: true}).covers];
result.plainCovers = [...LCSTutorial.create(balance.tutorial, {gems: true}).covers];
// A jump between two updates (the next campaign stage) does not count as walking.
result.jump = (() => {
  const lesson = LCSTutorial.create(balance.tutorial, {}), s = {player: {x: 0, y: 0}, time: 0, kills: 0, level: 1};
  lesson.update(s);
  s.player.x = 1000;
  return lesson.update(s).id;
})();
result.none = LCSTutorial.create({steps: []}, {}).done;

print(JSON.stringify(result));
