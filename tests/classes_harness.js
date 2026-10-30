// Run by tests/test_classes.py through jsc: the classes and their abilities (classes.js),
// the campaign's stages (modes.js) and the stars with the collection (meta.js).
// Usage: jsc classes_harness.js -- <project dir>
"use strict";
const [project] = arguments;
const GAME = project + "/game";
for (const f of ["maps", "terrain", "modes", "build", "events", "trials", "weapons", "allies", "classes", "game", "progress", "meta"]) load(`${GAME}/${f}.js`);
const balance = JSON.parse(readFile(GAME + "/balance.json"));
const DT = 1 / 60;
const OPEN = LCS_MAPS.find((m) => m.id === "open");
const result = {};

const make = (options) => LCS.createGame(balance, Object.assign({seed: 5, map: OPEN, mode: "classic"}, options));
function run(game, seconds, input) {
  for (let t = 0; t < seconds && !game.state.over; t += DT) {
    game.step(DT, input || {x: 0, y: 0});
    if (game.state.choices) game.choose(0);
  }
}

// --- the classes: stats, weapons, abilities ------------------------------------------------
result.start = {};
for (const c of balance.classes) {
  const s = make({cls: c.id}).state;
  result.start[c.id] = {cls: s.cls.id, weapons: s.weapons.map((w) => w.id), hp: s.player.hp,
                        max_hp: s.stats.max_hp, xp: s.stats.xp, ability: s.cls.ability};
}
result.start.unknown = make({cls: "nope"}).state.cls.id;

{
  // Junior: experience comes 1.5 times; "Google it" pulls every crystal and item.
  const game = make({cls: "junior"}), s = game.state;
  game.dev.level();
  game.choose(0);
  s.gems.push({x: 100, y: 100, xp: 1, pull: false});
  s.items.push({type: "coffee", x: 1500, y: 1100, t: 0, life: 100});
  const used = game.ability(), again = game.ability();
  result.junior = {level: s.level, pulled: s.gems.every((g) => g.pull),
                   item_at_player: s.items.every((it) => it.x === s.player.x && it.y === s.player.y),
                   used, again, ready: s.cls.ready};
}
{
  // Frontender: the dash goes ~100 points along the movement and nothing hits meanwhile.
  const game = make({cls: "frontender"}), s = game.state;
  game.dev.immortal();
  game.step(DT, {x: 1, y: 0});
  const x0 = s.player.x;
  game.ability();
  for (let i = 0; i < 30; i++) game.step(DT, {x: 0, y: 0});
  result.dash = {moved: s.player.x - x0, invulnerable_during: true, again: game.ability()};
  const g2 = make({cls: "frontender"});
  g2.step(DT, {x: 0, y: 1});
  g2.ability();
  g2.step(DT, {x: 0, y: 0});
  result.dash.invulnerable_during = g2.state.player.invulnerable > 0;
}
{
  // Backender: turrets of its own, two at most.
  const game = make({cls: "backender"}), s = game.state;
  const counts = [];
  for (let i = 0; i < 3; i++) {
    s.cls.ready = 0;
    game.ability();
    counts.push(s.turrets.filter((t) => t.own).length);
  }
  result.turret = {counts, seconds: s.turrets[0].until - s.turrets[0].born};
}
{
  // DevOps: back to where the player was 3 seconds ago, with the health of then.
  const game = make({cls: "devops"}), s = game.state;
  game.dev.immortal();
  run(game, 0.5, {x: 0, y: 0});
  const start = {x: s.player.x, y: s.player.y};
  run(game, 3, {x: 1, y: 0});
  s.player.hp = 40;
  const before = s.player.x;
  game.ability();
  result.rollback = {away: before - start.x, back: Math.abs(s.player.x - start.x), hp: s.player.hp,
                     invulnerable: s.player.invulnerable};
}
{
  // Tester: 15% of hits are critical; during the test run all of them.
  const game = make({cls: "tester"}), s = game.state;
  const dummy = () => ({type: "tank", x: 830, y: 600, r: 9, hp: 1e9, maxHp: 1e9, speed: 0, damage: 0, score: 0,
                        slow: 0, slowFactor: 1, flash: 0, dead: false, incoming: 0});
  let hits = 0;
  game.dev.immortal();
  s.enemies.push(dummy());
  run(game, 20, {x: 0, y: 0});
  hits = s.crits;
  const g2 = make({cls: "developer"});
  g2.state.enemies.push(dummy());
  run(g2, 20, {x: 0, y: 0});
  result.crit = {tester: hits, developer: g2.state.crits || 0};
  // The test run: every hit in its seconds is critical.
  const g3 = make({cls: "tester"}), s3 = g3.state, e = dummy();
  s3.enemies.push(e);
  g3.ability();
  const crits0 = s3.crits || 0;
  run(g3, 1, {x: 0, y: 0});
  result.crit.test_run = {crits: (s3.crits || 0) - crits0, lost: 1e9 - e.hp, until: s3.cls.until};
}

