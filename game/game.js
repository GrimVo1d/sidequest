// The arena: the simulation. No DOM here, so tests run it in jsc.
//   const game = LCS.createGame(balance, {seed: 1, map: LCS_MAPS[0], mode: "agent"});
//                                 // maps.js; mode "agent", "classic" (alone, 20 minutes),
//                                 // "daily" (classic with the day's seed, LCS.daily) or
//                                 // "ghost" (a past session plays the ally: ghost.events) or
//                                 // "campaign" (stage, carry: modes.js) or "infinity"
//                                 // (classic with no end but death) or "trials" (trial:
//                                 // an id of balance.trials, trials.js); modifiers: ids
//                                 // from balance.modifiers; cls, perks: classes.js
//   game.agentEvent(event)        // a game event from Sidequest.on("*")
//   game.step(1 / 60, {x, y})      // input: movement direction, each -1..1
//   game.state                     // everything render.js draws
"use strict";

(function (root) {
  const ALLY_COLORS = ["#4fbf6f", "#5b8bd0", "#d07ad0", "#e89a4a", "#7fe0e0", "#e86a6a"];
  // Texts on the arena in the chosen language; jsc tests run without i18n.js.
  const tr = (ru, en) => root.SidequestI18n ? root.SidequestI18n.t(ru, en) : ru;
  const REJOIN_KINDS = new Set(["session_start", "prompt", "tool", "tool_error",
                                "subagent_start", "compact"]);
  const {MODES, makeRandom, ghostSchedule} = root.LCSModes;
  const {MUL_KEYS} = root.LCSBuild;   // weapon stats that multiply rather than add

  const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function createGame(B, options) {
    const random = makeRandom((options && options.seed) || Date.now());
    const map = (options && options.map)
      || {id: "open", name: "Open space", width: B.arena.width, height: B.arena.height, walls: []};
    const W = map.width, H = map.height;
    const T = root.LCSTerrain.create(map, B.terrain, {
      explode, hurtPlayer, hurtEnemy, fall, effect, text, met: (id) => { s.met[id] = true; }});
    const A = B.abilities, C = B.classic, AG = B.agent;
    const WEAPONS = new Map(B.weapons.map((w) => [w.id, w]));
    const PISTOL = WEAPONS.get("pistol").base;
    const CELL = 32;   // px per cell of the enemies' grid for nearby()
    const TEXT_PILE = 5;   // floating texts over one spot at once
    const modeName = Object.hasOwn(MODES, options && options.mode) ? options.mode : "agent";
    // Classic, the daily task, the campaign and Infinity are played alone: crystals, a final
    // boss, death ends it. Only the ghost's own events reach a ghost match; the daily task
    // ignores agents. Infinity goes on after its final boss.
    const {solo: classic, agents: ownAgents, endless} = MODES[modeName];
    const trial = modeName === "trials" ? root.LCSTrials.byId(B, options.trial) : null;
    const stage = root.LCSModes.stage(B, options);
    const MODS = new Set((options && options.modifiers || []).filter((id) => B.modifiers.some((m) => m.id === id)));
    const mod = (id) => (MODS.has(id) ? B.modifiers.find((m) => m.id === id) : null);
    const EV = B.events, EL = B.elites, OT = B.infinity.overtime;
    // Bosses come in turn: the new ones in a random order, then the merge conflict, again.
    const bossOrder = B.bosses.order.slice();
    for (let i = bossOrder.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [bossOrder[i], bossOrder[j]] = [bossOrder[j], bossOrder[i]];
    }
    bossOrder.push(B.bosses.then);
    const ghost = modeName === "ghost"
      ? {queue: ghostSchedule(B.ghost, options.ghost && options.ghost.events), index: 0,
         session: options.ghost && options.ghost.session || null}
      : null;

    const s = {
      time: 0, over: false, finaleAt: null, endAt: null, endReason: null, results: null,
      immortal: false, mode: modeName, solo: classic, withAgent: false,
      modifiers: [...MODS],
      scoreMul: [...MODS].reduce((k, id) => k * mod(id).score, 1),
      day: (options && options.day) || null,
      view: {width: B.view.width, height: B.view.height},
      map: {id: map.id, name: map.name, name_en: map.name_en, theme: map.theme || "office", width: W, height: H,
            walls: T.still, special: map.special || null, terrain: T.objects},
      player: {x: W / 2, y: H / 2, r: B.player.radius, hp: B.player.hp, invulnerable: 0,
               dead: 0, sticky: 1, ammo: PISTOL.magazine, magazine: PISTOL.magazine, reload: 0,
               reloadTotal: 0, shield: 0, moving: false, face: 1, aim: 0, firedAt: -1, hurtAt: -1},
      // Passives and gear: multipliers and bonuses on top of every weapon (see weaponStats).
      stats: {damage: 1, cooldown: 1, amount: 0, area: 1, pierce: 0, magazine: 0, reload: 1, xp: 1,
              speed: B.player.speed, max_hp: B.player.hp, regen: 0,
              ally_damage: 1, ally_missiles: 0,
              pickup: 0, rage: 1, shield_bonus: 0, coffee: 1},
      // Weapons held, in the order taken; the pistol is always the first.
      weapons: [{id: "pistol", level: 1, evolved: false, timer: 0}],
      taken: {},  // passive id -> level
      level: 1, xp: 0, xpNext: B.xp.first_level, pendingLevels: 0, choices: null,
      choiceKind: null, pendingChests: 0, gear: [], gearLevels: {},
      rerolls: B.build.rerolls, banishes: B.build.banishes, banished: [],
      enemies: [], shots: [], mines: [], turrets: [], effects: [], texts: [], allies: [], items: [],
      gems: [],
      // The bestiary (0.6): sticky goo and fire on the floor, log lines in flight, regressions
      // about to come back, arena events.
      hazards: [], enemyShots: [], comebacks: [], bossIndex: 0,
      deploy: null, incident: null, eventAt: EV.first_at, nextEvent: null,
      elites: 0, incidents: 0, deploys: 0, bossKinds: {},
      buffs: {coffee: 0, duck: 0}, itemAt: B.items.every_seconds,
      spawnAcc: 0, nextBoss: B.spawn.boss_every_minutes * 60, rage: 0,
      // When the final boss comes; null once it is up (and in the modes with agents), Infinity
      // in a trial without one.
      finalAt: classic ? C.seconds : null,
      score: 0, kills: 0, damageTaken: 0, deaths: 0, streak: 0, streakTimer: 0,
      bestStreak: 0, multiplier: 1, maxMultiplier: 1, everAlly: false, bosses: 0, picked: 0,
      met: {},  // what the player has met this match (codex.js ids): first-time hints
      evolutions: 0,
      synced: 0,
      // The agent's real work (0.4): red CI after failed tests, the orchestra of 3+ agents.
      redCi: 0, orchestra: false, pushChestAt: 0,
      commits: 0, pushes: 0, turretsBuilt: 0, reviews: 0,
    };
    s.nextEvent = random() < 0.5 ? "deploy" : "incident";
    const bySession = new Map();
    let grid = new Map();
    if (mod("glass_cannon")) {
      s.stats.damage *= mod("glass_cannon").damage;
      s.stats.max_hp *= mod("glass_cannon").max_hp;
      s.player.hp = s.stats.max_hp;
    }

    // --- helpers -----------------------------------------------------------------

    // A floating text over (x, y), above the ones already there; a pile over one spot keeps
    // at most TEXT_PILE of them, so the oldest goes first.
    function text(x, y, value, color, life) {
      const pile = s.texts.filter((o) => Math.abs(o.x - x) < 48 && Math.abs(o.y - o.t * 14 - y) < 9 * TEXT_PILE);
      if (pile.length >= TEXT_PILE) s.texts.splice(s.texts.indexOf(pile.reduce((a, b) => (b.t > a.t ? b : a))), 1);
      for (let moved = true, i = 0; moved && i < 8; i++) {
        moved = false;
        for (const o of s.texts) {
          const oy = o.y - o.t * 14;
          if (Math.abs(o.x - x) < 48 && Math.abs(oy - y) < 9) { y = oy - 9; moved = true; }
        }
      }
      s.texts.push({x, y, text: value, color: color || "#e8e6f0", t: 0, life: life || 1.2});
    }
    function effect(e) { s.effects.push(Object.assign({t: 0, life: 0.4}, e)); }

    function rebuildGrid() {
      grid = new Map();
      for (const e of s.enemies) {
        const key = Math.floor(e.x / CELL) + Math.floor(e.y / CELL) * 4096;
        let cell = grid.get(key);
        if (!cell) grid.set(key, cell = []);
        cell.push(e);
      }
    }

    function nearby(x, y, r, fn) {
      const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
      const y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL);
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const cell = grid.get(cx + cy * 4096);
          if (cell) for (const e of cell) if (!e.dead) fn(e);
        }
      }
    }

    // `sight`: only enemies with no wall in between, for bullets that stop at walls.
    function nearestEnemies(from, n, range, sight) {
      const r2 = range * range;
      const near = s.enemies.filter((e) => !e.dead && dist2(e, from) <= r2)
        .sort((a, b) => dist2(a, from) - dist2(b, from));
      return sight ? firstInSight(near, from, n) : near.slice(0, n);
    }

    const I = B.items;
    const speed = () => s.stats.speed * (s.buffs.coffee > 0 ? I.coffee.speed : 1) * s.player.sticky;

    // --- walls: terrain.js ----------------------------------------------------------

    const {inWall, pushOut, clearPath, toWall, inSight, firstInSight} = T;
    const updateFlow = () => T.updateFlow(s.player);
    const waypoint = (e) => T.waypoint(e, s.player);

    // --- enemies -----------------------------------------------------------------

    // Spawns an enemy just off screen, or at `at` (moved out of the walls); `extra` is merged
    // into it. Returns the enemy, or nothing when there was no room.
    function spawn(type, at, extra) {
      const cfg = B.enemies[type], minute = clockMinute();
      let x, y;
      if (at) {
        ({x, y} = at);
      } else {
        // Just off screen, outside walls; give up after a few tries.
        let tries = 0;
        do {
          const angle = random() * Math.PI * 2;
          const d = Math.hypot(s.view.width, s.view.height) / 2 + 20 + random() * 40;
          x = clamp(s.player.x + Math.cos(angle) * d, cfg.radius, W - cfg.radius);
          y = clamp(s.player.y + Math.sin(angle) * d, cfg.radius, H - cfg.radius);
        } while (inWall(x, y, cfg.radius, true) && ++tries < 10);
        if (tries >= 10) return null;
      }
      // Difficulty follows both the clock and the player's level, so a busy agent
      // (many level-ups) and a slow one both keep the arena tense; Infinity's overtime adds on.
      const over = overtimeMinutes();
      const hp = cfg.hp * (1 + B.spawn.hp_growth_per_minute * minute
                           + B.spawn.hp_growth_per_level * (s.level - 1)) * (1 + OT.hp_per_minute * over);
      const speed = cfg.speed * (1 + Math.min(B.spawn.max_speed_growth,
                                              B.spawn.speed_growth_per_minute * minute));
      const damage = cfg.damage * (1 + B.spawn.damage_growth_per_minute * minute) * (1 + OT.damage_per_minute * over);
      const e = Object.assign({type, x, y, r: cfg.radius, hp, maxHp: hp, speed, damage,
                               score: cfg.score, slow: 0, slowFactor: 1,
                               flash: 0, dead: false, incoming: 0, born: s.time, hitAt: {}},
                              extra);
      if (at) pushOut(e, e.r);
      if (e.hpScale) { e.hp *= e.hpScale; e.maxHp = e.hp; }
      if (mod("code_review")) { e.hp *= mod("code_review").enemy_hp; e.maxHp = e.hp; }
      if (cfg.boss) e.boss = true;
      if (cfg.ghost) e.ghost = true;
      if (cfg.blink_every) e.blinkAt = s.time + cfg.blink_every * (0.5 + random());
      if (cfg.growth) e.baseHp = e.hp;
      if (cfg.max_size) e.size = 1;
      if (cfg.split_every) e.splits = 0;
      if (cfg.release) e.releaseAt = s.time + cfg.release.every;
      if (cfg.fire_every) e.fireAt = s.time + cfg.fire_every * random();
      if (cfg.fire) { e.fireAt = s.time + cfg.fire.warn; e.trailAt = s.time; }
      s.enemies.push(e);
      s.met[e.final ? "final" : type] = true;
      return e;
    }

    // Race condition comes in pairs: the twin of one killed alone comes back.
    function spawnPair(type) {
      const a = spawn(type);
      if (!a) return null;
      const b = spawn(type, {x: a.x + Math.max(14, a.r * 2.5), y: a.y + a.r});
      a.partner = b;
      b.partner = a;
      b.twinB = true;
      return a;
    }

    // The infinite loop: a head circling round the player and a body trailing behind it.
    // The body passes part of every hit on to the head.
    function spawnLoop() {
      const cfg = B.enemies.boss_loop;
      const head = spawn("boss_loop");
      if (!head) return null;
      Object.assign(head, {rigid: true, noclip: true, angle: random() * Math.PI * 2, segments: []});
      head.cx = head.x - Math.cos(head.angle) * cfg.orbit;
      head.cy = head.y - Math.sin(head.angle) * cfg.orbit;
      for (let i = 0; i < cfg.segments; i++) {
        head.segments.push(spawn("loop_segment", {x: head.x, y: head.y},
                                 {head, rigid: true, noclip: true, hp: head.hp, maxHp: head.maxHp}));
      }
      return head;
    }

    // `elite`: maybe a golden one (balance.elites).
    function spawnAny(type, elite) {
      if (type === "race" || type === "boss_race") return spawnPair(type);
      if (type === "boss_loop") return spawnLoop();
      const e = spawn(type);
      if (e && elite && s.time / 60 >= EL.from_minute && EL.types.includes(type) && random() < EL.chance) {
        makeElite(e);
      }
      return e;
    }

    // An elite: a golden outline, much tougher, one trait, and a chest when it dies.
    // `hpScale`: a trial's enhanced boss is less tough than an elite bug.
    function makeElite(e, kind, hpScale = EL.hp) {
      const kinds = Object.keys(EL.kinds);
      kind = EL.kinds[kind] ? kind : kinds[Math.floor(random() * kinds.length)];
      const k = EL.kinds[kind];
      e.elite = kind;
      e.hp *= hpScale;
      e.maxHp = e.hp;
      e.score *= EL.score;
      if (k.speed) e.speed *= k.speed;
      if (k.shield) e.shield = e.shieldMax = e.maxHp * k.shield;
      if (e.baseHp) e.baseHp = e.hp;
      s.met.elite = true;
    }

    function spawnBoss(type) {
      const cfg = B.enemies[type], boss = spawnAny(type);
      if (boss) text(s.player.x, s.player.y - 30, tr(cfg.name, cfg.name_en).toUpperCase(), "#e8c14a", 2.5);
      return boss;
    }

    // The clock's part of the difficulty stops at `growth_minutes`, so a long agent session levels off.
    const clockMinute = () => Math.min(s.time / 60, B.spawn.growth_minutes);
    // Infinity's minutes past the classic's end: there the difficulty keeps growing.
    const overtimeMinutes = () => (endless ? Math.max(0, (s.time - C.seconds) / 60) : 0);

    // The usual bugs, and the map's own enemy (maps.js, `special`).
    function pickType() {
      const minute = s.time / 60;
      const weights = Object.entries(B.spawn.weights);
      if (s.map.special) weights.push([s.map.special, B.spawn.special_weight]);
      const pool = weights.filter(([type]) => minute >= (B.enemies[type].from_minute || 0));
      let roll = random() * pool.reduce((sum, [, w]) => sum + w, 0);
      for (const [type, w] of pool) {
        roll -= w;
        if (roll <= 0) return type;
      }
      return pool[0][0];
    }

    function hurtEnemy(e, damage) {
      if (e.dead) return;
      e.flash = 0.1;
      damage *= kit.crit(e);
      if (e.head) { hurtEnemy(e.head, damage * B.enemies.boss_loop.segment_share); return; }
      if (e.shield > 0) {
        const taken = Math.min(e.shield, damage);
        e.shield -= taken;
        damage -= taken;
        if (e.shield <= 0) effect({type: "ring", x: e.x, y: e.y, r: e.r + 6, color: "#5b8bd0", life: 0.3});
        if (damage <= 0) return;
      }
      e.hp -= damage;
      if (e.hp <= 0) killEnemy(e);
      else if (e.splits !== undefined) oomSplit(e);
    }

    // Out of memory sheds small leaks each time it loses another part of its health.
    function oomSplit(e) {
      const cfg = B.enemies[e.type], parts = Math.round(1 / cfg.split_every);
      while (e.splits < parts - 1 && e.hp <= e.maxHp * (1 - (e.splits + 1) * cfg.split_every)) {
        e.splits++;
        effect({type: "ring", x: e.x, y: e.y, r: e.r + 10, color: "#5fbf5a", life: 0.4});
        for (let i = 0; i < cfg.split.count; i++) {
          const angle = random() * Math.PI * 2;
          spawn(cfg.split.type, {x: e.x + Math.cos(angle) * e.r, y: e.y + Math.sin(angle) * e.r});
        }
      }
    }

    function killEnemy(e) {
      const cfg = B.enemies[e.type];
      e.dead = true;
      s.kills++;
      s.streak++;
      s.streakTimer = B.score.streak_window;
      s.bestStreak = Math.max(s.bestStreak, s.streak);
      s.score += e.score * s.multiplier;
      effect({type: "pop", x: e.x, y: e.y, r: e.r, kind: e.type, boss: !!e.boss, life: 0.3,
              color: e.boss ? "#e8c14a" : "#e8e6f0"});
      if (classic && !e.noLoot) dropGem(e.x, e.y, (C.gem_xp[e.type] || 1) * (e.elite ? EL.score : 1));
      // A regression comes back once, a little later, where it died.
      if (cfg.return_seconds && !e.returned) {
        s.comebacks.push({at: s.time + cfg.return_seconds, type: e.type, x: e.x, y: e.y});
      }
      for (const seg of e.segments || []) {
        seg.dead = true;
        effect({type: "pop", x: seg.x, y: seg.y, r: seg.r, kind: seg.type, life: 0.3, color: "#e8e6f0"});
      }
      if (cfg.splits) {
        for (let i = 0; i < cfg.splits.count; i++) {
          const angle = random() * Math.PI * 2;
          spawn(cfg.splits.type, {x: e.x + Math.cos(angle) * 6, y: e.y + Math.sin(angle) * 6});
        }
      }
      let pairDone = !e.partner;
      if (e.partner) {
        const twin = e.partner;
        if (e.revive) {
          pairDone = true;
          // The twin died a moment ago: both are gone for good.
          s.synced++;
          s.score += cfg.sync_score * s.multiplier;
          text(e.x, e.y - 10, tr("СИНХРОННО", "IN SYNC"), "#7fe0e0", 1.5);
          e.revive = null;
        } else if (!twin.dead) {
          twin.revive = {at: s.time + cfg.revive_seconds, x: e.x, y: e.y};
        }
      }
      if (e.elite) {
        s.elites++;
        drop("chest", e.x, e.y, true);
      }
      if (e.boss) {
        // Once the match is decided (a death, a failed trial), the final boss changes nothing.
        if (e.final && classic && pairDone) { bossDown(e, false); if (s.endAt === null) win(e); return; }
        // Twins are down only both at once.
        if (pairDone) bossDown(e, true);
      } else if (!e.elite && !e.noLoot && random() < I.drop_chance) {
        drop(pickItem(), e.x, e.y);
      }
    }

    function bossDown(e, loot) {
      s.bosses++;
      s.bossKinds[e.type] = true;
      if (!loot) return;
      if (chestLeft()) drop("chest", e.x, e.y - 10, true);
      for (let i = 0; i < I.boss_drops; i++) {
        drop(i ? pickItem() : "medkit", e.x + (random() - 0.5) * 40, e.y + (random() - 0.5) * 40,
             !i);
      }
    }

    // A twin left alone too long brings the other one back.
    function reviveTwin(e) {
      const at = e.revive, cfg = B.enemies[e.type];
      e.revive = null;
      // A boss twin comes back weaker and is worth nothing the second time.
      const twin = spawn(e.type, {x: at.x, y: at.y}, Object.assign({partner: e, final: e.final},
        cfg.revive_hp ? {hpScale: cfg.revive_hp, score: 0, noLoot: true} : {}));
      twin.twinB = !e.twinB;
      e.partner = twin;
      effect({type: "ring", x: at.x, y: at.y, r: 16, color: "#7fe0e0", life: 0.4});
      text(at.x, at.y - 10, tr("ГОНКА!", "RACE!"), "#7fe0e0");
    }

    // Null pointer jumps towards the player now and then, never into a wall.
    function blink(e) {
      const cfg = B.enemies[e.type], p = s.player;
      e.blinkAt = s.time + cfg.blink_every * (0.7 + random() * 0.6);
      const d = Math.hypot(p.x - e.x, p.y - e.y);
      if (p.dead || d > cfg.blink_range || d < 50) return;
      const k = Math.min(cfg.blink_distance, d - 30) / d;
      const x = e.x + (p.x - e.x) * k, y = e.y + (p.y - e.y) * k;
      if (!clearPath(e, x, y, 0) || inWall(x, y, e.r)) return;   // never through a wall
      effect({type: "blink", x: e.x, y: e.y, x2: x, y2: y, life: 0.3});
      e.x = x;
      e.y = y;
    }

    // The final boss of a classic run is down: everyone else vanishes, the run is won. In
    // Infinity the run goes on, and the final boss comes again at the next of its minutes.
    // A trial won without a boss (its goal reached) wins the same way, around the player.
    function win(boss) {
      effect({type: "ult", x: boss.x, y: boss.y, r: Math.hypot(s.view.width, s.view.height),
              color: "#e8c14a", life: 1});
      for (const e of s.enemies) {
        if (e.dead) continue;
        e.dead = true;
        effect({type: "pop", x: e.x, y: e.y, r: e.r, kind: e.type, life: 0.3, color: "#e8e6f0"});
      }
      s.hazards = [];
      s.enemyShots = [];
      s.comebacks = [];
      if (endless) {
        text(boss.x, boss.y - 30, tr("БАГИ НЕ КОНЧАЮТСЯ", "THE BUGS NEVER END"), "#e8c14a", 3);
        const every = B.infinity.final_every_minutes * 60;
        s.finalAt = C.seconds + (Math.floor((s.time - C.seconds) / every) + 1) * every;
        return;
      }
      const next = s.stage && !s.stage.final;
      text(boss.x, boss.y - 30, trial ? tr("ИСПЫТАНИЕ ПРОЙДЕНО", "TRIAL PASSED")
        : next ? tr("ЭТАП ПРОЙДЕН", "STAGE CLEAR") : tr("КОНФЛИКТ РАЗРЕШЁН", "CONFLICT RESOLVED"), "#e8c14a", 3);
      s.endAt = s.time + C.win_delay;
      // A trial's pass is not a classic's win: the trials keep their own records. Its time is
      // the pass's moment, not the end of the match.
      s.endReason = next ? "stage" : trial ? "passed" : "win";
      if (trial) s.trial.time = s.time;
    }

    // --- crystals of experience (classic) ---------------------------------------------

    function dropGem(x, y, xp) {
      if (s.gems.length >= C.max_gems) {
        // Too many on the floor: the new one joins an old one.
        s.gems[Math.floor(random() * s.gems.length)].xp += xp;
        return;
      }
      s.gems.push({x, y, xp, pull: false});
    }

    function updateGems(dt) {
      const p = s.player;
      if (p.dead) return;
      const magnet = C.magnet + s.stats.pickup, reach = I.pickup_radius + p.r;
      let xp = 0;
      for (const g of s.gems) {
        const dx = p.x - g.x, dy = p.y - g.y, d = Math.hypot(dx, dy);
        if (d <= reach) { xp += g.xp; g.xp = 0; continue; }
        if (d <= magnet) g.pull = true;
        if (g.pull) {
          const step = Math.min(d, C.gem_speed * dt);
          g.x += dx / d * step;
          g.y += dy / d * step;
        }
      }
      if (xp) {
        s.met.gem = true;
        s.gems = s.gems.filter((g) => g.xp > 0);
        addXp(xp);
      }
    }

    // --- items -------------------------------------------------------------------

    function pickItem() {
      const pool = Object.entries(I.weights).filter(([type]) => !(type === "medkit" && mod("no_medkits")));
      let roll = random() * pool.reduce((sum, [, w]) => sum + w, 0);
      for (const [type, w] of pool) {
        roll -= w;
        if (roll <= 0) return type;
      }
      return pool[0][0];
    }

    // `force`: even when the map is full. A chest stays until it is picked up.
    function drop(type, x, y, force) {
      if (!force && s.items.length >= I.max_on_map) return;
      const o = {x: clamp(x, 8, W - 8), y: clamp(y, 8, H - 8)};
      pushOut(o, 8, true);
      s.items.push({type, x: o.x, y: o.y, t: 0, life: type === "chest" ? Infinity : I.lifetime});
    }

    // Now and then an item appears somewhere near the player, in the open.
    function placeItem() {
      const p = s.player;
      for (let tries = 0; tries < 10; tries++) {
        const angle = random() * Math.PI * 2, d = 60 + random() * 140;
        const x = clamp(p.x + Math.cos(angle) * d, 12, W - 12);
        const y = clamp(p.y + Math.sin(angle) * d, 12, H - 12);
        if (!inWall(x, y, 10, true)) { drop(pickItem(), x, y); return; }
      }
    }

    function pickUp(it) {
      const p = s.player;
      it.life = 0;
      s.picked++;
      s.met[it.type] = true;
      effect({type: "pickup", x: it.x, y: it.y, item: it.type, life: 0.3});
      switch (it.type) {
        case "chest":
          s.pendingChests++;
          if (!s.choices) nextChoice();
          break;
        case "medkit": {
          const before = p.hp;
          p.hp = Math.min(s.stats.max_hp, p.hp + I.medkit.heal);
          text(p.x, p.y - 14, `+${Math.round(p.hp - before)}`, "#4fbf6f");
          break;
        }
        case "coffee":
          s.buffs.coffee = I.coffee.seconds * s.stats.coffee;
          text(p.x, p.y - 14, tr("КОФЕ", "COFFEE"), "#e89a4a");
          break;
        case "duck":
          s.buffs.duck = I.duck.seconds;
          text(p.x, p.y - 14, tr("УТОЧКА", "DUCK"), "#e8c14a");
          break;
        case "shield":
          p.shield = I.shield.hits + s.stats.shield_bonus;
          text(p.x, p.y - 14, tr("ЩИТ", "SHIELD"), "#5b8bd0");
          break;
      }
    }

    function updateItems(dt) {
      const p = s.player;
      s.buffs.coffee = Math.max(0, s.buffs.coffee - dt);
      s.buffs.duck = Math.max(0, s.buffs.duck - dt);
      if (s.finaleAt === null && s.endAt === null && s.time >= s.itemAt) {
        s.itemAt = s.time + I.every_seconds;
        placeItem();
      }
      const reach = I.pickup_radius + p.r + s.stats.pickup / 2;
      for (const it of s.items) {
        it.t += dt;
        if (it.t >= it.life) it.life = 0;
        else if (!p.dead && (it.x - p.x) ** 2 + (it.y - p.y) ** 2 <= reach * reach) pickUp(it);
      }
      s.items = s.items.filter((it) => it.life > 0);
    }

    function explode(x, y, radius, damage, color) {
      effect({type: "ring", x, y, r: radius, color, life: 0.35});
      T.blast(x, y, radius, damage);
      nearby(x, y, radius + 20, (e) => {
        if (Math.hypot(e.x - x, e.y - y) > radius + e.r) return;
        hurtEnemy(e, damage);
        T.knock(e, x, y);
      });
    }

    // Down a pit on the cloud map: as good as killed.
    function fall(e) {
      effect({type: "fall", x: e.x, y: e.y, r: e.r, kind: e.type, life: 0.5});
      killEnemy(e);
    }

    // --- player ------------------------------------------------------------------

    // True when the hit landed, even on the shield.
    function hurtPlayer(damage) {
      const p = s.player;
      // Once the match is decided, nothing changes the decision.
      if (s.immortal || p.dead || p.invulnerable > 0 || s.endAt !== null) return false;
      p.invulnerable = B.player.hit_invulnerable;
      p.hurtAt = s.time;
      if (p.shield > 0) {
        p.shield--;
        effect({type: "ring", x: p.x, y: p.y, r: 14, color: "#5b8bd0", life: 0.3});
        return true;
      }
      p.hp -= damage;
      s.damageTaken += damage;
      s.streak = 0;
      if (p.hp <= 0) {
        p.hp = 0;
        p.dead = B.player.respawn_seconds;
        s.deaths++;
        if (classic) {
          // Alone there is no one to wait for: the run is over.
          s.endAt = s.time + C.death_delay;
          s.endReason = "dead";
          return true;
        }
        s.score = Math.max(0, s.score - B.player.death_penalty);
        text(p.x, p.y - 12, `−${B.player.death_penalty}`, "#d9534f", 2);
      }
      return true;
    }

    function respawn() {
      const p = s.player;
      p.hp = s.stats.max_hp;
      p.invulnerable = B.player.respawn_invulnerable;
      p.ammo = p.magazine;
      p.reload = 0;
      // Throw nearby enemies back so the player does not respawn into a crowd.
      const clear = B.player.respawn_clear_radius;
      for (const e of s.enemies) {
        const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy);
        if (d < clear) {
          const angle = d > 0.5 ? Math.atan2(dy, dx) : random() * Math.PI * 2;
          e.x = clamp(p.x + Math.cos(angle) * clear, e.r, W - e.r);
          e.y = clamp(p.y + Math.sin(angle) * clear, e.r, H - e.r);
          pushOut(e, e.r);
        }
      }
      effect({type: "ring", x: p.x, y: p.y, r: clear, color: "#e8c14a", life: 0.5});
    }

    // --- weapons -----------------------------------------------------------------

    // Level and evolution changes: some keys multiply, every other number adds.
    function applyChanges(o, changes) {
      for (const [k, v] of Object.entries(changes)) o[k] = MUL_KEYS.has(k) ? o[k] * v : (o[k] || 0) + v;
    }

    // A weapon's numbers: its base, its levels and evolution, then passives, gear and buffs.
    function weaponStats(w) {
      const cfg = WEAPONS.get(w.id), st = s.stats;
      const o = Object.assign({area: 1, duration: 1, count: 1}, cfg.base);
      for (let i = 0; i < w.level - 1; i++) applyChanges(o, cfg.levels[i]);
      if (w.evolved) applyChanges(o, cfg.evolution.changes);
      const fast = s.buffs.coffee > 0 ? I.coffee.fire : 1;
      o.damage *= st.damage;
      o.cooldown *= st.cooldown * fast;
      o.count = Math.max(1, Math.round(o.count + st.amount));
      o.area *= st.area;
      o.pierce = Math.round((o.pierce || 0) + st.pierce) + (s.buffs.duck > 0 ? I.duck.pierce : 0);
      if (o.magazine !== undefined) {
        o.magazine = Math.round(o.magazine + st.magazine);
        o.reload *= st.reload * fast;
      }
      return o;
    }

    // An enemy is hit by the same blade or pulse at most once every `every` seconds.
    function ready(e, id, every) {
      const hits = e.hitAt || (e.hitAt = {});
      if (hits[id] > s.time) return false;
      hits[id] = s.time + every;
      return true;
    }

    function startReload(o) {
      const p = s.player;
      // `while (true)`: no reload at all.
      if (o.reload <= 0.01) { p.ammo = o.magazine; return; }
      p.reload = p.reloadTotal = o.reload;
    }

    // The pistol fires on its own while there are rounds in the magazine, then reloads.
    // With no target in range a partly spent magazine is reloaded right away.
    function updatePistol(w, o, dt) {
      const p = s.player;
      p.magazine = o.magazine;
      w.timer -= dt;
      if (p.reload > 0) {
        p.reload -= dt;
        if (p.reload <= 0) { p.reload = 0; p.ammo = o.magazine; }
      } else if (w.timer <= 0) {
        if (firePistol(o)) {
          w.timer = o.cooldown;
          if (--p.ammo <= 0) startReload(o);
        } else if (p.ammo < o.magazine) {
          startReload(o);
        }
      }
    }

    // Shots in flight are counted against their target (`incoming`), so a quick burst
    // spreads over the crowd instead of piling into one enemy that is already done for.
    function firePistol(o) {
      const p = s.player, n = o.count, r2 = o.range * o.range;
      const near = s.enemies.filter((e) => !e.dead && e.incoming < e.hp && dist2(e, p) <= r2)
        .sort((a, b) => dist2(a, p) - dist2(b, p));
      const targets = firstInSight(near, p, n);
      if (!targets.length) return false;
      p.aim = Math.atan2(targets[0].y - p.y, targets[0].x - p.x);
      p.firedAt = s.time;
      for (let i = 0; i < n; i++) {
        const t = targets[i % targets.length];
        let angle = Math.atan2(t.y - p.y, t.x - p.x);
        if (i >= targets.length) angle += (i - targets.length + 1) * 0.25 * (i % 2 ? 1 : -1);
        s.shots.push({x: p.x, y: p.y, vx: Math.cos(angle) * o.speed, vy: Math.sin(angle) * o.speed,
                      r: o.radius * o.area, damage: o.damage, pierce: o.pierce, hit: new Set(),
                      life: o.range / o.speed + 0.2, color: "#e8d36a", aim: t});
        t.incoming += o.damage;
      }
      return true;
    }

    // `--force`: a fan of pellets at the nearest enemy.
    function fireShotgun(w, o) {
      const p = s.player, t = nearestEnemies(p, 1, o.range, true)[0];
      if (!t) return false;
      const base = Math.atan2(t.y - p.y, t.x - p.x), n = o.count;
      for (let i = 0; i < n; i++) {
        const angle = base + (n > 1 ? (i / (n - 1) - 0.5) * o.spread : 0);
        s.shots.push({x: p.x, y: p.y, vx: Math.cos(angle) * o.speed, vy: Math.sin(angle) * o.speed,
                      r: o.radius * o.area, damage: o.damage, pierce: o.pierce, hit: new Set(),
                      life: o.range / o.speed, color: w.evolved ? "#e8c14a" : "#e89a4a"});
      }
      effect({type: "ring", x: p.x + Math.cos(base) * 8, y: p.y + Math.sin(base) * 8, r: 6,
              color: "#e89a4a", life: 0.15});
      return true;
    }

    // A straight beam that hurts everyone along it, up to the first wall.
    function beam(x, y, angle, length, width, damage, color) {
      const dx = Math.cos(angle), dy = Math.sin(angle);
      length = toWall(x, y, dx, dy, length);
      effect({type: "beam", x, y, x2: x + dx * length, y2: y + dy * length, r: width, color,
              life: 0.3});
      for (const e of s.enemies) {
        if (e.dead) continue;
        const along = (e.x - x) * dx + (e.y - y) * dy;
        const across = Math.abs((e.x - x) * dy - (e.y - y) * dx);
        if (along > 0 && along < length + e.r && across <= width / 2 + e.r) hurtEnemy(e, damage);
      }
    }

    // `grep`: a beam through everyone in line, one per target.
    function fireLaser(w, o) {
      const p = s.player, targets = nearestEnemies(p, o.count, o.range, true);
      if (!targets.length) return false;
      const first = Math.atan2(targets[0].y - p.y, targets[0].x - p.x);
      for (let i = 0; i < o.count; i++) {
        // Beams without a target of their own fan out evenly around the first one.
        const t = targets[i];
        const angle = t ? Math.atan2(t.y - p.y, t.x - p.x) : first + i / o.count * Math.PI * 2;
        beam(p.x, p.y, angle, o.range, o.radius * 2 * o.area, o.damage,
             w.evolved ? "#e8c14a" : "#e84a8a");
      }
      return true;
    }

    // Linters circle the player for `duration`, then rest for `cooldown` (never, evolved).
    function updateLinters(w, o, dt) {
      const p = s.player;
      if (o.cooldown <= 0.01) {
        w.on = true;
      } else {
        w.timer -= dt;
        if (w.timer <= 0) {
          w.on = !w.on;
          w.timer = w.on ? o.duration : o.cooldown;
        }
      }
      w.blades = [];
      if (!w.on || p.dead) return;
      w.angle = (w.angle || 0) + o.spin * dt;
      const orbit = o.orbit * o.area, size = o.radius * o.area;
      for (let i = 0; i < o.count; i++) {
        const a = w.angle + i / o.count * Math.PI * 2;
        const b = {x: p.x + Math.cos(a) * orbit, y: p.y + Math.sin(a) * orbit, r: size};
        w.blades.push(b);
        nearby(b.x, b.y, size + 20, (e) => {
          if (Math.hypot(e.x - b.x, e.y - b.y) <= size + e.r && ready(e, w.id, o.hit_every)) {
            hurtEnemy(e, o.damage);
          }
        });
      }
    }

    // `rm -rf`: mines are left where the player walks; an enemy steps on one, it blows up.
    function fireMines(w, o) {
      const p = s.player;
      for (let i = 0; i < o.count && s.mines.length < o.max; i++) {
        const angle = random() * Math.PI * 2, d = i ? 8 + random() * 16 : 0;
        const m = {x: p.x + Math.cos(angle) * d, y: p.y + Math.sin(angle) * d, r: o.radius * o.area,
                   damage: o.damage, trigger: o.trigger, armAt: s.time + o.arm,
                   until: s.time + o.life, evolved: w.evolved};
        pushOut(m, 4, true);
        s.mines.push(m);
      }
      return true;
    }

    function updateMines() {
      for (const m of s.mines) {
        let boom = s.time >= m.until;
        if (!boom && s.time >= m.armAt) {
          nearby(m.x, m.y, m.trigger + 20, (e) => {
            if (Math.hypot(e.x - m.x, e.y - m.y) <= m.trigger + e.r) boom = true;
          });
        }
        if (boom) {
          m.done = true;
          explode(m.x, m.y, m.r, m.damage, m.evolved ? "#e8c14a" : "#e89a4a");
        }
      }
      s.mines = s.mines.filter((m) => !m.done);
    }

    // A regex: lightning hits an enemy and jumps to the nearest one not hit yet; neither
    // the strike nor a jump goes through a wall.
    function fireRegex(w, o) {
      const p = s.player, hit = new Set(), jump = o.jump * o.area;
      const first = nearestEnemies(p, o.count, o.range, true);
      for (const start of first) {
        if (hit.has(start)) continue;
        const points = [{x: p.x, y: p.y}];   // from where the sight was checked
        let target = start;
        for (let j = 0; j < o.chain && target; j++) {
          hit.add(target);
          points.push({x: target.x, y: target.y});
          hurtEnemy(target, o.damage);
          let best = null, bestD = jump * jump;
          nearby(target.x, target.y, jump, (e) => {
            const d = dist2(e, target);
            if (!hit.has(e) && d < bestD && inSight(target, e)) { bestD = d; best = e; }
          });
          target = best;
        }
        effect({type: "bolt", points, color: w.evolved ? "#e8c14a" : "#7fe0e0", life: 0.25});
      }
      return first.length > 0;
    }

    // Ping: pulses around the player, `count` of them one after another.
    function updatePing(w, o, dt) {
      const p = s.player;
      w.timer -= dt;
      if (w.pulses > 0 && s.time >= w.nextPulse) {
        w.pulses--;
        w.nextPulse = s.time + 0.2;
        const r = o.radius * o.area;
        effect({type: "ring", x: p.x, y: p.y, r, color: w.evolved ? "#e8c14a" : "#5bd0e8",
                life: 0.3});
        nearby(p.x, p.y, r + 20, (e) => {
          if (Math.hypot(e.x - p.x, e.y - p.y) > r + e.r) return;
          hurtEnemy(e, o.damage);
          if (o.slow > 0) { e.slow = o.slow_seconds; e.slowFactor = 1 - o.slow; }
        });
      }
      if (w.timer > 0 || p.dead) return;
      const r = o.radius * o.area;
      if (!nearestEnemies(p, 1, r + 10).length) return;
      w.timer = o.cooldown;
      w.pulses = o.count;
      w.nextPulse = s.time;
    }

    // Cron: strikes from the sky at random enemies on screen.
    function fireCron(w, o) {
      const p = s.player, hw = s.view.width / 2, hh = s.view.height / 2;
      const pool = s.enemies.filter((e) => !e.dead && Math.abs(e.x - p.x) < hw && Math.abs(e.y - p.y) < hh);
      if (!pool.length) return false;
      const r = o.radius * o.area;
      for (let i = 0; i < o.count; i++) {
        const t = pool[Math.floor(random() * pool.length)];
        effect({type: "strike", x: t.x, y: t.y, r, color: w.evolved ? "#e8c14a" : "#c8a8ff",
                life: 0.35});
        nearby(t.x, t.y, r + 20, (e) => {
          if (Math.hypot(e.x - t.x, e.y - t.y) <= r + e.r) hurtEnemy(e, o.damage);
        });
      }
      return true;
    }

    const FIRE = {shotgun: fireShotgun, laser: fireLaser, mines: fireMines, regex: fireRegex,
                  cron: fireCron};

    function updateWeapons(dt) {
      for (const w of s.weapons) {
        const o = weaponStats(w);
        if (w.id === "pistol") updatePistol(w, o, dt);
        else if (w.id === "linters") updateLinters(w, o, dt);
        else if (w.id === "ping") updatePing(w, o, dt);
        else {
          w.timer -= dt;
          // No target: try again on the next step.
          if (w.timer <= 0 && FIRE[w.id](w, o)) w.timer = o.cooldown;
        }
      }
    }

    // --- level-ups and chests (build.js) --------------------------------------------

    const magazine = () => {
      const pistol = s.weapons.find((w) => w.id === "pistol");
      return pistol ? weaponStats(pistol).magazine : 0;
    };
    const {addXp, choose, reroll, banish, nextChoice, chestLeft, offers, take} = root.LCSBuild.create(B, s,
      {random, text, effect, tr, mod, magazine});
    // The class and the stars' bonuses (classes.js); a campaign's next stage takes the run on.
    const kit = root.LCSClasses.create(B, s, {random, effect, text, tr, pushOut}, options);
    if (!(stage && options.carry)) kit.start();
    if (stage) root.LCSModes.resume(s, B, stage, options.carry);
    const trialRun = trial && root.LCSTrials.create(B, s, trial, {spawnBoss, spawnFinal, makeElite, win, text, tr});
    s.player.ammo = s.player.magazine = magazine();

    // --- allies: the agents ------------------------------------------------------

    function ally(e, create) {
      let a = bySession.get(e.session);
      if (!a) {
        if (!create) return null;
        const slot = s.allies.length;
        a = {session: e.session, project: e.project || "?", color: ALLY_COLORS[slot % ALLY_COLORS.length],
             slot, x: s.player.x, y: s.player.y, r: B.ally.radius, state: "active", leave: 0,
             stun: 0, blocked: 0, meditate: 0, spirits: new Map(), actions: 0,
             waiting: false, waitingSince: null};
        bySession.set(e.session, a);
        s.allies.push(a);
        text(a.x, a.y - 12, a.project, a.color, 2);
      } else if (a.state !== "active" && create) {
        a.state = "active";
        a.x = s.player.x; a.y = s.player.y;
        text(a.x, a.y - 12, tr("снова в бою", "back in action"), a.color, 2);
      }
      if (a.state === "active") {
        s.everAlly = true;
        if (classic) s.withAgent = true;
        if (s.finaleAt !== null && !s.over) s.finaleAt = null;
      }
      return a;
    }

    const canAct = (a) => a.state === "active" && a.stun <= 0 && a.blocked <= 0 && a.meditate <= 0;
    // Everything the agents hit with; the orchestra makes it stronger.
    const allyDamage = () => s.stats.ally_damage * (s.orchestra ? AG.orchestra.ally_damage : 1);
    const agentXp = (n) => addXp(n * (s.orchestra ? AG.orchestra.xp : 1));
    const gitOps = (e) => (Array.isArray(e.git) ? e.git : []);

    function ability(a, src, e) {
      const st = s.stats;
      switch (e.action) {
        case "attack": {
          const lines = (e.lines_added || 0) + (e.lines_removed || 0);
          const damage = Math.min(A.attack.max_damage, A.attack.damage + A.attack.per_line * lines)
            * allyDamage();
          const n = A.attack.missiles + Math.round(st.ally_missiles);
          const targets = nearestEnemies(src, n, Infinity);
          for (let i = 0; i < n; i++) {
            const angle = random() * Math.PI * 2;
            s.shots.push({x: src.x, y: src.y, vx: Math.cos(angle) * A.attack.speed,
                          vy: Math.sin(angle) * A.attack.speed, r: 3, damage, pierce: 0,
                          hit: new Set(), life: 4, color: a.color,
                          target: targets.length ? targets[i % targets.length] : null});
          }
          break;
        }
        case "scout": {
          const radius = A.scout.radius * st.area;
          effect({type: "ring", x: src.x, y: src.y, r: radius, color: "#7fb3e0", life: 0.6});
          nearby(src.x, src.y, radius, (en) => {
            if (Math.hypot(en.x - src.x, en.y - src.y) <= radius) {
              en.slow = A.scout.seconds;
              en.slowFactor = A.scout.slow;
            }
          });
          break;
        }
        case "cast": {
          if (gitOps(e).includes("commit")) { commitBomb(a, src); break; }
          const cfg = e.category === "test" ? A.cast_test : A.cast;
          const target = nearestEnemies(src, 1, A.cast.range)[0] || src;
          explode(target.x, target.y, cfg.radius * st.area, cfg.damage * allyDamage(),
                  e.category === "test" ? "#e8c14a" : "#e89a4a");
          break;
        }
        case "scout_far": {
          const target = nearestEnemies(src, 1, Infinity)[0];
          const angle = target ? Math.atan2(target.y - src.y, target.x - src.x) : random() * Math.PI * 2;
          const dx = Math.cos(angle), dy = Math.sin(angle), len = Math.hypot(W, H);
          effect({type: "beam", x: src.x, y: src.y, x2: src.x + dx * len, y2: src.y + dy * len,
                  r: A.scout_far.width, color: "#7fe0e0", life: 0.4});
          for (const en of s.enemies) {
            const along = (en.x - src.x) * dx + (en.y - src.y) * dy;
            const across = Math.abs((en.x - src.x) * dy - (en.y - src.y) * dx);
            if (along > 0 && across <= A.scout_far.width / 2 + en.r) {
              hurtEnemy(en, A.scout_far.damage * allyDamage());
            }
          }
          break;
        }
        case "todo":
          break;
        case "summon":
          explode(src.x, src.y, A.generic.radius * 1.5 * st.area,
                  A.generic.damage * 2 * allyDamage(), a.color);
          break;
        default:
          explode(src.x, src.y, A.generic.radius * st.area, A.generic.damage * allyDamage(),
                  a.color);
      }
    }

    // --- the agent's real work: git, builds, tests, answers -------------------------

    function commitBomb(a, src) {
      const radius = AG.commit.radius * s.stats.area;
      effect({type: "ring", x: src.x, y: src.y, r: radius, color: "#e8c14a", life: 0.6});
      effect({type: "ring", x: src.x, y: src.y, r: radius * 0.6, color: "#fffbe0", life: 0.45});
      nearby(src.x, src.y, radius + 20, (en) => {
        if (Math.hypot(en.x - src.x, en.y - src.y) <= radius + en.r) {
          hurtEnemy(en, AG.commit.damage * allyDamage());
        }
      });
      text(a.x, a.y - 14, "COMMIT", "#e8c14a", 1.8);
      s.met.commit = true;
    }

    // A successful Bash command: what its category and git steps turn into.
    function bashDone(a, src, e) {
      const ops = gitOps(e);
      if (ops.includes("commit")) s.commits++;
      if (ops.includes("push")) {
        s.pushes++;
        if (s.time >= s.pushChestAt && s.finaleAt === null && s.endAt === null) {
          s.pushChestAt = s.time + AG.push.cooldown_seconds;
          drop("chest", a.x + 16, a.y + 10, true);
          text(a.x, a.y - 14, "PUSH", "#e8c14a", 1.8);
          s.met.push = true;
        }
      }
      if (e.category === "build") placeTurret(a, src);
      if (e.category === "test") {
        const p = s.player;
        p.shield = Math.max(p.shield, Math.min(AG.tests_passed.max_shield,
                                               p.shield + AG.tests_passed.shield));
        s.redCi = 0;
        text(a.x, a.y - 14, tr("ТЕСТЫ OK", "TESTS OK"), "#4fbf6f", 1.5);
        s.met.tests = true;
      }
    }

    function placeTurret(a, src) {
      const angle = random() * Math.PI * 2;
      const o = {x: clamp(src.x + Math.cos(angle) * 14, 8, W - 8), y: clamp(src.y + Math.sin(angle) * 14, 8, H - 8)};
      pushOut(o, 6, true);
      s.turrets.push({x: o.x, y: o.y, born: s.time, until: s.time + AG.turret.seconds, cooldown: 0,
                      aim: angle, color: a.color, firedAt: -1});
      while (s.turrets.length > AG.turret.max) s.turrets.shift();
      s.turretsBuilt++;
      effect({type: "ring", x: o.x, y: o.y, r: 12, color: a.color, life: 0.3});
      s.met.turret = true;
    }

    function updateTurrets(dt) {
      s.turrets = s.turrets.filter((t) => s.time < t.until);
      for (const t of s.turrets) {
        t.cooldown -= dt;
        if (t.cooldown > 0) continue;
        const target = nearestEnemies(t, 1, AG.turret.range, true)[0];
        if (!target) continue;
        t.aim = Math.atan2(target.y - t.y, target.x - t.x);
        t.firedAt = s.time;
        t.cooldown = AG.turret.cooldown;
        s.shots.push({x: t.x, y: t.y, vx: Math.cos(t.aim) * AG.turret.speed, vy: Math.sin(t.aim) * AG.turret.speed,
                      r: 2, damage: AG.turret.damage * allyDamage(), pierce: 0, hit: new Set(),
                      life: AG.turret.range / AG.turret.speed, color: "#e8c14a"});
      }
    }

    function redCi(a) {
      s.redCi = AG.red_ci.seconds;
      text(a.x, a.y - 22, tr("КРАСНЫЙ CI", "RED CI"), "#ff3030", 2);
      s.met.red_ci = true;
    }

    // The agent waited for an answer; one within a few seconds of real time earns a bonus.
    function answered(a, e) {
      const since = a.waitingSince;
      a.waiting = false;
      a.waitingSince = null;
      if (e.source || typeof e.ts !== "number" || typeof since !== "number") return;
      if (e.ts - since > AG.reviewer.answer_seconds || e.ts < since) return;
      s.reviews++;
      s.buffs.coffee = Math.max(s.buffs.coffee, AG.reviewer.coffee_seconds * s.stats.coffee);
      s.score += AG.reviewer.score * s.multiplier;
      text(a.x, a.y - 14, tr("БЫСТРЫЙ РЕВЬЮЕР", "FAST REVIEWER"), "#7fe0e0", 2);
      s.met.reviewer = true;
    }

    function spiritType(agentType) {
      const key = typeof agentType === "string" ? agentType.toLowerCase() : "";
      return Object.hasOwn(AG.spirits.types, key) ? AG.spirits.types[key] : "shooter";
    }

    // Three or more agents at once, the sessions and their subagents: the orchestra.
    function updateOrchestra() {
      let n = 0;
      for (const a of s.allies) if (a.state === "active") n += 1 + a.spirits.size;
      const on = n >= AG.orchestra.agents;
      if (on && !s.orchestra) {
        const p = s.player;
        text(p.x, p.y - 30, tr("ОРКЕСТР", "ORCHESTRA"), "#d07ad0", 2.5);
        effect({type: "ring", x: p.x, y: p.y, r: 60, color: "#d07ad0", life: 0.6});
        s.met.orchestra = true;
      }
      s.orchestra = on;
    }

    function leave(a, ult) {
      if (a.state !== "active") return;
      if (ult) {
        effect({type: "ult", x: a.x, y: a.y, r: Math.hypot(s.view.width, s.view.height),
                color: a.color, life: 0.8});
        for (const en of s.enemies) hurtEnemy(en, A.ult.damage);
        text(a.x, a.y - 14, tr("ЗАДАЧА ГОТОВА", "TASK DONE"), a.color, 2.5);
      }
      a.state = "leaving";
      a.leave = 1.5;
      a.waiting = false;
      a.spirits.clear();
      // A ghost between its tasks is not done yet: its recording goes on.
      const ghostDone = !ghost || ghost.index >= ghost.queue.length;
      if (!classic && ghostDone && s.allies.every((x) => x.state !== "active")) {
        s.finaleAt = s.time + B.finale.seconds;
      }
    }

    // A game event from Sidequest; the ghost and the daily task have no real agents.
    function agentEvent(e) {
      if (ownAgents) handleEvent(e);
    }

    // The ghost's events, each at its time.
    function updateGhost() {
      const q = ghost.queue;
      while (ghost.index < q.length && q[ghost.index].at <= s.time) handleEvent(q[ghost.index++].event);
      // The recording is over: the ghost finishes its task, the finale follows.
      const last = q.length ? q[q.length - 1].at : 0;
      if (ghost.index >= q.length && s.time >= last + B.ghost.end_after) {
        for (const a of s.allies) leave(a, true);
        if (s.finaleAt === null && s.endAt === null && s.allies.every((a) => a.state !== "active")) {
          s.finaleAt = s.time + B.finale.seconds;
        }
      }
    }

    function handleEvent(e) {
      if (s.over || !e || typeof e.session !== "string") return;
      const create = REJOIN_KINDS.has(e.kind);
      const a = ally(e, create);
      if (!a) return;
      const src = (e.agent && a.spirits.get(e.agent)) || a;
      switch (e.kind) {
        case "tool":
          a.actions++;
          agentXp(B.xp.per_action[Object.hasOwn(B.xp.per_action, e.action) ? e.action : "generic"]);
          if (canAct(a)) ability(a, src, e);
          if (e.tool === "Bash") bashDone(a, src, e);
          if (a.actions % I.ally_every_actions === 0 && s.finaleAt === null && s.endAt === null) {
            drop(pickItem(), a.x + (random() - 0.5) * 20, a.y + 12);
          }
          break;
        case "tool_error":
          a.actions++;
          agentXp(B.xp.error);
          if (!e.agent) {
            a.stun = B.ally.stun_seconds;
            text(a.x, a.y - 12, tr("ОШИБКА", "ERROR"), "#d9534f");
          }
          // Failed tests turn the CI red instead of the usual rage.
          if (e.category === "test") redCi(a);
          else {
            s.rage = B.rage.seconds * s.stats.rage;
            s.met.rage = true;
          }
          break;
        case "waiting":
          a.waiting = true;
          a.waitingSince = typeof e.ts === "number" ? e.ts : null;
          break;
        case "resumed":
          if (a.waiting) answered(a, e);
          break;
        case "blocked":
          a.blocked = B.ally.blocked_seconds;
          text(a.x, a.y - 12, tr("ЗАПРЕТ", "BLOCKED"), "#d9534f", 1.5);
          break;
        case "compact":
          a.meditate = e.phase === "end" ? 0 : B.ally.compact_max_seconds;
          break;
        case "subagent_start":
          if (e.agent && !a.spirits.has(e.agent)) {
            const type = spiritType(e.agent_type);
            a.spirits.set(e.agent, {x: a.x, y: a.y, angle: random() * Math.PI * 2, type,
                                    cooldown: 0, until: s.time + A.summon.max_seconds});
            s.met["spirit_" + type] = true;
          }
          break;
        case "subagent_stop":
          a.spirits.delete(e.agent);
          break;
        case "stop":
          if (e.final) leave(a, true);
          break;
        case "session_end":
          leave(a, false);
          break;
      }
    }

    // --- the step ----------------------------------------------------------------

    function updateAllies(dt) {
      const p = s.player;
      for (const a of s.allies) {
        if (a.state === "gone") continue;
        if (a.state === "leaving") {
          a.leave -= dt;
          a.y -= 40 * dt;
          if (a.leave <= 0) a.state = "gone";
          continue;
        }
        a.stun = Math.max(0, a.stun - dt);
        a.blocked = Math.max(0, a.blocked - dt);
        a.meditate = Math.max(0, a.meditate - dt);
        const angle = a.slot * 2.4 + Math.PI * 0.75;
        let tx = p.x + Math.cos(angle) * B.ally.follow_distance;
        let ty = p.y + Math.sin(angle) * B.ally.follow_distance;
        // A wall in the way: around it along the enemies' path to the player.
        if (!T.flat && !clearPath(a, tx, ty, a.r)) {
          updateFlow();
          const w = waypoint(a);
          tx = w.x;
          ty = w.y;
        }
        const d = Math.hypot(tx - a.x, ty - a.y);
        if (d > 1 && a.stun <= 0) {
          const step = Math.min(d, B.ally.speed * dt * Math.max(1, d / 40));
          a.x += (tx - a.x) / d * step;
          a.y += (ty - a.y) / d * step;
        }
        pushOut(a, a.r, true);
        a.x = clamp(a.x, a.r, W - a.r);
        a.y = clamp(a.y, a.r, H - a.r);
        for (const [id, sp] of a.spirits) {
          if (s.time > sp.until) { a.spirits.delete(id); continue; }
          sp.angle += 3 * dt;
          sp.x = a.x + Math.cos(sp.angle) * A.summon.orbit;
          sp.y = a.y + Math.sin(sp.angle) * A.summon.orbit;
          sp.cooldown -= dt;
          if (sp.cooldown <= 0) spiritAct(a, sp);
        }
      }
    }

    // A subagent's spirit: Explore slows the enemies around it, Plan heals the player,
    // every other type shoots.
    function spiritAct(a, sp) {
      const SP = AG.spirits;
      if (sp.type === "scout") {
        const radius = SP.scout.radius * s.stats.area;
        effect({type: "ring", x: sp.x, y: sp.y, r: radius, color: "#7fb3e0", life: 0.5});
        nearby(sp.x, sp.y, radius + 20, (en) => {
          if (Math.hypot(en.x - sp.x, en.y - sp.y) <= radius + en.r) {
            en.slow = SP.scout.seconds;
            en.slowFactor = SP.scout.slow;
          }
        });
        sp.cooldown = SP.scout.every;
      } else if (sp.type === "plan") {
        const p = s.player;
        sp.cooldown = SP.plan.every;
        if (p.dead || p.hp >= s.stats.max_hp) return;
        const before = p.hp;
        p.hp = Math.min(s.stats.max_hp, p.hp + SP.plan.heal);
        text(p.x, p.y - 14, `+${Math.round(p.hp - before)}`, "#4fbf6f", 0.8);
        effect({type: "beam", x: sp.x, y: sp.y, x2: p.x, y2: p.y, r: 1, color: "#4fbf6f", life: 0.25});
      } else {
        const t = nearestEnemies(sp, 1, A.summon.range, true)[0];
        if (!t) return;
        const angle = Math.atan2(t.y - sp.y, t.x - sp.x);
        s.shots.push({x: sp.x, y: sp.y, vx: Math.cos(angle) * 200, vy: Math.sin(angle) * 200,
                      r: 2, damage: A.summon.damage * allyDamage(), pierce: 0,
                      hit: new Set(), life: 1, color: a.color});
        sp.cooldown = A.summon.cooldown;
      }
    }

    function updatePlayer(dt, input) {
      const p = s.player;
      p.invulnerable = Math.max(0, p.invulnerable - dt);
      if (p.dead > 0) {
        p.dead -= dt;
        if (p.dead <= 0) { p.dead = 0; respawn(); }
        return;
      }
      let ix = clamp(+input.x || 0, -1, 1), iy = clamp(+input.y || 0, -1, 1);
      const len = Math.hypot(ix, iy);
      if (len > 1) { ix /= len; iy /= len; }
      p.moving = len > 0; if (ix) p.face = ix < 0 ? -1 : 1;   // the hero looks where it walks
      p.x = clamp(p.x + ix * speed() * dt, p.r, W - p.r);
      p.y = clamp(p.y + iy * speed() * dt, p.r, H - p.r);
      pushOut(p, p.r, true);
      p.hp = Math.min(s.stats.max_hp, p.hp + s.stats.regen * dt);
      updateWeapons(dt);
    }

    function updateSpawns(dt) {
      if (s.finaleAt !== null || s.endAt !== null) return;
      const active = classic || s.allies.some((a) => a.state === "active"), minute = clockMinute();
      // Infinity's overtime lifts the cap as fast as the rate, up to its own.
      const over = overtimeMinutes();
      const cap = Math.min(Math.max(OT.max_per_second, B.spawn.max_per_second),
                           B.spawn.max_per_second + OT.spawn_per_minute * over);
      const rate = Math.min(cap,
                            B.spawn.base_per_second + B.spawn.per_minute * minute
                            + B.spawn.per_level * (s.level - 1) + OT.spawn_per_minute * over)
        * (active ? 1 : B.spawn.no_ally_factor) * (s.redCi > 0 ? AG.red_ci.spawn : 1)
        * (s.deploy ? EV.deploy.spawn : 1) * (trialRun ? trialRun.spawn : 1);
      s.spawnAcc += rate * dt;
      while (s.spawnAcc >= 1) {
        s.spawnAcc -= 1;
        if (s.enemies.length < B.spawn.max_alive) spawnAny(pickType(), true);
      }
      if (s.finalAt !== null && s.time >= s.finalAt) {
        s.finalAt = null;
        if (!spawnFinal()) s.finalAt = s.time + 1;   // no room now: a second later
      } else if (s.time >= s.nextBoss) {
        s.nextBoss += B.spawn.boss_every_minutes * 60;
        // In a classic run the final boss takes the last boss's place.
        if (s.finalAt === null ? !classic : s.time < s.finalAt - 1) spawnBoss(bossOrder[s.bossIndex++ % bossOrder.length]);
      }
    }

    // The final boss, or a campaign stage's boss: twins are both final. A trial's rush names
    // its own. Null when there is no room: the caller tries again.
    function spawnFinal(type) {
      const F = s.stage || {boss: type || "boss", hp: C.final_hp, score: C.final_score, final: true};
      const boss = spawnAny(F.boss), cfg = B.enemies[F.boss];
      if (!boss) return null;
      for (const e of [boss, boss.partner].filter(Boolean)) {
        Object.assign(e, {final: true, hp: e.hp * F.hp, maxHp: e.hp * F.hp, score: F.score});
      }
      s.met.final = true;
      const name = F.final ? tr("ФИНАЛЬНЫЙ БОСС", "FINAL BOSS") : tr(cfg.name, cfg.name_en).toUpperCase();
      text(s.player.x, s.player.y - 30, name, "#e8c14a", 3);
      return boss;
    }

    // What each kind of enemy does besides walking at the player; true: it moved itself.
    function behave(e, k, dt) {
      const cfg = B.enemies[e.type];
      if (e.elite === "vampire") e.hp = Math.min(e.maxHp, e.hp + e.maxHp * EL.kinds.vampire.regen * dt);
      // Spaghetti code leaves a sticky trail.
      if (cfg.trail && s.time >= (e.trailAt || 0)) {
        e.trailAt = s.time + cfg.trail.every;
        hazard({kind: "goo", x: e.x, y: e.y + e.r / 2, r: cfg.trail.radius, from: s.time,
                until: s.time + cfg.trail.seconds, slow: cfg.trail.slow});
      }
      // Technical debt piles up while it lives.
      if (cfg.growth && e.maxHp < e.baseHp * cfg.max_growth) {
        const add = e.baseHp * cfg.growth * dt;
        e.score *= (e.maxHp + add) / e.maxHp;
        e.hp += add;
        e.maxHp += add;
      }
      // Scope creep and out of memory grow in whole steps, so the sprite stays sharp.
      if (cfg.max_size) {
        const size = Math.min(cfg.max_size, 1 + Math.floor((s.time - e.born) / cfg.grow_every));
        if (size > e.size) {
          const g = size / e.size;
          e.size = size;
          e.r = cfg.radius * size;
          e.hp *= g;
          e.maxHp *= g;
          e.damage *= g;
          e.score *= g;
          effect({type: "ring", x: e.x, y: e.y, r: e.r + 6, color: "#e8e6f0", life: 0.4});
        }
      }
      // The monolith lets out microservices.
      if (cfg.release && s.time >= e.releaseAt) {
        e.releaseAt = s.time + cfg.release.every;
        for (let i = 0; i < cfg.release.count && s.enemies.length < B.spawn.max_alive; i++) {
          const angle = random() * Math.PI * 2;
          spawn(cfg.release.type, {x: e.x + Math.cos(angle) * e.r, y: e.y + Math.sin(angle) * e.r});
        }
      }
      if (cfg.fire) prodDown(e, cfg.fire);
      if (e.segments) { moveLoop(e, cfg, k, dt); return true; }
      if (cfg.leap_speed) return offByOne(e, cfg, dt);
      if (cfg.fire_every) return logSpam(e, cfg, k, dt);
      return false;
    }

    // The loop's centre follows the player; the head runs round it, its ring breathing in
    // and out; every piece of the body keeps its distance to the one in front.
    function moveLoop(e, cfg, k, dt) {
      const p = s.player, d = Math.hypot(p.x - e.cx, p.y - e.cy) || 1;
      const step = Math.min(d, e.speed * k * dt);
      e.cx = clamp(e.cx + (p.x - e.cx) / d * step, 0, W);
      e.cy = clamp(e.cy + (p.y - e.cy) / d * step, 0, H);
      e.angle += cfg.spin * k * dt;
      const orbit = cfg.orbit * (0.75 + 0.25 * Math.sin(s.time * 0.7));
      e.x = e.cx + Math.cos(e.angle) * orbit;
      e.y = e.cy + Math.sin(e.angle) * orbit;
      let lead = e;
      for (const seg of e.segments) {
        const dx = seg.x - lead.x, dy = seg.y - lead.y, dd = Math.hypot(dx, dy);
        if (dd > cfg.spacing) {
          seg.x = lead.x + dx / dd * cfg.spacing;
          seg.y = lead.y + dy / dd * cfg.spacing;
        }
        seg.hp = e.hp;
        seg.maxHp = e.maxHp;
        lead = seg;
      }
    }

    // Off-by-one stops a step short of the player, then jumps at where the player was.
    function offByOne(e, cfg, dt) {
      const p = s.player;
      if (e.leap) {
        const L = e.leap, d = Math.hypot(L.x - e.x, L.y - e.y), step = cfg.leap_speed * dt;
        if (d > step) {
          e.x += (L.x - e.x) / d * step;
          e.y += (L.y - e.y) / d * step;
        }
        if (d <= step || s.time >= L.until) { e.leap = null; e.restUntil = s.time + cfg.rest; }
        return true;
      }
      if (e.windupAt) {
        if (s.time >= e.windupAt) {
          e.windupAt = null;
          e.leap = {x: p.x, y: p.y, until: s.time + cfg.leap_seconds};
        }
        return true;
      }
      if (!p.dead && s.time >= (e.restUntil || 0) && Math.hypot(p.x - e.x, p.y - e.y) <= cfg.stop) {
        e.windupAt = s.time + cfg.windup;
        return true;
      }
      return false;
    }

    // The log spammer keeps its distance and fires lines of logs at the player.
    function logSpam(e, cfg, k, dt) {
      const p = s.player, d = Math.hypot(p.x - e.x, p.y - e.y) || 1;
      if (!p.dead && s.time >= e.fireAt && d <= cfg.range) {
        e.fireAt = s.time + cfg.fire_every;
        const angle = Math.atan2(p.y - e.y, p.x - e.x);
        s.enemyShots.push({x: e.x, y: e.y, vx: Math.cos(angle) * cfg.shot_speed,
                           vy: Math.sin(angle) * cfg.shot_speed, r: 3, life: cfg.range * 1.5 / cfg.shot_speed,
                           damage: cfg.shot_damage * (1 + B.spawn.damage_growth_per_minute * clockMinute())});
      }
      if (d > cfg.keep) return false;
      if (d < cfg.keep * 0.7) {
        e.x -= (p.x - e.x) / d * e.speed * k * dt;
        e.y -= (p.y - e.y) / d * e.speed * k * dt;
      }
      return true;
    }

    // Prod is down: the floor catches fire under the player, after a warning, and behind it.
    function prodDown(e, F) {
      const p = s.player;
      if (s.time >= e.fireAt && !p.dead) {
        e.fireAt = s.time + F.every;
        for (let i = 0; i < F.count; i++) {
          const angle = random() * Math.PI * 2, d = i ? random() * F.spread : 0;
          hazard({kind: "fire", x: clamp(p.x + Math.cos(angle) * d, 0, W), y: clamp(p.y + Math.sin(angle) * d, 0, H),
                  r: F.radius, from: s.time + F.warn, until: s.time + F.warn + F.seconds, damage: F.damage});
        }
      }
      if (s.time >= e.trailAt) {
        e.trailAt = s.time + F.trail_every;
        hazard({kind: "fire", x: e.x, y: e.y, r: F.trail_radius, from: s.time + 0.4,
                until: s.time + 0.4 + F.seconds, damage: F.damage});
      }
    }

    // --- the floor: sticky goo and fire --------------------------------------------------

    function hazard(h) {
      s.hazards.push(h);
      if (s.hazards.length > 160) s.hazards.shift();
    }

    function updateHazards() {
      const p = s.player;
      s.hazards = s.hazards.filter((h) => s.time < h.until);
      p.sticky = 1;
      if (p.dead) return;
      for (const h of s.hazards) {
        if (s.time < h.from || dist2(h, p) > h.r * h.r) continue;
        if (h.kind === "goo") p.sticky = Math.min(p.sticky, h.slow);
        else if (h.kind === "fire") hurtPlayer(h.damage);
      }
    }

    // Lines of logs: they stop at walls and hurt the player.
    function updateEnemyShots(dt) {
      const p = s.player;
      for (const sh of s.enemyShots) {
        sh.life -= dt;
        sh.x += sh.vx * dt;
        sh.y += sh.vy * dt;
        if (sh.x < 0 || sh.y < 0 || sh.x > W || sh.y > H || inWall(sh.x, sh.y, 0)) sh.life = 0;
        if (sh.life > 0 && !p.dead && Math.hypot(p.x - sh.x, p.y - sh.y) < p.r + sh.r) {
          hurtPlayer(sh.damage);
          sh.life = 0;
        }
      }
      s.enemyShots = s.enemyShots.filter((sh) => sh.life > 0);
    }

    function updateComebacks() {
      for (const c of s.comebacks) {
        if (s.time < c.at) continue;
        c.done = true;
        if (s.finaleAt !== null || s.endAt !== null) continue;
        const e = spawn(c.type, {x: c.x, y: c.y}, {returned: true, hpScale: B.enemies[c.type].return_hp});
        effect({type: "ring", x: e.x, y: e.y, r: 14, color: "#d9534f", life: 0.4});
      }
      s.comebacks = s.comebacks.filter((c) => !c.done);
    }

    // --- arena events: a Friday deploy, an incident (events.js) ----------------------------

    const events = root.LCSEvents.create(B, s, {random, text, effect, tr, drop, inWall, size: {width: W, height: H}});

    // A new one in a few minutes, while the arena is alive and the final boss is not up.
    function updateEvents(dt) {
      events.update(dt);
      const live = classic || s.allies.some((a) => a.state === "active");
      if (s.deploy || s.incident || s.time < s.eventAt || s.finaleAt !== null || s.endAt !== null
          || !live || (classic && s.finalAt === null)) return;
      events.start(s.nextEvent);
    }

    function updateEnemies(dt) {
      const p = s.player;
      const rageSpeed = (s.rage > 0 ? B.rage.speed : 1) * (s.redCi > 0 ? AG.red_ci.speed : 1);
      const rageDamage = s.rage > 0 ? B.rage.damage : 1;
      if (!T.flat) updateFlow();
      for (const e of s.enemies) {
        e.flash = Math.max(0, e.flash - dt);
        if (e.slow > 0) e.slow -= dt;
        if (e.revive && s.time >= e.revive.at) reviveTwin(e);
        if (e.blinkAt !== undefined && s.time >= e.blinkAt) blink(e);
        const k = (e.slow > 0 ? e.slowFactor : 1) * rageSpeed;
        // The loop's body moves with its head.
        if (!e.head && !behave(e, k, dt)) {
          // Deprecated is a ghost: straight through the walls.
          const to = e.ghost ? p : waypoint(e);
          const d = Math.hypot(to.x - e.x, to.y - e.y) || 1;
          e.x += (to.x - e.x) / d * e.speed * k * dt;
          e.y += (to.y - e.y) / d * e.speed * k * dt;
        }
        if (!p.dead && Math.hypot(p.x - e.x, p.y - e.y) < e.r + p.r && hurtPlayer(e.damage * rageDamage)
            && e.elite === "vampire") {
          e.hp = Math.min(e.maxHp, e.hp + e.maxHp * EL.kinds.vampire.heal);
          effect({type: "ring", x: e.x, y: e.y, r: e.r + 4, color: "#d9534f", life: 0.3});
        }
      }
      // Keep enemies from collapsing into one blob; the loop keeps its shape.
      rebuildGrid();
      for (const e of s.enemies) {
        if (e.rigid) continue;
        nearby(e.x, e.y, e.r * 2, (o) => {
          if (o === e || o.rigid) return;
          const dx = e.x - o.x, dy = e.y - o.y, d = Math.hypot(dx, dy) || 0.01, min = e.r + o.r;
          if (d < min) {
            const push = (min - d) / 2 / d;
            e.x += dx * push; e.y += dy * push;
            o.x -= dx * push; o.y -= dy * push;
          }
        });
      }
      for (const e of s.enemies) {
        if (!e.ghost && !e.noclip) pushOut(e, e.r);
        e.x = clamp(e.x, e.r, W - e.r);
        e.y = clamp(e.y, e.r, H - e.r);
      }
      rebuildGrid();
    }

    function release(sh) { if (sh.aim) { sh.aim.incoming -= sh.damage; sh.aim = null; } }

    function updateShots(dt) {
      for (const sh of s.shots) {
        sh.life -= dt;
        if (sh.target) {
          if (sh.target.dead) sh.target = nearestEnemies(sh, 1, 200)[0] || null;
          if (sh.target) {
            const speed = Math.hypot(sh.vx, sh.vy);
            const want = Math.atan2(sh.target.y - sh.y, sh.target.x - sh.x);
            let angle = Math.atan2(sh.vy, sh.vx);
            let diff = Math.atan2(Math.sin(want - angle), Math.cos(want - angle));
            angle += clamp(diff, -A.attack.turn * dt, A.attack.turn * dt);
            sh.vx = Math.cos(angle) * speed;
            sh.vy = Math.sin(angle) * speed;
          }
        }
        sh.x += sh.vx * dt;
        sh.y += sh.vy * dt;
        if (sh.x < 0 || sh.y < 0 || sh.x > W || sh.y > H) sh.life = 0;
        // Bullets stop at walls; the allies' homing missiles are magic and fly through.
        if (!sh.target && T.shot(sh)) sh.life = 0;
        if (sh.life <= 0) continue;
        nearby(sh.x, sh.y, sh.r + 20, (e) => {
          if (sh.life <= 0 || sh.hit.has(e)) return;
          if (Math.hypot(e.x - sh.x, e.y - sh.y) <= e.r + sh.r) {
            sh.hit.add(e);
            if (e === sh.aim) release(sh);
            // A flaky test: the bullet may just go past.
            const miss = B.enemies[e.type].miss;
            if (miss && random() < miss) {
              effect({type: "miss", x: e.x, y: e.y - e.r - 4, life: 0.35});
              return;
            }
            hurtEnemy(e, sh.damage);
            if (sh.pierce-- <= 0) sh.life = 0;
          }
        });
      }
    }

    function step(dt, input) {
      if (s.over || s.choices) return;
      s.time += dt;
      s.rage = Math.max(0, s.rage - dt);
      if (mod("eternal_rage")) { s.rage = Math.max(s.rage, 1); s.met.rage = true; }
      s.redCi = Math.max(0, s.redCi - dt);
      s.streakTimer -= dt;
      if (s.streakTimer <= 0) s.streak = 0;
      s.multiplier = Math.min(B.score.max_multiplier,
        1 + Math.floor(s.streak / B.score.streak_step) * B.score.multiplier_step);
      s.maxMultiplier = Math.max(s.maxMultiplier, s.multiplier);
      s.score += B.score.per_second * dt;

      updateHazards();
      T.update(dt, s);
      updatePlayer(dt, input || {});
      kit.update(dt, input);
      if (ghost) updateGhost();
      updateAllies(dt);
      updateOrchestra();
      updateTurrets(dt);
      updateSpawns(dt);
      updateEnemies(dt);
      updateShots(dt);
      updateEnemyShots(dt);
      updateComebacks();
      updateEvents(dt);
      updateMines();
      updateItems(dt);
      if (classic) updateGems(dt);

      s.enemies = s.enemies.filter((e) => !e.dead);
      for (const sh of s.shots) if (sh.life <= 0) release(sh);
      s.shots = s.shots.filter((sh) => sh.life > 0);
      for (const list of [s.effects, s.texts]) for (const x of list) x.t += dt;
      s.effects = s.effects.filter((x) => x.t < x.life);
      s.texts = s.texts.filter((x) => x.t < x.life);

      if (trialRun) trialRun.update();
      if (s.finaleAt !== null && s.time >= s.finaleAt) finish("done");
      if (s.endAt !== null && s.time >= s.endAt) finish(s.endReason);
    }

    function finish(reason) {
      if (s.over) return s.results;
      s.over = true;
      s.choices = s.choiceKind = null;
      s.results = {reason, mode: s.mode, with_agent: classic ? s.withAgent : true, map: map.id,
                   time: Math.round(s.time), score: Math.floor(s.score * s.scoreMul), kills: s.kills,
                   damage_taken: Math.round(s.damageTaken), deaths: s.deaths, level: s.level,
                   best_streak: s.bestStreak, allies: s.allies.length, bosses: s.bosses,
                   items: s.picked, gear: s.gear.length, max_multiplier: s.maxMultiplier,
                   synced: s.synced, weapons: s.weapons.length, evolutions: s.evolutions,
                   commits: s.commits, pushes: s.pushes, turrets: s.turretsBuilt, reviews: s.reviews,
                   elites: s.elites, incidents: s.incidents, deploys: s.deploys,
                   boss_kinds: Object.keys(s.bossKinds).length,
                   modifiers: s.modifiers.length, modifier_ids: s.modifiers.slice(),
                   score_mul: Math.round(s.scoreMul * 100) / 100, class: s.cls.id, crits: s.crits || 0,
                   abilities: s.abilityUses || 0, stage: s.stage ? s.stage.index + 1 : 0,
                   weapon_ids: s.weapons.map((w) => w.id),
                   evolved_ids: s.weapons.filter((w) => w.evolved).map((w) => w.id)};
      if (ghost) s.results.ghost = ghost.session;
      if (s.mode === "daily") s.results.day = s.day;
      if (trial) Object.assign(s.results, {trial: trial.id, trial_time: s.trial.time || null});
      return s.results;
    }

    // --- dev panel ---------------------------------------------------------------

    const dev = {
      immortal() { s.immortal = !s.immortal; return s.immortal; },
      level() { addXp(s.xpNext - s.xp); },
      upgrade() {
        const {rest} = offers();
        if (rest.length) take(rest[Math.floor(random() * rest.length)]);
      },
      // The next weapon not held yet while there is a free slot, or else every weapon one
      // level up.
      weapon(id) {
        const cfg = B.weapons.find((w) => (id ? w.id === id : !s.weapons.some((x) => x.id === w.id)));
        if (cfg && !s.weapons.some((x) => x.id === cfg.id) && s.weapons.length < B.build.weapon_slots) {
          take("weapon:" + cfg.id);
        } else for (const w of s.weapons) w.level = Math.min(w.level + 1, WEAPONS.get(w.id).levels.length + 1);
      },
      // Every weapon held: maxed out and evolved.
      evolve() {
        for (const w of s.weapons) {
          w.level = WEAPONS.get(w.id).levels.length + 1;
          take("evolution:" + w.id);
        }
      },
      wave() { for (let i = 0; i < B.spawn.wave_size; i++) spawnAny(pickType()); },
      boss(type) { spawnBoss(B.enemies[type] && B.enemies[type].boss ? type : "boss"); },
      elite(type, kind) {
        const e = spawn(B.enemies[type] ? type : "grunt");
        if (e) makeElite(e, kind);
      },
      event(kind) { if (!s.deploy && !s.incident) events.start(kind === "deploy" ? "deploy" : "incident"); },
      final() { if (!spawnFinal()) s.finalAt = s.time + 1; },
      // The final boss (or a stage's boss) comes and goes down at once: a campaign's next stage.
      stage() {
        spawnFinal();
        for (const e of s.enemies.filter((x) => x.final && !x.dead)) hurtEnemy(e, e.hp + 1);
      },
      item() { drop(pickItem(), s.player.x + 30, s.player.y); },
      chest() { drop("chest", s.player.x + 30, s.player.y, true); },
      enemy(type) { spawnAny(B.enemies[type] ? type : s.map.special || "grunt"); },
      finale() {
        for (const a of s.allies) leave(a, true);
        s.finaleAt = s.time + B.finale.seconds;
      },
    };

    // The part of the arena on screen: enemies appear just outside it.
    function setView(width, height) {
      if (Number.isFinite(width) && Number.isFinite(height)) s.view = {width, height};
    }

    return {state: s, step, agentEvent, choose, reroll, banish, finish, setView, dev, ability: kit.use};
  }

  root.LCS = {createGame};
})(typeof window !== "undefined" ? window : globalThis);
