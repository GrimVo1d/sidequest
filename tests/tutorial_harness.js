// Run by tests/test_tutorial.py through jsc: the first match's tutorial (tutorial.js) followed
// step by step on a real match.
// Usage: jsc tutorial_harness.js -- <project dir>
"use strict";
const [project] = arguments;
const GAME = project + "/game";
for (const f of ["maps", "terrain", "modes", "build", "classes", "tutorial", "game"]) load(`${GAME}/${f}.js`);
const balance = JSON.parse(readFile(GAME + "/balance.json"));
const DT = 1 / 60;
const OPEN = LCS_MAPS.find((m) => m.id === "open");
const result = {};

// Walks in a circle, so it keeps moving without leaving the arena, and records which step is
// on at each moment.
function follow(options, has, act) {
  const game = LCS.createGame(balance, Object.assign({seed: 3, map: OPEN, mode: "classic"}, options));
  const s = game.state, lesson = LCSTutorial.create(balance.tutorial, has);
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
          after: lesson.update(s)};
}

result.developer = follow({cls: "developer"}, {ability: false, agent: false});
// A step whose goal was met before it came is passed at once: the ability is used on its step.
result.junior = follow({cls: "junior"}, {ability: true, agent: true}, (game, step) => {
  if (step && step.id === "ability") game.ability();
});
result.none = LCSTutorial.create({steps: []}, {}).done;

print(JSON.stringify(result));