// --- the stars' bonuses -------------------------------------------------------------------
{
  const s = make({perks: {hp: 2, damage: 1, rerolls: 1, speed: 99, nope: 3}}).state;
  result.perks = {max_hp: s.stats.max_hp, hp: s.player.hp, damage: s.stats.damage, rerolls: s.rerolls,
                  speed: s.stats.speed};
}

// --- the campaign: five stages, the build comes along --------------------------------------
{
  const stages = [];
  let carry = null, last = null;
  for (let i = 0; i < balance.campaign.stages.length; i++) {
    const st = balance.campaign.stages[i];
    const game = make({mode: "campaign", stage: i, carry, cls: "tester",
                       map: LCS_MAPS.find((m) => m.id === st.map), seed: 10 + i});
    const s = game.state;
    const at = {time: s.time, level: s.level, weapons: s.weapons.length, score: Math.floor(s.score),
                final_at: s.finalAt, map: s.map.id, hp: s.player.hp, max_hp: s.stats.max_hp};
    game.dev.immortal();
    s.stats.damage *= 1e4;
    run(game, balance.campaign.stage_seconds + 120, {x: 0, y: 0});
    stages.push({at, over: s.over, reason: s.results && s.results.reason, stage: s.results && s.results.stage,
                 end_time: s.time, level: s.level, finals: s.met.final === true});
    // A game's own damage boost is not part of the run: undo it before carrying on.
    s.stats.damage /= 1e4;
    carry = LCSModes.carry(s);
    last = s.results;
  }
  result.campaign = {stages, last};
  // A stage index out of range plays as a plain classic run.
  result.campaign.out_of_range = make({mode: "campaign", stage: 9}).state.stage || null;
}

// --- stars and the collection -------------------------------------------------------------
{
  const S = balance.stars;
  result.stars = {
    lost_early: LCSMeta.starsFor(S, {mode: "classic", reason: "dead", time: 100, bosses: 0}),
    classic_win: LCSMeta.starsFor(S, {mode: "classic", reason: "win", time: 1200, bosses: 4}),
    campaign_third: LCSMeta.starsFor(S, {mode: "campaign", reason: "dead", stage: 3, time: 600, bosses: 2}),
    capped: LCSMeta.starsFor(S, {mode: "campaign", reason: "win", stage: 5, time: 3600, bosses: 20}),
  };
  let meta = LCSMeta.clean({stars: 7, perks: {hp: 99, __proto__: {x: 1}, nope: 2}, weapons: {pistol: "x"}}, balance);
  result.meta = {clean: JSON.parse(JSON.stringify(meta)), safe: ({}).x === undefined};
  meta = LCSMeta.clean({stars: 7}, balance);
  const bought = LCSMeta.buy(meta, balance, "damage");
  const second = LCSMeta.buy(bought.meta, balance, "damage");
  const third = LCSMeta.buy(second.meta, balance, "damage");
  result.meta.buy = [bought.ok, second.ok, third.ok, third.meta.stars, third.meta.perks.damage,
                     LCSMeta.price(balance, third.meta, "damage")];
  result.meta.unknown = LCSMeta.buy(meta, balance, "nope").ok;
  const found = LCSMeta.addMatch(null, balance, {mode: "classic", reason: "dead", time: 60, bosses: 0,
                                                 weapon_ids: ["pistol", "laser", "nope"], evolved_ids: ["laser"]});
  result.meta.found = found;
}

// --- achievements of the classes ----------------------------------------------------------
{
  // Full stack: a match with each class, counted in the records' totals.
  const full = balance.achievements.find((a) => a.id === "fullstack");
  let records = LCSProgress.migrate({totals: {matches: 1, classes: {__proto__: 3, developer: 2, nope: "x"}}});
  const known = LCSProgress.known(balance, LCS_MAPS);
  // Names that are no class (left by an older version, or edited in) do not count.
  const strangers = LCSProgress.migrate({totals: {classes: {a: 1, b: 1, c: 1, d: 1, e: 1, f: 1}}});
  result.strangers = LCSProgress.earned([full], {}, strangers, known).length;
  const steps = [];
  for (const c of balance.classes) {
    records = LCSProgress.addMatch(records, {mode: "classic", reason: "dead", time: 60, score: 0, level: 1,
                                             kills: 0, map: "open", class: c.id});
    steps.push([LCSProgress.earned([full], {}, records, known).length, LCSProgress.progressOf(full, records, {}, known).have]);
  }
  // Hotkeys: the ability's uses go into the match's results.
  const game = make({cls: "junior"}), s = game.state;
  for (let i = 0; i < 3; i++) {
    s.cls.ready = 0;
    game.ability();
  }
  result.awards = {steps, classes: Object.keys(records.totals.classes).sort(), safe: ({}).developer === undefined,
                   abilities: game.finish("quit").abilities};
}

print(JSON.stringify(result));
