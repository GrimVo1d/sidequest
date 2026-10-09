// Last Commit Standing: the simulation. No DOM here, so tests run it in jsc.
//   const game = LCS.createGame(balance, {seed: 1, map: LCS_MAPS[0]});   // maps.js
//   game.agentEvent(event)        // a game event from Sidequest.on("*")
//   game.step(1 / 60, {x, y})      // input: movement direction, each -1..1
//   game.state                     // everything render.js draws
"use strict";

(function (root) {
  const ALLY_COLORS = ["#4fbf6f", "#5b8bd0", "#d07ad0", "#e89a4a", "#7fe0e0", "#e86a6a"];
  const REJOIN_KINDS = new Set(["session_start", "prompt", "tool", "tool_error",
                                "subagent_start", "compact"]);

  // Small seeded random generator (mulberry32): tests replay the same match.
  function makeRandom(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function createGame(B, options) {
    const random = makeRandom((options && options.seed) || Date.now());
    const map = (options && options.map)
      || {id: "open", name: "Open space", width: B.arena.width, height: B.arena.height, walls: []};
    const W = map.width, H = map.height;
    const WALLS = map.walls.map(([x, y, w, h]) => ({x, y, w, h}));
    const A = B.abilities;
    const CELL = 32;

    const s = {
      time: 0, over: false, finaleAt: null, results: null, immortal: false,
      map: {id: map.id, name: map.name, theme: map.theme || "office", width: W, height: H,
            walls: WALLS},
      player: {x: W / 2, y: H / 2, r: B.player.radius, hp: B.player.hp, invulnerable: 0,
               dead: 0, cooldown: 0, ammo: B.player.weapon.magazine, reload: 0, reloadTotal: 0,
               shield: 0, moving: false, aim: 0, firedAt: -1, hurtAt: -1},
      stats: {damage: B.player.weapon.damage, interval: B.player.weapon.interval,
              magazine: B.player.weapon.magazine, reload: B.player.weapon.reload,
              projectiles: B.player.weapon.projectiles, pierce: B.player.weapon.pierce,
              speed: B.player.speed, max_hp: B.player.hp, regen: 0,
              ally_damage: 1, ally_area: 1, ally_missiles: 0},
      taken: {}, level: 1, xp: 0, xpNext: B.xp.first_level, pendingLevels: 0, choices: null,
      enemies: [], shots: [], effects: [], texts: [], allies: [], items: [],
      buffs: {coffee: 0, duck: 0}, itemAt: B.items.every_seconds,
      spawnAcc: 0, nextBoss: B.spawn.boss_every_minutes * 60, rage: 0,
      score: 0, kills: 0, damageTaken: 0, deaths: 0, streak: 0, streakTimer: 0,
      bestStreak: 0, multiplier: 1, everAlly: false,
    };
    const bySession = new Map();
    let grid = new Map();

    // --- helpers -----------------------------------------------------------------

    function text(x, y, value, color, life) {
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

    function nearestEnemies(from, n, range) {
      const r2 = range * range;
      return s.enemies.filter((e) => !e.dead && dist2(e, from) <= r2)
        .sort((a, b) => dist2(a, from) - dist2(b, from)).slice(0, n);
    }

    // Stats with item buffs on top of upgrades.
    const I = B.items;
    const speed = () => s.stats.speed * (s.buffs.coffee > 0 ? I.coffee.speed : 1);
    const interval = () => s.stats.interval * (s.buffs.coffee > 0 ? I.coffee.fire : 1);
    const reloadTime = () => s.stats.reload * (s.buffs.coffee > 0 ? I.coffee.fire : 1);
    const pierce = () => Math.round(s.stats.pierce) + (s.buffs.duck > 0 ? I.duck.pierce : 0);

    // --- walls -------------------------------------------------------------------

    const inWall = (x, y, r) => WALLS.some((w) => x > w.x - r && x < w.x + w.w + r
                                                && y > w.y - r && y < w.y + w.h + r);

    // Moves a circle out of every wall it overlaps, so it slides along them.
    function pushOut(o, r) {
      for (const w of WALLS) {
        const nx = clamp(o.x, w.x, w.x + w.w), ny = clamp(o.y, w.y, w.y + w.h);
        const dx = o.x - nx, dy = o.y - ny, d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          o.x = nx + dx / d * r;
          o.y = ny + dy / d * r;
        } else {
          // The centre is inside the wall: leave by the nearest side.
          const sides = [[o.x - w.x, w.x - r, o.y], [w.x + w.w - o.x, w.x + w.w + r, o.y],
                         [o.y - w.y, o.x, w.y - r], [w.y + w.h - o.y, o.x, w.y + w.h + r]];
          const best = sides.reduce((a, b) => (b[0] < a[0] ? b : a));
          o.x = best[1];
          o.y = best[2];
        }
      }
    }

    // Enemies find their way around walls along a distance field: a breadth-first search
    // over 16 px cells from the player's cell, redone when the player changes cell.
    const FCELL = 16, FW = Math.ceil(W / FCELL), FH = Math.ceil(H / FCELL);
    const blocked = new Uint8Array(FW * FH);
    for (let c = 0; c < FW * FH; c++) {
      blocked[c] = inWall((c % FW + 0.5) * FCELL, (Math.floor(c / FW) + 0.5) * FCELL, 6) ? 1 : 0;
    }
    const flow = new Int32Array(FW * FH).fill(-1);
    const queue = new Int32Array(FW * FH);
    let flowFrom = -1;
    const cellOf = (o) => clamp(Math.floor(o.x / FCELL), 0, FW - 1)
      + clamp(Math.floor(o.y / FCELL), 0, FH - 1) * FW;
    const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

    // A diagonal step is allowed only if both straight steps next to it are open.
    function open(cx, cy, dx, dy) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= FW || y >= FH || blocked[x + y * FW]) return false;
      return !dx || !dy || (!blocked[cx + dx + cy * FW] && !blocked[cx + (cy + dy) * FW]);
    }

    function updateFlow() {
      const start = cellOf(s.player);
      if (start === flowFrom) return;
      flowFrom = start;
      flow.fill(-1);
      flow[start] = 0;
      let head = 0, tail = 0;
      queue[tail++] = start;
      while (head < tail) {
        const c = queue[head++], cx = c % FW, cy = (c - cx) / FW;
        for (const [dx, dy] of STEPS) {
          if (!open(cx, cy, dx, dy)) continue;
          const n = cx + dx + (cy + dy) * FW;
          if (flow[n] < 0) { flow[n] = flow[c] + 1; queue[tail++] = n; }
        }
      }
    }

    // Where an enemy should head: the player, or the next cell towards the player.
    function waypoint(e) {
      const p = s.player;
      if (!WALLS.length) return p;
      const c = cellOf(e);
      if (flow[c] >= 0 && flow[c] <= 2) return p;
      const cx = c % FW, cy = (c - cx) / FW;
      let best = -1, bestFlow = flow[c] >= 0 ? flow[c] : Infinity;
      for (const [dx, dy] of STEPS) {
        if (!open(cx, cy, dx, dy)) continue;
        const n = cx + dx + (cy + dy) * FW;
        if (flow[n] >= 0 && flow[n] < bestFlow) { bestFlow = flow[n]; best = n; }
      }
      if (best < 0) return p;
      return {x: (best % FW + 0.5) * FCELL, y: (Math.floor(best / FW) + 0.5) * FCELL};
    }

    // --- enemies -----------------------------------------------------------------

    function spawn(type, at) {
      const cfg = B.enemies[type];
      const minute = s.time / 60;
      let x, y;
      if (at) {
        ({x, y} = at);
      } else {
        // Just off screen, outside walls; give up after a few tries.
        let tries = 0;
        do {
          const angle = random() * Math.PI * 2;
          const d = Math.hypot(B.view.width, B.view.height) / 2 + 20 + random() * 40;
          x = clamp(s.player.x + Math.cos(angle) * d, cfg.radius, W - cfg.radius);
          y = clamp(s.player.y + Math.sin(angle) * d, cfg.radius, H - cfg.radius);
        } while (inWall(x, y, cfg.radius) && ++tries < 10);
        if (tries >= 10) return;
      }
      // Difficulty follows both the clock and the player's level, so a busy agent
      // (many level-ups) and a slow one both keep the arena tense.
      const hp = cfg.hp * (1 + B.spawn.hp_growth_per_minute * minute
                           + B.spawn.hp_growth_per_level * (s.level - 1));
      const speed = cfg.speed * (1 + Math.min(B.spawn.max_speed_growth,
                                              B.spawn.speed_growth_per_minute * minute));
      const damage = cfg.damage * (1 + B.spawn.damage_growth_per_minute * minute);
      s.enemies.push({type, x, y, r: cfg.radius, hp, maxHp: hp, speed, damage,
                      score: cfg.score, slow: 0, slowFactor: 1,
                      flash: 0, dead: false, incoming: 0, born: s.time});
    }

    function pickType() {
      const minute = s.time / 60;
      const pool = Object.entries(B.spawn.weights)
        .filter(([type]) => minute >= (B.enemies[type].from_minute || 0));
      let roll = random() * pool.reduce((sum, [, w]) => sum + w, 0);
      for (const [type, w] of pool) {
        roll -= w;
        if (roll <= 0) return type;
      }
      return pool[0][0];
    }

    function hurtEnemy(e, damage) {
      if (e.dead) return;
      e.hp -= damage;
      e.flash = 0.1;
      if (e.hp <= 0) killEnemy(e);
    }

    function killEnemy(e) {
      e.dead = true;
      s.kills++;
      s.streak++;
      s.streakTimer = B.score.streak_window;
      s.bestStreak = Math.max(s.bestStreak, s.streak);
      s.score += e.score * s.multiplier;
      effect({type: "pop", x: e.x, y: e.y, r: e.r, kind: e.type, life: 0.3,
              color: e.type === "boss" ? "#e8c14a" : "#e8e6f0"});
      if (e.type === "boss") {
        for (let i = 0; i < I.boss_drops; i++) {
          drop(i ? pickItem() : "medkit", e.x + (random() - 0.5) * 40, e.y + (random() - 0.5) * 40);
        }
      } else if (random() < I.drop_chance) {
        drop(pickItem(), e.x, e.y);
      }
    }

    // --- items -------------------------------------------------------------------

    function pickItem() {
      const pool = Object.entries(I.weights);
      let roll = random() * pool.reduce((sum, [, w]) => sum + w, 0);
      for (const [type, w] of pool) {
        roll -= w;
        if (roll <= 0) return type;
      }
      return pool[0][0];
    }

    function drop(type, x, y) {
      if (s.items.length >= I.max_on_map) return;
      const o = {x: clamp(x, 8, W - 8), y: clamp(y, 8, H - 8)};
      pushOut(o, 8);
      s.items.push({type, x: o.x, y: o.y, t: 0, life: I.lifetime});
    }

    // Now and then an item appears somewhere near the player, in the open.
    function placeItem() {
      const p = s.player;
      for (let tries = 0; tries < 10; tries++) {
        const angle = random() * Math.PI * 2, d = 60 + random() * 140;
        const x = clamp(p.x + Math.cos(angle) * d, 12, W - 12);
        const y = clamp(p.y + Math.sin(angle) * d, 12, H - 12);
        if (!inWall(x, y, 10)) { drop(pickItem(), x, y); return; }
      }
    }

    function pickUp(it) {
      const p = s.player;
      it.life = 0;
      effect({type: "pickup", x: it.x, y: it.y, item: it.type, life: 0.3});
      switch (it.type) {
        case "medkit": {
          const before = p.hp;
          p.hp = Math.min(s.stats.max_hp, p.hp + I.medkit.heal);
          text(p.x, p.y - 14, `+${Math.round(p.hp - before)}`, "#4fbf6f");
          break;
        }
        case "coffee":
          s.buffs.coffee = I.coffee.seconds;
          text(p.x, p.y - 14, "КОФЕ", "#e89a4a");
          break;
        case "duck":
          s.buffs.duck = I.duck.seconds;
          text(p.x, p.y - 14, "УТОЧКА", "#e8c14a");
          break;
        case "shield":
          p.shield = I.shield.hits;
          text(p.x, p.y - 14, "ЩИТ", "#5b8bd0");
          break;
      }
    }

    function updateItems(dt) {
      const p = s.player;
      s.buffs.coffee = Math.max(0, s.buffs.coffee - dt);
      s.buffs.duck = Math.max(0, s.buffs.duck - dt);
      if (s.finaleAt === null && s.time >= s.itemAt) {
        s.itemAt = s.time + I.every_seconds;
        placeItem();
      }
      const reach = I.pickup_radius + p.r;
      for (const it of s.items) {
        it.t += dt;
        if (it.t >= it.life) it.life = 0;
        else if (!p.dead && (it.x - p.x) ** 2 + (it.y - p.y) ** 2 <= reach * reach) pickUp(it);
      }
      s.items = s.items.filter((it) => it.life > 0);
    }

    function explode(x, y, radius, damage, color) {
      effect({type: "ring", x, y, r: radius, color, life: 0.35});
      nearby(x, y, radius + 20, (e) => {
        if (Math.hypot(e.x - x, e.y - y) <= radius + e.r) hurtEnemy(e, damage);
      });
    }

    // --- player ------------------------------------------------------------------

    function hurtPlayer(damage) {
      const p = s.player;
      if (s.immortal || p.dead || p.invulnerable > 0) return;
      p.invulnerable = B.player.hit_invulnerable;
      p.hurtAt = s.time;
      if (p.shield > 0) {
        p.shield--;
        effect({type: "ring", x: p.x, y: p.y, r: 14, color: "#5b8bd0", life: 0.3});
        return;
      }
      p.hp -= damage;
      s.damageTaken += damage;
      s.streak = 0;
      if (p.hp <= 0) {
        p.hp = 0;
        p.dead = B.player.respawn_seconds;
        s.deaths++;
        s.score = Math.max(0, s.score - B.player.death_penalty);
        text(p.x, p.y - 12, `−${B.player.death_penalty}`, "#d9534f", 2);
      }
    }

    function respawn() {
      const p = s.player;
      p.hp = s.stats.max_hp;
      p.invulnerable = B.player.respawn_invulnerable;
      p.ammo = Math.round(s.stats.magazine);
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

    function startReload() {
      const p = s.player;
      p.reload = p.reloadTotal = reloadTime();
    }

    // The weapon fires on its own while there are rounds in the magazine, then reloads.
    // With no target in range a partly spent magazine is reloaded right away.
    function updateWeapon(dt) {
      const p = s.player;
      p.cooldown -= dt;
      if (p.reload > 0) {
        p.reload -= dt;
        if (p.reload <= 0) { p.reload = 0; p.ammo = Math.round(s.stats.magazine); }
      } else if (p.cooldown <= 0) {
        if (fireWeapon()) {
          p.cooldown = interval();
          if (--p.ammo <= 0) startReload();
        } else if (p.ammo < Math.round(s.stats.magazine)) {
          startReload();
        }
      }
    }

    // Shots in flight are counted against their target (`incoming`), so a quick burst
    // spreads over the crowd instead of piling into one enemy that is already done for.
    function fireWeapon() {
      const p = s.player, st = s.stats, w = B.player.weapon;
      const n = Math.round(st.projectiles);
      const r2 = w.range * w.range;
      const targets = s.enemies.filter((e) => !e.dead && e.incoming < e.hp && dist2(e, p) <= r2)
        .sort((a, b) => dist2(a, p) - dist2(b, p)).slice(0, n);
      if (!targets.length) return false;
      p.aim = Math.atan2(targets[0].y - p.y, targets[0].x - p.x);
      p.firedAt = s.time;
      for (let i = 0; i < n; i++) {
        const t = targets[i % targets.length];
        let angle = Math.atan2(t.y - p.y, t.x - p.x);
        if (i >= targets.length) angle += (i - targets.length + 1) * 0.25 * (i % 2 ? 1 : -1);
        s.shots.push({x: p.x, y: p.y, vx: Math.cos(angle) * w.speed, vy: Math.sin(angle) * w.speed,
                      r: w.radius, damage: st.damage, pierce: pierce(), hit: new Set(),
                      life: w.range / w.speed + 0.2, color: "#e8d36a", aim: t});
        t.incoming += st.damage;
      }
      return true;
    }

    // --- level-ups ---------------------------------------------------------------

    function addXp(n) {
      s.xp += n;
      while (s.xp >= s.xpNext) {
        s.xp -= s.xpNext;
        s.level++;
        s.pendingLevels++;
        s.xpNext = Math.round(s.xpNext * B.xp.growth);
        text(s.player.x, s.player.y - 16, "LEVEL UP", "#e8c14a", 1.5);
      }
      if (s.pendingLevels && !s.choices) offerChoices();
    }

    function offerChoices() {
      const open = B.upgrades.filter((u) => (s.taken[u.id] || 0) < (u.max_level || 5));
      if (!open.length) { s.pendingLevels = 0; return; }
      const picked = [];
      while (picked.length < 3 && picked.length < open.length) {
        const u = open[Math.floor(random() * open.length)];
        if (!picked.includes(u)) picked.push(u);
      }
      s.choices = picked.map((u) => ({id: u.id, name: u.name, text: u.text,
                                      level: (s.taken[u.id] || 0) + 1}));
    }

    function applyUpgrade(u) {
      s.taken[u.id] = (s.taken[u.id] || 0) + 1;
      if (u.mul) s.stats[u.stat] *= u.mul;
      if (u.add) s.stats[u.stat] += u.add;
      if (u.stat === "max_hp" && !s.player.dead) s.player.hp += u.add || 0;
      if (u.stat === "magazine" && s.player.reload <= 0) s.player.ammo += u.add || 0;
      if (u.heal && !s.player.dead) s.player.hp = s.stats.max_hp;
    }

    function choose(index) {
      if (!s.choices || !s.choices[index]) return false;
      applyUpgrade(B.upgrades.find((u) => u.id === s.choices[index].id));
      s.choices = null;
      s.pendingLevels--;
      if (s.pendingLevels > 0) offerChoices();
      return true;
    }

    // --- allies: the agents ------------------------------------------------------

    function ally(e, create) {
      let a = bySession.get(e.session);
      if (!a) {
        if (!create) return null;
        const slot = s.allies.length;
        a = {session: e.session, project: e.project || "?", color: ALLY_COLORS[slot % ALLY_COLORS.length],
             slot, x: s.player.x, y: s.player.y, r: B.ally.radius, state: "active", leave: 0,
             stun: 0, blocked: 0, meditate: 0, spirits: new Map(), actions: 0};
        bySession.set(e.session, a);
        s.allies.push(a);
        text(a.x, a.y - 12, a.project, a.color, 2);
      } else if (a.state !== "active" && create) {
        a.state = "active";
        a.x = s.player.x; a.y = s.player.y;
        text(a.x, a.y - 12, "снова в бою", a.color, 2);
      }
      if (a.state === "active") {
        s.everAlly = true;
        if (s.finaleAt !== null && !s.over) s.finaleAt = null;
      }
      return a;
    }

    const canAct = (a) => a.state === "active" && a.stun <= 0 && a.blocked <= 0 && a.meditate <= 0;

    function ability(a, src, e) {
      const st = s.stats;
      switch (e.action) {
        case "attack": {
          const lines = (e.lines_added || 0) + (e.lines_removed || 0);
          const damage = Math.min(A.attack.max_damage, A.attack.damage + A.attack.per_line * lines)
            * st.ally_damage;
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
          const radius = A.scout.radius * st.ally_area;
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
          const cfg = e.category === "test" ? A.cast_test : A.cast;
          const target = nearestEnemies(src, 1, A.cast.range)[0] || src;
          explode(target.x, target.y, cfg.radius * st.ally_area, cfg.damage * st.ally_damage,
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
              hurtEnemy(en, A.scout_far.damage * st.ally_damage);
            }
          }
          break;
        }
        case "todo":
          break;
        case "summon":
          explode(src.x, src.y, A.generic.radius * 1.5 * st.ally_area,
                  A.generic.damage * 2 * st.ally_damage, a.color);
          break;
        default:
          explode(src.x, src.y, A.generic.radius * st.ally_area, A.generic.damage * st.ally_damage,
                  a.color);
      }
    }

    function leave(a, ult) {
      if (a.state !== "active") return;
      if (ult) {
        effect({type: "ult", x: a.x, y: a.y, r: Math.hypot(B.view.width, B.view.height),
                color: a.color, life: 0.8});
        for (const en of s.enemies) hurtEnemy(en, A.ult.damage);
        text(a.x, a.y - 14, "ЗАДАЧА ГОТОВА", a.color, 2.5);
      }
      a.state = "leaving";
      a.leave = 1.5;
      a.spirits.clear();
      if (s.allies.every((x) => x.state !== "active")) {
        s.finaleAt = s.time + B.finale.seconds;
      }
    }

    function agentEvent(e) {
      if (s.over || !e || typeof e.session !== "string") return;
      const create = REJOIN_KINDS.has(e.kind);
      const a = ally(e, create);
      if (!a) return;
      const src = (e.agent && a.spirits.get(e.agent)) || a;
      switch (e.kind) {
        case "tool":
          a.actions++;
          addXp(B.xp.per_action[e.action] || B.xp.per_action.generic);
          if (canAct(a)) ability(a, src, e);
          if (a.actions % I.ally_every_actions === 0 && s.finaleAt === null) {
            drop(pickItem(), a.x + (random() - 0.5) * 20, a.y + 12);
          }
          break;
        case "tool_error":
          a.actions++;
          addXp(B.xp.error);
          if (!e.agent) {
            a.stun = B.ally.stun_seconds;
            text(a.x, a.y - 12, "ОШИБКА", "#d9534f");
          }
          s.rage = B.rage.seconds;
          break;
        case "blocked":
          a.blocked = B.ally.blocked_seconds;
          text(a.x, a.y - 12, "BLOCKED", "#d9534f", 1.5);
          break;
        case "compact":
          a.meditate = e.phase === "end" ? 0 : B.ally.compact_max_seconds;
          break;
        case "subagent_start":
          if (e.agent && !a.spirits.has(e.agent)) {
            a.spirits.set(e.agent, {x: a.x, y: a.y, angle: random() * Math.PI * 2,
                                    cooldown: 0, until: s.time + A.summon.max_seconds});
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
        const tx = p.x + Math.cos(angle) * B.ally.follow_distance;
        const ty = p.y + Math.sin(angle) * B.ally.follow_distance;
        const d = Math.hypot(tx - a.x, ty - a.y);
        if (d > 1 && a.stun <= 0) {
          const step = Math.min(d, B.ally.speed * dt * Math.max(1, d / 40));
          a.x += (tx - a.x) / d * step;
          a.y += (ty - a.y) / d * step;
        }
        for (const [id, sp] of a.spirits) {
          if (s.time > sp.until) { a.spirits.delete(id); continue; }
          sp.angle += 3 * dt;
          sp.x = a.x + Math.cos(sp.angle) * A.summon.orbit;
          sp.y = a.y + Math.sin(sp.angle) * A.summon.orbit;
          sp.cooldown -= dt;
          if (sp.cooldown <= 0) {
            const t = nearestEnemies(sp, 1, A.summon.range)[0];
            if (t) {
              const angle2 = Math.atan2(t.y - sp.y, t.x - sp.x);
              s.shots.push({x: sp.x, y: sp.y, vx: Math.cos(angle2) * 200, vy: Math.sin(angle2) * 200,
                            r: 2, damage: A.summon.damage * s.stats.ally_damage, pierce: 0,
                            hit: new Set(), life: 1, color: a.color});
              sp.cooldown = A.summon.cooldown;
            }
          }
        }
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
      p.moving = len > 0;
      p.x = clamp(p.x + ix * speed() * dt, p.r, W - p.r);
      p.y = clamp(p.y + iy * speed() * dt, p.r, H - p.r);
      pushOut(p, p.r);
      p.hp = Math.min(s.stats.max_hp, p.hp + s.stats.regen * dt);
      updateWeapon(dt);
    }

    function updateSpawns(dt) {
      if (s.finaleAt !== null) return;
      const active = s.allies.some((a) => a.state === "active");
      const minute = s.time / 60;
      const rate = Math.min(B.spawn.max_per_second, B.spawn.base_per_second
                            + B.spawn.per_minute * minute + B.spawn.per_level * (s.level - 1))
        * (active ? 1 : B.spawn.no_ally_factor);
      s.spawnAcc += rate * dt;
      while (s.spawnAcc >= 1) {
        s.spawnAcc -= 1;
        if (s.enemies.length < B.spawn.max_alive) spawn(pickType());
      }
      if (s.time >= s.nextBoss) {
        s.nextBoss += B.spawn.boss_every_minutes * 60;
        spawn("boss");
        text(s.player.x, s.player.y - 30, "БОСС", "#e8c14a", 2.5);
      }
    }

    function updateEnemies(dt) {
      const p = s.player;
      const rageSpeed = s.rage > 0 ? B.rage.speed : 1, rageDamage = s.rage > 0 ? B.rage.damage : 1;
      if (WALLS.length) updateFlow();
      for (const e of s.enemies) {
        e.flash = Math.max(0, e.flash - dt);
        if (e.slow > 0) e.slow -= dt;
        const k = (e.slow > 0 ? e.slowFactor : 1) * rageSpeed;
        const to = waypoint(e);
        const d = Math.hypot(to.x - e.x, to.y - e.y) || 1;
        e.x += (to.x - e.x) / d * e.speed * k * dt;
        e.y += (to.y - e.y) / d * e.speed * k * dt;
        if (!p.dead && Math.hypot(p.x - e.x, p.y - e.y) < e.r + p.r) hurtPlayer(e.damage * rageDamage);
      }
      // Keep enemies from collapsing into one blob.
      rebuildGrid();
      for (const e of s.enemies) {
        nearby(e.x, e.y, e.r * 2, (o) => {
          if (o === e) return;
          const dx = e.x - o.x, dy = e.y - o.y, d = Math.hypot(dx, dy) || 0.01, min = e.r + o.r;
          if (d < min) {
            const push = (min - d) / 2 / d;
            e.x += dx * push; e.y += dy * push;
            o.x -= dx * push; o.y -= dy * push;
          }
        });
      }
      for (const e of s.enemies) {
        pushOut(e, e.r);
        e.x = clamp(e.x, e.r, W - e.r);
        e.y = clamp(e.y, e.r, H - e.r);
      }
      rebuildGrid();
    }

    function release(sh) {
      if (sh.aim) { sh.aim.incoming -= sh.damage; sh.aim = null; }
    }

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
        if (!sh.target && WALLS.length && inWall(sh.x, sh.y, 0)) sh.life = 0;
        if (sh.life <= 0) continue;
        nearby(sh.x, sh.y, sh.r + 20, (e) => {
          if (sh.life <= 0 || sh.hit.has(e)) return;
          if (Math.hypot(e.x - sh.x, e.y - sh.y) <= e.r + sh.r) {
            sh.hit.add(e);
            if (e === sh.aim) release(sh);
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
      s.streakTimer -= dt;
      if (s.streakTimer <= 0) s.streak = 0;
      s.multiplier = Math.min(B.score.max_multiplier,
        1 + Math.floor(s.streak / B.score.streak_step) * B.score.multiplier_step);
      s.score += B.score.per_second * dt;

      updatePlayer(dt, input || {});
      updateAllies(dt);
      updateSpawns(dt);
      updateEnemies(dt);
      updateShots(dt);
      updateItems(dt);

      s.enemies = s.enemies.filter((e) => !e.dead);
      for (const sh of s.shots) if (sh.life <= 0) release(sh);
      s.shots = s.shots.filter((sh) => sh.life > 0);
      for (const list of [s.effects, s.texts]) for (const x of list) x.t += dt;
      s.effects = s.effects.filter((x) => x.t < x.life);
      s.texts = s.texts.filter((x) => x.t < x.life);

      if (s.finaleAt !== null && s.time >= s.finaleAt) finish("done");
    }

    function finish(reason) {
      if (s.over) return s.results;
      s.over = true;
      s.choices = null;
      s.results = {reason, map: map.id, time: Math.round(s.time), score: Math.floor(s.score), kills: s.kills,
                   damage_taken: Math.round(s.damageTaken), deaths: s.deaths, level: s.level,
                   best_streak: s.bestStreak, allies: s.allies.length};
      return s.results;
    }

    // --- dev panel ---------------------------------------------------------------

    const dev = {
      immortal() { s.immortal = !s.immortal; return s.immortal; },
      level() { addXp(s.xpNext - s.xp); },
      upgrade() {
        const open = B.upgrades.filter((u) => (s.taken[u.id] || 0) < (u.max_level || 5));
        if (open.length) applyUpgrade(open[Math.floor(random() * open.length)]);
      },
      wave() { for (let i = 0; i < B.spawn.wave_size; i++) spawn(pickType()); },
      boss() { spawn("boss"); },
      item() { drop(pickItem(), s.player.x + 30, s.player.y); },
      finale() {
        for (const a of s.allies) leave(a, true);
        s.finaleAt = s.time + B.finale.seconds;
      },
    };

    return {state: s, step, agentEvent, choose, finish, dev};
  }

  root.LCS = {createGame};
})(typeof window !== "undefined" ? window : globalThis);
